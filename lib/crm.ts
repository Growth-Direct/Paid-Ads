import { procurementApiConfig } from './procurement/config'

// Zoho CRM records, read from growth's copy of the Zoho sync mirror instead of the Zoho API.
//
// The dashboard used to call Zoho directly with its own OAuth client. On 2026-09-28 that client
// started returning `invalid_client`, every request retried the token refresh, and Zoho then
// rate-limited the token endpoint — buyer and seller were down until it cleared. growth sits inside
// the VPC next to the mirror (Vercel cannot reach it, see known-traps.md trap 42), so it serves the
// records and this side holds no Zoho credential at all.
//
// growth returns records in the shape the Zoho API does — lookups as `{ name, id }`, multi-selects
// as arrays, datetimes with their IST offset — so nothing downstream changed with the source. The
// mirror trails Zoho by one sync cycle, about ten minutes.
//
// Reached with the `GROWTH_LEDGER_*` pair, like procurement and the spend ledger: same service,
// same `x-api-key` gate, no new secret.

/** Filters, ANDed. `between` is inclusive at both ends, as COQL's is. */
export type CrmFilter =
    | { field: string; op: 'eq'; value: string | number | boolean }
    | { field: string; op: 'in'; value: Array<string | number> }
    | { field: string; op: 'gte' | 'lt'; value: string | number }
    | { field: string; op: 'between'; value: [string | number, string | number] }
    | { field: string; op: 'notNull' }

/** How long to wait on growth for one read. The largest, a month of touches, takes a few seconds. */
const TIMEOUT_MS = 60_000

/** Ids per by-id request, to keep request bodies small. growth answers each in one query. */
const IDS_PER_REQUEST = 1000

async function postRecords(body: {
    module: string
    fields: string[]
    where?: CrmFilter[]
    ids?: string[]
}): Promise<any[]> {
    const config = procurementApiConfig()
    if (!config) {
        throw new Error('growth is not configured — set GROWTH_LEDGER_BASE_URL and GROWTH_LEDGER_API_KEY')
    }

    let res: Response
    try {
        res = await fetch(`${config.baseUrl}/api/crm-mirror/records`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': config.apiKey },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(TIMEOUT_MS),
            cache: 'no-store',
        })
    } catch (e) {
        throw new Error(`growth did not respond for ${body.module}: ${e instanceof Error ? e.message : String(e)}`)
    }

    if (!res.ok) {
        const text = await res.text().catch(() => '')
        // growth answers a bad x-api-key with 403, not 401 — see lib/procurement/growth.ts.
        const hint = res.status === 403 ? ' (check GROWTH_LEDGER_API_KEY)' : ''
        throw new Error(`growth ${body.module} read failed: ${res.status}${hint} ${text.slice(0, 300)}`)
    }

    const json = await res.json().catch(() => null)
    if (!json || !Array.isArray(json.records)) {
        throw new Error(`growth ${body.module} read returned no records array`)
    }
    return json.records
}

/** Records of `module` matching every filter. Throws on any failure, as the COQL reads did. */
export async function queryRecords(module: string, fields: string[], where: CrmFilter[] = []): Promise<any[]> {
    return postRecords({ module, fields, where })
}

/** Records of `module` by id. A failed chunk is logged and skipped, as the Zoho by-id read did. */
export async function fetchRecordsByIds(module: string, fields: string[], ids: string[]): Promise<any[]> {
    if (!ids.length) return []
    const records: any[] = []
    for (let i = 0; i < ids.length; i += IDS_PER_REQUEST) {
        const chunk = ids.slice(i, i + IDS_PER_REQUEST)
        try {
            records.push(...(await postRecords({ module, fields, ids: chunk })))
        } catch (e) {
            console.error(`[crm] fetchRecordsByIds(${module}) chunk failed:`, e)
        }
    }
    return records
}
