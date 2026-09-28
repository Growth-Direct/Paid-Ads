import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchRecordsByIds, queryRecords } from '@/lib/crm'

// The buyer and seller tabs read every Zoho record through growth's mirror endpoint. These tests
// lock the request the dashboard sends and how each failure surfaces: a filtered read must throw,
// exactly as a failed COQL read did, so a report is never built from a silently empty source.

const RECORDS_URL = 'https://growth.test/api/crm-mirror/records'

function recordsOk(records: unknown[]): Response {
    return new Response(JSON.stringify({ module: 'Leads', lastSyncAt: null, count: records.length, records }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    })
}

describe('lib/crm', () => {
    const fetchMock = vi.fn()

    beforeEach(() => {
        process.env.GROWTH_LEDGER_BASE_URL = 'https://growth.test/'
        process.env.GROWTH_LEDGER_API_KEY = 'key-123'
        fetchMock.mockReset()
        vi.stubGlobal('fetch', fetchMock)
    })
    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it('posts module, fields and filters to growth with the ledger key', async () => {
        fetchMock.mockResolvedValueOnce(recordsOk([{ id: '1' }]))

        const records = await queryRecords('Leads', ['id', 'Lead_Status'], [
            { field: 'Created_Time', op: 'gte', value: '2026-07-01T00:00:00+05:30' },
        ])

        expect(records).toEqual([{ id: '1' }])
        const [url, init] = fetchMock.mock.calls[0]!
        expect(url).toBe(RECORDS_URL)
        expect(init.method).toBe('POST')
        expect(init.headers['x-api-key']).toBe('key-123')
        expect(JSON.parse(init.body)).toEqual({
            module: 'Leads',
            fields: ['id', 'Lead_Status'],
            where: [{ field: 'Created_Time', op: 'gte', value: '2026-07-01T00:00:00+05:30' }],
        })
    })

    it('throws on a failed read, naming the key on a 403', async () => {
        fetchMock.mockResolvedValueOnce(new Response('forbidden', { status: 403 }))

        await expect(queryRecords('Deals', ['id'])).rejects.toThrow(/403 \(check GROWTH_LEDGER_API_KEY\)/)
    })

    it('throws when growth answers without a records array', async () => {
        fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }))

        await expect(queryRecords('Deals', ['id'])).rejects.toThrow(/no records array/)
    })

    it('throws before any request when growth is not configured', async () => {
        delete process.env.GROWTH_LEDGER_BASE_URL

        await expect(queryRecords('Deals', ['id'])).rejects.toThrow(/GROWTH_LEDGER_BASE_URL/)
        expect(fetchMock).not.toHaveBeenCalled()
    })

    it('fetches by id in chunks and skips a failed chunk, as the Zoho by-id read did', async () => {
        const ids = Array.from({ length: 1500 }, (_, i) => String(i))
        fetchMock
            .mockResolvedValueOnce(recordsOk([{ id: '0' }]))
            .mockResolvedValueOnce(new Response('boom', { status: 500 }))
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

        const records = await fetchRecordsByIds('Sellers', ['id'], ids)

        expect(records).toEqual([{ id: '0' }])
        expect(fetchMock).toHaveBeenCalledTimes(2)
        expect(JSON.parse(fetchMock.mock.calls[0]![1].body).ids).toHaveLength(1000)
        expect(JSON.parse(fetchMock.mock.calls[1]![1].body).ids).toHaveLength(500)
        expect(errorSpy).toHaveBeenCalledOnce()
        errorSpy.mockRestore()
    })

    it('makes no request for an empty id list', async () => {
        expect(await fetchRecordsByIds('Leads', ['id'], [])).toEqual([])
        expect(fetchMock).not.toHaveBeenCalled()
    })
})
