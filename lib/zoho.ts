interface TokenCache {
    accessToken: string
    expiresAt: number
}

let tokenCache: TokenCache | null = null
let refreshInFlight: Promise<string> | null = null

async function getAccessToken(forceRefresh = false): Promise<string> {
    if (!forceRefresh && tokenCache && Date.now() < tokenCache.expiresAt - 60_000) {
        return tokenCache.accessToken
    }
    // A forced refresh means Zoho rejected the cached token before its stated expiry — it
    // evicts older access tokens when many are minted at once across instances, so a token we
    // still believe valid comes back INVALID_TOKEN. Drop it so no concurrent caller keeps
    // using the dead token.
    if (forceRefresh) tokenCache = null
    // Deduplicate concurrent refresh calls — all waiters share a single HTTP request
    if (refreshInFlight) return refreshInFlight

    refreshInFlight = (async () => {
        const { ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN } = process.env
        if (!ZOHO_CLIENT_ID || !ZOHO_CLIENT_SECRET || !ZOHO_REFRESH_TOKEN) {
            throw new Error('Missing Zoho OAuth env vars: ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN')
        }

        const params = new URLSearchParams({
            grant_type: 'refresh_token',
            client_id: ZOHO_CLIENT_ID,
            client_secret: ZOHO_CLIENT_SECRET,
            refresh_token: ZOHO_REFRESH_TOKEN,
        })

        const res = await fetch('https://accounts.zoho.in/oauth/v2/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: params.toString(),
            cache: 'no-store',
        })

        if (!res.ok) {
            const text = await res.text()
            throw new Error(`Zoho token refresh failed: ${res.status} ${text}`)
        }

        const json = await res.json()
        if (json.error) throw new Error(`Zoho token error: ${json.error}`)

        tokenCache = {
            accessToken: json.access_token as string,
            expiresAt: Date.now() + (json.expires_in as number) * 1000,
        }

        return tokenCache.accessToken
    })().finally(() => {
        refreshInFlight = null
    })

    return refreshInFlight
}

/** Authenticated fetch to Zoho with a one-shot retry on 401. A cached access token can be
 *  rejected before its stated expiry — Zoho evicts older access tokens when many are minted
 *  at once (every serverless instance refreshing around the hourly rollover), so a token we
 *  still believe valid comes back INVALID_TOKEN. Forcing a fresh token and retrying once turns
 *  that transient 401 into a success instead of a surfaced 500. */
async function zohoFetch(
    url: string,
    init: { method?: string; body?: string; headers?: Record<string, string> } = {}
): Promise<Response> {
    const run = (token: string) =>
        fetch(url, {
            method: init.method,
            body: init.body,
            headers: { ...init.headers, Authorization: `Zoho-oauthtoken ${token}` },
            cache: 'no-store',
        })
    const res = await run(await getAccessToken())
    if (res.status !== 401) return res
    return run(await getAccessToken(true))
}

export async function executeCOQLv6(query: string): Promise<any[]> {
    const res = await zohoFetch('https://www.zohoapis.in/crm/v6/coql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ select_query: `${query} LIMIT 200 OFFSET 0` }),
    })
    if (!res.ok) {
        console.error(`[zoho] v6 COQL failed:`, await res.text())
        return []
    }
    const json = await res.json()
    return json.data ?? []
}

export async function executeCOQL(query: string): Promise<any[]> {
    const PAGE_SIZE = 200
    const allRecords: any[] = []
    let offset = 0

    while (true) {
        const res = await zohoFetch('https://www.zohoapis.in/crm/v3/coql', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ select_query: `${query} LIMIT ${PAGE_SIZE} OFFSET ${offset}` }),
        })

        if (res.status === 204) break
        if (!res.ok) {
            const text = await res.text()
            console.error(`[zoho] COQL failed offset=${offset}:`, text)
            throw new Error(`Zoho COQL request failed: ${res.status} ${text}`)
        }

        const json = await res.json()
        if (!json.data?.length) break
        allRecords.push(...json.data)
        if (!json.info?.more_records) break
        offset += PAGE_SIZE
    }

    return allRecords
}

export async function fetchRecordById(module: string, id: string, fields: string[]): Promise<any | null> {
    const base = `https://www.zohoapis.in/crm/v3/${module}/${id}`
    const url = fields.length > 0 ? `${base}?fields=${fields.join(',')}` : base
    const res = await zohoFetch(url)
    if (res.status === 204) return null
    if (!res.ok) {
        const text = await res.text()
        console.error(`[zoho] fetchRecordById(${module}/${id}) failed:`, text)
        return null
    }
    const json = await res.json()
    return json.data?.[0] ?? null
}

// v6 individual GET — used for AI-generated fields (e.g. Lead_Summary_AI) that the
// v3 endpoint does not expose. Unlike COQL v6, a single-record GET has no text-field
// truncation limit, so this returns the full content.
export async function fetchRecordByIdV6(module: string, id: string, fields: string[]): Promise<any | null> {
    const base = `https://www.zohoapis.in/crm/v6/${module}/${id}`
    const url = fields.length > 0 ? `${base}?fields=${fields.join(',')}` : base
    const res = await zohoFetch(url)
    if (res.status === 204) return null
    if (!res.ok) {
        const text = await res.text()
        console.error(`[zoho] fetchRecordByIdV6(${module}/${id}) failed:`, text)
        return null
    }
    const json = await res.json()
    return json.data?.[0] ?? null
}

export async function fetchRecordsByIds(module: string, fields: string[], ids: string[]): Promise<any[]> {
    if (!ids.length) return []
    const CHUNK = 100
    const allRecords: any[] = []
    const fieldsParam = fields.join(',')

    for (let i = 0; i < ids.length; i += CHUNK) {
        const chunk = ids.slice(i, i + CHUNK)
        // Zoho requires literal commas in `ids` — URLSearchParams encodes them as %2C which Zoho rejects
        const url = `https://www.zohoapis.in/crm/v3/${module}?ids=${chunk.join(',')}&fields=${fieldsParam}`
        const res = await zohoFetch(url)
        if (res.status === 204) continue
        if (!res.ok) {
            const text = await res.text()
            console.error(`[zoho] fetchRecordsByIds(${module}) chunk failed:`, text)
            continue
        }
        const json = await res.json()
        if (json.data?.length) allRecords.push(...json.data)
    }

    return allRecords
}

export async function fetchRecords(module: string, fields: string[], criteria?: string): Promise<any[]> {
    const PAGE_SIZE = 200
    const allRecords: any[] = []
    const fieldsParam = fields.join(',')

    if (criteria) {
        // Search endpoint uses integer page pagination (not page_token)
        const baseUrl = `https://www.zohoapis.in/crm/v3/${module}/search`
        let page = 1
        while (true) {
            const params = new URLSearchParams({
                criteria: criteria,
                per_page: String(PAGE_SIZE),
                fields: fieldsParam,
                page: String(page),
            })
            const url = `${baseUrl}?${params}`

            const res = await zohoFetch(url)

            if (res.status === 204) break
            if (!res.ok) {
                const text = await res.text()
                // Zoho caps search pagination at 2000 records — treat as end of results
                try {
                    const errJson = JSON.parse(text)
                    if (errJson.code === 'LIMIT_REACHED') {
                        console.log(`[zoho] ${module} search hit 2000-record cap at p${page}, stopping`)
                        break
                    }
                } catch {}
                console.error(`[zoho] fetchRecords(${module}) search p${page} failed:`, text)
                throw new Error(`Zoho API failed: ${res.status} ${text}`)
            }

            const json = await res.json()
            if (!json.data?.length) break
            allRecords.push(...json.data)
            if (!json.info?.more_records) break
            page++
        }
    } else {
        // Regular listing endpoint uses page_token pagination
        const baseUrl = `https://www.zohoapis.in/crm/v3/${module}`
        let pageToken: string | null = null
        while (true) {
            const params = new URLSearchParams({ per_page: String(PAGE_SIZE), fields: fieldsParam })
            if (pageToken) params.set('page_token', pageToken)
            const url = `${baseUrl}?${params}`

            const res = await zohoFetch(url)

            if (res.status === 204) break
            if (!res.ok) {
                const text = await res.text()
                console.error(`[zoho] fetchRecords(${module}) list failed:`, text)
                throw new Error(`Zoho API failed: ${res.status} ${text}`)
            }

            const json = await res.json()
            if (!json.data?.length) break
            allRecords.push(...json.data)
            if (!json.info?.more_records) break
            pageToken = json.info.next_page_token ?? null
            if (!pageToken) break
        }
    }

    return allRecords
}
