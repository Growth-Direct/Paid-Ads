import { fetchLedgerSpend, ledgerConfigured, ledgerEnabled } from '@/lib/buyer/spend/ledger'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The ledger reader's mapping rules, pinned. Everything here is a rule that fails silently in
// production if it breaks: a mis-mapped source moves money between channels, a dropped row makes
// spend look lower than it was, and both render as a plausible chart.

const BASE = 'https://growth.example'

function respondWith(payload: unknown, ok = true, status = 200) {
    return vi.fn(async () => ({
        ok,
        status,
        json: async () => payload,
    })) as unknown as typeof fetch
}

function facts(rows: Partial<Record<string, unknown>>[]) {
    return {
        from: '2026-09-01',
        to: '2026-09-02',
        facts: rows.map((r) => ({
            date: '2026-09-01',
            source: 'Meta',
            micromarket: 'Powai',
            spendInr: 100,
            impressions: 10,
            clicks: 1,
            rows: 1,
            ...r,
        })),
        ingest: {
            rowsRead: rows.length,
            groups: rows.length,
            lastRunAt: null as string | null,
            failedSources: [] as string[],
            truncated: false,
        },
    }
}

describe('ledgerConfigured', () => {
    beforeEach(() => {
        process.env.GROWTH_LEDGER_BASE_URL = BASE
        process.env.GROWTH_LEDGER_API_KEY = 'k'
    })
    afterEach(() => {
        delete process.env.GROWTH_LEDGER_BASE_URL
        delete process.env.GROWTH_LEDGER_API_KEY
        delete process.env.GROWTH_LEDGER_ENABLED
    })

    it('needs both the URL and the key', () => {
        expect(ledgerConfigured()).toBe(true)
        delete process.env.GROWTH_LEDGER_API_KEY
        expect(ledgerConfigured()).toBe(false)
    })

    it('is on when the flag is unset, so a deploy does not change the source', () => {
        expect(process.env.GROWTH_LEDGER_ENABLED).toBeUndefined()
        expect(ledgerEnabled()).toBe(true)
        expect(ledgerConfigured()).toBe(true)
    })

    it('falls back to the snapshot when the flag is switched off', () => {
        for (const off of ['false', '0', 'off', 'no', 'FALSE', ' Off ']) {
            process.env.GROWTH_LEDGER_ENABLED = off
            expect(ledgerEnabled(), off).toBe(false)
            // Credentials are still present — the switch alone decides.
            expect(ledgerConfigured(), off).toBe(false)
        }
    })

    it('stays on for a value it does not recognise', () => {
        // A typo in an env var must not quietly change where the money comes from.
        for (const on of ['true', '1', 'yes', 'flase', 'disabled', '']) {
            process.env.GROWTH_LEDGER_ENABLED = on
            expect(ledgerEnabled(), on).toBe(true)
        }
    })

    it('leaves an unconfigured environment off whatever the flag says', () => {
        process.env.GROWTH_LEDGER_ENABLED = 'true'
        delete process.env.GROWTH_LEDGER_BASE_URL
        expect(ledgerConfigured()).toBe(false)
    })
})

describe('fetchLedgerSpend', () => {
    beforeEach(() => {
        process.env.GROWTH_LEDGER_BASE_URL = BASE
        process.env.GROWTH_LEDGER_API_KEY = 'k'
    })
    afterEach(() => {
        delete process.env.GROWTH_LEDGER_BASE_URL
        delete process.env.GROWTH_LEDGER_API_KEY
        vi.unstubAllGlobals()
    })

    it('maps a ledger source onto this dashboard’s channel', async () => {
        vi.stubGlobal('fetch', respondWith(facts([{ source: 'Meta' }, { source: '99Acres' }])))
        const { facts: out } = await fetchLedgerSpend('2026-09-01', '2026-09-02')
        expect(out.map((f) => f.channel).sort()).toEqual(['3P', 'Paid Ads'])
    })

    it('keeps an unmappable source under Unmapped and names it, rather than dropping the money', async () => {
        vi.stubGlobal('fetch', respondWith(facts([{ source: 'Society Newsletter', spendInr: 4000 }])))
        const { facts: out, ingest } = await fetchLedgerSpend('2026-09-01', '2026-09-02')
        expect(out).toHaveLength(1)
        expect(out[0]!.channel).toBe('Unmapped')
        expect(out[0]!.spendInr).toBe(4000)
        expect(ingest.unmappedSources).toContain('Society Newsletter')
    })

    it('puts an unrecognised micromarket in the unallocated bucket and names it', async () => {
        vi.stubGlobal('fetch', respondWith(facts([{ micromarket: 'Atlantis' }])))
        const { facts: out, ingest } = await fetchLedgerSpend('2026-09-01', '2026-09-02')
        expect(out[0]!.micromarket).toBeNull()
        expect(ingest.unknownMicromarkets).toContain('Atlantis')
    })

    it('carries a platform-level row (null micromarket) through as unallocated', async () => {
        vi.stubGlobal('fetch', respondWith(facts([{ source: '99Acres', micromarket: null, spendInr: 6000 }])))
        const { facts: out } = await fetchLedgerSpend('2026-09-01', '2026-09-02')
        expect(out[0]!.micromarket).toBeNull()
        expect(out[0]!.spendInr).toBe(6000)
    })

    it('SUMS two groups that fold onto the same key, never replaces one with the other', async () => {
        vi.stubGlobal(
            'fetch',
            respondWith(
                facts([
                    { source: 'Meta', spendInr: 100, impressions: 10, clicks: 1 },
                    { source: 'meta', spendInr: 250, impressions: 20, clicks: 3 },
                ])
            )
        )
        const { facts: out } = await fetchLedgerSpend('2026-09-01', '2026-09-02')
        expect(out).toHaveLength(1)
        expect(out[0]!.spendInr).toBe(350)
        expect(out[0]!.impressions).toBe(30)
        expect(out[0]!.clicks).toBe(4)
    })

    it('drops a row with an unusable date and counts it', async () => {
        vi.stubGlobal('fetch', respondWith(facts([{ date: 'yesterday' }, { date: '2026-09-01' }])))
        const { facts: out, ingest } = await fetchLedgerSpend('2026-09-01', '2026-09-02')
        expect(out).toHaveLength(1)
        expect(ingest.droppedBadDate).toBe(1)
    })

    it('passes the purpose filter through, and can be told not to', async () => {
        const spy = respondWith(facts([]))
        vi.stubGlobal('fetch', spy)
        await fetchLedgerSpend('2026-09-01', '2026-09-02')
        expect(String((spy as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]![0])).toContain(
            'purpose=BUYER'
        )

        await fetchLedgerSpend('2026-09-01', '2026-09-02', null)
        expect(String((spy as unknown as { mock: { calls: unknown[][] } }).mock.calls[1]![0])).not.toContain('purpose')
    })

    it('reports a failed ingest on the growth side as an error, not as a quiet week', async () => {
        const payload = facts([{}])
        payload.ingest.failedSources = ['Meta']
        vi.stubGlobal('fetch', respondWith(payload))
        const { ingest } = await fetchLedgerSpend('2026-09-01', '2026-09-02')
        expect(ingest.status).toBe('ok')
        expect(ingest.error).toContain('Meta')
    })

    it('degrades to unavailable — never throws — when the ledger answers badly', async () => {
        vi.stubGlobal('fetch', respondWith({}, false, 503))
        const { facts: out, ingest } = await fetchLedgerSpend('2026-09-01', '2026-09-02')
        expect(out).toEqual([])
        expect(ingest.status).toBe('unavailable')
        expect(ingest.error).toContain('503')
    })

    it('degrades to unavailable when the ledger is unreachable', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => {
                throw new Error('connect ECONNREFUSED')
            }) as unknown as typeof fetch
        )
        const { ingest } = await fetchLedgerSpend('2026-09-01', '2026-09-02')
        expect(ingest.status).toBe('unavailable')
        expect(ingest.error).toContain('ECONNREFUSED')
    })

    it('says so when it is not configured at all', async () => {
        delete process.env.GROWTH_LEDGER_BASE_URL
        const { ingest } = await fetchLedgerSpend('2026-09-01', '2026-09-02')
        expect(ingest.status).toBe('unavailable')
        expect(ingest.error).toContain('not configured')
    })
})

describe('spend origin', () => {
    const realFetch = globalThis.fetch
    afterEach(() => {
        globalThis.fetch = realFetch
        delete process.env.GROWTH_LEDGER_ENABLED
        vi.restoreAllMocks()
    })

    // SpendNote names the source in words. An unstamped origin would put a guess into a
    // sentence the growth team reads as fact.
    it('says snapshot when the ledger is not configured', async () => {
        delete process.env.GROWTH_LEDGER_BASE_URL
        delete process.env.GROWTH_LEDGER_API_KEY
        const { loadSpend } = await import('@/lib/buyer/spend/source')
        const { ingest } = await loadSpend('2026-07-01', '2026-09-30')
        expect(ingest.origin).toBe('snapshot')
    })

    it('says ledger on a failed ledger read, not snapshot — the read was still a ledger read', async () => {
        process.env.GROWTH_LEDGER_BASE_URL = BASE
        process.env.GROWTH_LEDGER_API_KEY = 'k'
        globalThis.fetch = respondWith({}, false, 500)
        const { ingest } = await fetchLedgerSpend('2026-09-01', '2026-09-02')
        expect(ingest.origin).toBe('ledger')
        expect(ingest.status).toBe('unavailable')
    })
})
