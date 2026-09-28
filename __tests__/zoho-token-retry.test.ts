import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Zoho evicts older access tokens when many are minted at once across serverless instances,
// so a cached token we still believe valid can come back 401 INVALID_TOKEN. The fix: on a
// 401, force a fresh token and retry the request once. These tests lock that behaviour.

const TOKEN_URL = 'https://accounts.zoho.in/oauth/v2/token'
const COQL_URL = 'https://www.zohoapis.in/crm/v3/coql'

function tokenResponse(accessToken: string): Response {
    return new Response(JSON.stringify({ access_token: accessToken, expires_in: 3600 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    })
}
function coqlOk(data: unknown[]): Response {
    return new Response(JSON.stringify({ data, info: { more_records: false } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    })
}
function invalidToken(): Response {
    return new Response(
        JSON.stringify({ code: 'INVALID_TOKEN', message: 'invalid oauth token', status: 'error' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
    )
}

describe('executeCOQL token retry', () => {
    beforeEach(() => {
        // Fresh module each test so the in-memory token cache starts empty.
        vi.resetModules()
        process.env.ZOHO_CLIENT_ID = 'cid'
        process.env.ZOHO_CLIENT_SECRET = 'secret'
        process.env.ZOHO_REFRESH_TOKEN = 'refresh'
    })
    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it('forces a fresh token and retries once on 401 INVALID_TOKEN, then succeeds', async () => {
        const tokenCalls: string[] = []
        let coqlHits = 0
        const fetchMock = vi.fn(async (url: string | URL) => {
            const u = url.toString()
            if (u.startsWith(TOKEN_URL)) {
                tokenCalls.push(u)
                return tokenResponse(`tok-${tokenCalls.length}`)
            }
            if (u.startsWith(COQL_URL)) {
                coqlHits++
                return coqlHits === 1 ? invalidToken() : coqlOk([{ id: '785549000000851232' }])
            }
            throw new Error(`unexpected url ${u}`)
        })
        vi.stubGlobal('fetch', fetchMock)

        const { executeCOQL } = await import('@/lib/zoho')
        const rows = await executeCOQL('SELECT id FROM Leads')

        expect(rows).toEqual([{ id: '785549000000851232' }])
        expect(coqlHits).toBe(2) // first attempt 401, retry 200
        expect(tokenCalls.length).toBe(2) // initial mint + one forced refresh
    })

    it('throws after a single retry when the 401 persists', async () => {
        let coqlHits = 0
        const fetchMock = vi.fn(async (url: string | URL) => {
            const u = url.toString()
            if (u.startsWith(TOKEN_URL)) return tokenResponse('tok')
            if (u.startsWith(COQL_URL)) {
                coqlHits++
                return invalidToken()
            }
            throw new Error(`unexpected url ${u}`)
        })
        vi.stubGlobal('fetch', fetchMock)

        const { executeCOQL } = await import('@/lib/zoho')
        await expect(executeCOQL('SELECT id FROM Leads')).rejects.toThrow(/Zoho COQL request failed: 401/)
        expect(coqlHits).toBe(2) // original + exactly one retry, then give up
    })
})
