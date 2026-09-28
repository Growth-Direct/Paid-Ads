import { describe, expect, it } from 'vitest'
import { computeSellerSpendForWindow, costPer } from '@/lib/seller/costs'
import { EMPTY_SELLER_SPEND_INGEST } from '@/lib/seller/spend/parse'
import type { SellerFacts, SellerSpendFact } from '@/lib/seller/facts'
import { EMPTY_SELLER_FILTERS, type SellerFilters } from '@/lib/seller/filters'
import type { SellerChannel } from '@/lib/seller/types'

// The seller reporting quarter, Jul 5 → Oct 5 (offset from the buyer's Jul 1).
const WINDOW_START = new Date('2026-07-05T00:00:00+05:30')
const WINDOW_END = new Date('2026-10-05T00:00:00+05:30')

const ISO = (m: number, d: number) => `2026-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T00:00:00+05:30`

function spend(
    channel: SellerChannel,
    micromarket: string | null,
    spendInr: number,
    opts: { date?: string; rawSource?: string } = {}
): SellerSpendFact {
    return {
        date: opts.date ?? ISO(8, 5),
        channel,
        micromarket,
        rawSource: opts.rawSource ?? (channel === 'Paid Ads' ? 'meta' : '99acres'),
        spendInr,
        impressions: 0,
        clicks: 0,
    }
}

function facts(spendRows: SellerSpendFact[]): SellerFacts {
    return {
        sellers: [],
        products: [],
        channelPartnerProducts: [],
        channelPartnerPlaces: {},
        spend: spendRows,
        spendIngest: EMPTY_SELLER_SPEND_INGEST,
        windowStart: WINDOW_START.toISOString(),
        windowEnd: WINDOW_END.toISOString(),
    }
}

const filters = (over: Partial<SellerFilters> = {}): SellerFilters => ({ ...EMPTY_SELLER_FILTERS, ...over })

const run = (rows: SellerSpendFact[], f: SellerFilters = filters()) =>
    computeSellerSpendForWindow(facts(rows), f, WINDOW_START, WINDOW_END)

describe('computeSellerSpendForWindow', () => {
    it('sums every spend row inside the window', () => {
        expect(run([spend('Paid Ads', 'Powai', 1000), spend('3P', 'Glasgow', 2000)]).total).toBe(3000)
    })

    it('excludes rows outside the window, both sides', () => {
        // The seller tab carries data from January, well before the Jul 5 quarter start.
        const rows = [spend('Paid Ads', 'Powai', 500, { date: ISO(1, 6) }), spend('Paid Ads', 'Powai', 700, { date: ISO(11, 1) })]
        expect(run(rows).total).toBe(0)
    })

    it('treats the window as half-open — the start day counts, the end day does not', () => {
        expect(run([spend('Paid Ads', 'Powai', 100, { date: ISO(7, 5) })]).total).toBe(100)
        expect(run([spend('Paid Ads', 'Powai', 100, { date: ISO(10, 5) })]).total).toBe(0)
    })

    it('filters by channel', () => {
        const rows = [spend('Paid Ads', 'Powai', 1000), spend('3P', 'Powai', 2000)]
        expect(run(rows, filters({ channels: ['Paid Ads'] })).total).toBe(1000)
    })

    it('lets a source filter NARROW within a channel rather than widen it', () => {
        // Ticking a channel ticks its sources, so once sources are selected they carry the
        // whole intent and the channel check is skipped — mirroring sellerMatches.
        const rows = [
            spend('Paid Ads', 'Powai', 1000, { rawSource: 'meta' }),
            spend('Paid Ads', 'Powai', 400, { rawSource: 'google_ads' }),
        ]
        expect(run(rows, filters({ channels: ['Paid Ads'], sources: ['meta'] })).total).toBe(1000)
    })

    it('matches a source across the sheet-vs-Zoho spelling gap', () => {
        // Zoho's picker offers `99 Acres`; the sheet writes `99Acres`. Measured 2026-09-08.
        // Before normalisation this filter returned 0 and every cost row read as a dash, as
        // though ₹22,150 of real 3P spend did not exist.
        const rows = [spend('3P', 'Powai', 22149.84, { rawSource: '99acres' })]
        expect(run(rows, filters({ sources: ['99 acres'] })).total).toBeCloseTo(22149.84, 2)
    })

    it('keeps genuinely distinct sources apart despite the normalisation', () => {
        const rows = [
            spend('Cold Outreach', 'Powai', 100, { rawSource: 'society data' }),
            spend('Society WA Groups & Management Apps', 'Powai', 900, { rawSource: 'society data - wa blast' }),
        ]
        expect(run(rows, filters({ sources: ['society data'] })).total).toBe(100)
    })

    it('returns zero spend, not a partial total, for a source with no spend rows', () => {
        // This is the safe degradation: costPer sees 0 and yields null, so the row reads "—"
        // rather than an artificially cheap number.
        const rows = [spend('Paid Ads', 'Powai', 1000, { rawSource: 'meta' })]
        expect(run(rows, filters({ sources: ['society whatsapp'] })).total).toBe(0)
    })

    it('expands a cluster to its own micromarkets, keeping the seller-only ones', () => {
        // GLAM is Glasgow + Amsterdam. Berlin belongs to another cluster and must not leak in.
        const rows = [spend('Paid Ads', 'Glasgow', 1000), spend('Paid Ads', 'Amsterdam', 500), spend('Paid Ads', 'Berlin', 900)]
        expect(run(rows, filters({ clusters: ['GLAM'] })).total).toBe(1500)
    })

    it('never ANDs cluster against micromarket — micromarket wins once selected', () => {
        const rows = [spend('Paid Ads', 'Glasgow', 1000), spend('Paid Ads', 'Berlin', 900)]
        expect(run(rows, filters({ clusters: ['GLAM'], micromarkets: ['Berlin'] })).total).toBe(900)
    })

    it('includes unallocated spend when no place filter is on', () => {
        const rows = [spend('Paid Ads', 'Powai', 1000), spend('Paid Ads', null, 4000)]
        const out = run(rows)
        expect(out.total).toBe(5000)
        expect(out.excludedUnallocated).toBe(0)
    })

    it('excludes unallocated spend under a micromarket filter AND reports what it dropped', () => {
        // ~20% of real seller spend is unallocated (All MM, blank, a cluster in the column).
        // Dropping it silently makes the filtered cost-per rows look cheaper than they are.
        const rows = [spend('Paid Ads', 'Powai', 1000), spend('Paid Ads', null, 4000)]
        const out = run(rows, filters({ micromarkets: ['Powai'] }))
        expect(out.total).toBe(1000)
        expect(out.excludedUnallocated).toBe(4000)
    })

    it('excludes unallocated spend under a cluster filter too', () => {
        const rows = [spend('Paid Ads', 'Glasgow', 1000), spend('Paid Ads', null, 4000)]
        const out = run(rows, filters({ clusters: ['GLAM'] }))
        expect(out.total).toBe(1000)
        expect(out.excludedUnallocated).toBe(4000)
    })

    it('does not count unallocated spend that fails the channel filter as "excluded by place"', () => {
        // excludedUnallocated must mean "dropped ONLY for having no micromarket", otherwise the
        // on-screen note overstates what the place filter cost.
        const rows = [spend('3P', null, 4000)]
        const out = run(rows, filters({ channels: ['Paid Ads'], micromarkets: ['Powai'] }))
        expect(out.total).toBe(0)
        expect(out.excludedUnallocated).toBe(0)
    })

    it('returns zero when nothing matches', () => {
        expect(run([spend('Paid Ads', 'Powai', 1000)], filters({ micromarkets: ['Vegas'] })).total).toBe(0)
    })
})

describe('costPer', () => {
    it('divides when both sides are present', () => {
        expect(costPer(10000, 4)).toBe(2500)
    })

    it('is null, never zero, when there is no spend — a ₹0 reads as free', () => {
        expect(costPer(0, 250)).toBeNull()
    })

    it('is null when the denominator is zero', () => {
        expect(costPer(10000, 0)).toBeNull()
    })
})
