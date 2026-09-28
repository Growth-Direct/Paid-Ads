import { fetchSellerLedgerSpend } from '@/lib/seller/spend/ledger'
import { loadSellerSpend } from '@/lib/seller/spend/source'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The seller ledger reader's mapping rules, pinned — the same rules the buyer reader has, plus
// the two things that are seller-only: an IST instant rather than a bare day, and the
// unallocated total the seller ingest block renders.

const BASE = 'https://growth.example'

function respondWith(payload: unknown, ok = true, status = 200) {
    return vi.fn(async () => ({ ok, status, json: async () => payload })) as unknown as typeof fetch
}

function facts(rows: Partial<Record<string, unknown>>[], ingest: Record<string, unknown> = {}) {
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
        ingest: { rowsRead: rows.length, groups: rows.length, lastRunAt: null, failedSources: [], truncated: false, ...ingest },
    }
}

describe('fetchSellerLedgerSpend', () => {
    const realFetch = globalThis.fetch
    beforeEach(() => {
        process.env.GROWTH_LEDGER_BASE_URL = BASE
        process.env.GROWTH_LEDGER_API_KEY = 'k'
        delete process.env.GROWTH_LEDGER_ENABLED
    })
    afterEach(() => {
        globalThis.fetch = realFetch
        vi.restoreAllMocks()
    })

    it('asks the ledger for SELLER, not BUYER', async () => {
        const f = respondWith(facts([{}]))
        globalThis.fetch = f
        await fetchSellerLedgerSpend('2026-09-01', '2026-09-02')
        const url = String((f as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![0])
        expect(url).toContain('purpose=SELLER')
    })

    // A bare YYYY-MM-DD is read as UTC and lands 5.5 hours early, which moves a
    // midnight-adjacent activity into the previous day and the previous week's cost-per metric.
    it('stamps the date as an IST midnight instant, not a bare day', async () => {
        globalThis.fetch = respondWith(facts([{ date: '2026-09-01' }]))
        const { facts: out } = await fetchSellerLedgerSpend('2026-09-01', '2026-09-02')
        expect(out[0]!.date).toBe('2026-09-01T00:00:00+05:30')
        expect(new Date(out[0]!.date).getTime()).toBe(new Date('2026-09-01T00:00:00+05:30').getTime())
    })

    it('sums rows that collide on day, channel, micromarket and source', async () => {
        globalThis.fetch = respondWith(facts([{ spendInr: 100 }, { spendInr: 250 }]))
        const { facts: out } = await fetchSellerLedgerSpend('2026-09-01', '2026-09-02')
        expect(out).toHaveLength(1)
        expect(out[0]!.spendInr).toBe(350)
    })

    it('keeps an out-of-scope source as Unmapped and names it, rather than dropping its spend', async () => {
        globalThis.fetch = respondWith(facts([{ source: 'Telepathy', spendInr: 900 }]))
        const { facts: out, ingest } = await fetchSellerLedgerSpend('2026-09-01', '2026-09-02')
        expect(out[0]!.channel).toBe('Unmapped')
        expect(out[0]!.spendInr).toBe(900)
        expect(ingest.unmappedSources).toContain('Telepathy')
    })

    it('totals unallocated rupees, which the ingest block renders', async () => {
        globalThis.fetch = respondWith(facts([{ micromarket: null, spendInr: 400 }, { micromarket: 'Powai', spendInr: 100 }]))
        const { ingest } = await fetchSellerLedgerSpend('2026-09-01', '2026-09-02')
        expect(ingest.unallocatedInr).toBe(400)
    })

    it('does not flag a deliberately unallocated value as an unknown micromarket', async () => {
        globalThis.fetch = respondWith(facts([{ micromarket: 'All MM' }]))
        const { ingest, facts: out } = await fetchSellerLedgerSpend('2026-09-01', '2026-09-02')
        expect(out[0]!.micromarket).toBeNull()
        expect(ingest.unknownMicromarkets).toHaveLength(0)
    })

    it('drops a malformed date rather than guessing one, and counts it', async () => {
        globalThis.fetch = respondWith(facts([{ date: '01/09/2026' }, { date: '2026-09-01' }]))
        const { facts: out, ingest } = await fetchSellerLedgerSpend('2026-09-01', '2026-09-02')
        expect(out).toHaveLength(1)
        expect(ingest.droppedBadDate).toBe(1)
    })

    it('surfaces a failed upstream pull as an error while still returning the rows it has', async () => {
        globalThis.fetch = respondWith(facts([{}], { failedSources: ['Meta'] }))
        const { facts: out, ingest } = await fetchSellerLedgerSpend('2026-09-01', '2026-09-02')
        expect(out).toHaveLength(1)
        expect(ingest.status).toBe('ok')
        expect(ingest.error).toContain('Meta')
    })

    // The whole point of the change: a ledger error must not quietly serve the committed file.
    it('reports unavailable on a failed read instead of falling back to the snapshot', async () => {
        globalThis.fetch = respondWith({}, false, 500)
        const { facts: out, ingest } = await fetchSellerLedgerSpend('2026-09-01', '2026-09-02')
        expect(out).toHaveLength(0)
        expect(ingest.status).toBe('unavailable')
    })
})

describe('loadSellerSpend — the environment gate', () => {
    const realFetch = globalThis.fetch
    afterEach(() => {
        globalThis.fetch = realFetch
        delete process.env.GROWTH_LEDGER_ENABLED
        vi.restoreAllMocks()
    })

    it('serves the committed snapshot when the ledger is not configured', async () => {
        delete process.env.GROWTH_LEDGER_BASE_URL
        delete process.env.GROWTH_LEDGER_API_KEY
        const { facts, ingest } = await loadSellerSpend('2026-07-01', '2026-09-30')
        expect(facts.length).toBeGreaterThan(0)
        expect(ingest.slashOrder).not.toBeNull()
    })

    // One flag governs both tabs. A deployment where buyer reads the ledger and seller reads a
    // committed file is invisible from the UI, and is the divergence the ledger exists to remove.
    it('serves the snapshot when the flag switches the ledger off, even though it is configured', async () => {
        process.env.GROWTH_LEDGER_BASE_URL = BASE
        process.env.GROWTH_LEDGER_API_KEY = 'k'
        process.env.GROWTH_LEDGER_ENABLED = 'false'
        const f = respondWith(facts([{}]))
        globalThis.fetch = f
        const { ingest } = await loadSellerSpend('2026-07-01', '2026-09-30')
        expect(f).not.toHaveBeenCalled()
        expect(ingest.slashOrder).not.toBeNull()
    })

    it('stamps origin so the note cannot misdescribe where the number came from', async () => {
        delete process.env.GROWTH_LEDGER_BASE_URL
        delete process.env.GROWTH_LEDGER_API_KEY
        const snap = await loadSellerSpend('2026-07-01', '2026-09-30')
        expect(snap.ingest.origin).toBe('snapshot')

        process.env.GROWTH_LEDGER_BASE_URL = BASE
        process.env.GROWTH_LEDGER_API_KEY = 'k'
        globalThis.fetch = respondWith(facts([{}]))
        const led = await loadSellerSpend('2026-09-01', '2026-09-02')
        expect(led.ingest.origin).toBe('ledger')
    })

    it('reads the ledger when configured and not switched off', async () => {
        process.env.GROWTH_LEDGER_BASE_URL = BASE
        process.env.GROWTH_LEDGER_API_KEY = 'k'
        globalThis.fetch = respondWith(facts([{ spendInr: 777 }]))
        const { facts: out, ingest } = await loadSellerSpend('2026-09-01', '2026-09-02')
        expect(out).toHaveLength(1)
        expect(out[0]!.spendInr).toBe(777)
        expect(ingest.slashOrder).toBeNull()
    })
})
