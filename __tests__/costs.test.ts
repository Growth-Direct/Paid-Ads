import { computeSpendForWindow } from '@/lib/buyer/costs'
import type { BuyerFacts, SpendFact } from '@/lib/buyer/facts'
import { EMPTY_FILTERS } from '@/lib/buyer/filters'
import { describe, expect, it } from 'vitest'

const ISO = (m: number, d: number) => `2026-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T09:00:00+05:30`

function spend(channel: SpendFact['channel'], micromarket: string | null, spendInr: number, date = ISO(8, 5)): SpendFact {
    return { date, channel, micromarket, rawSource: channel === 'Paid Ads' ? 'meta' : '3p', spendInr, impressions: 0, clicks: 0 }
}

function facts(spendRows: SpendFact[]): BuyerFacts {
    return {
        leads: [],
        visits: [],
        conversions: [],
        soldBids: [],
        visitSplit: [],
        houses: [],
        lshTouches: [],
        spend: spendRows,
        bidSources: [],
        spendIngest: {
            origin: 'snapshot',
            status: 'ok',
            error: null,
            rowsRead: 0,
            rowsKept: 0,
            droppedBadDate: 0,
            droppedBadSpend: 0,
            unmappedSources: [],
            unknownMicromarkets: [],
            builtAt: null,
        },
        windowStart: ISO(7, 1),
        windowEnd: '2026-10-01T00:00:00+05:30',
    }
}

const quarterStart = new Date('2026-07-01T00:00:00+05:30')
const quarterEnd = new Date('2026-10-01T00:00:00+05:30')

describe('computeSpendForWindow', () => {
    it('sums every spend row inside the window', () => {
        const f = facts([spend('Paid Ads', 'Powai', 1000), spend('3P', 'Glasgow', 2000)])
        expect(computeSpendForWindow(f, EMPTY_FILTERS, quarterStart, quarterEnd)).toBe(3000)
    })

    it('excludes rows outside the window', () => {
        const f = facts([spend('Paid Ads', 'Powai', 1000, ISO(3, 1))])
        expect(computeSpendForWindow(f, EMPTY_FILTERS, quarterStart, quarterEnd)).toBe(0)
    })

    it('filters by channel', () => {
        const f = facts([spend('Paid Ads', 'Powai', 1000), spend('3P', 'Glasgow', 2000)])
        expect(computeSpendForWindow(f, { ...EMPTY_FILTERS, channels: ['Paid Ads'] }, quarterStart, quarterEnd)).toBe(1000)
    })

    it('excludes unallocated (no-micromarket) spend under a micromarket filter', () => {
        const f = facts([spend('Paid Ads', 'Powai', 1000), spend('3P', null, 4000)])
        expect(computeSpendForWindow(f, EMPTY_FILTERS, quarterStart, quarterEnd)).toBe(5000) // unallocated included
        expect(
            computeSpendForWindow(f, { ...EMPTY_FILTERS, micromarkets: ['Powai'] }, quarterStart, quarterEnd)
        ).toBe(1000) // 3P unallocated excluded
    })

    it('returns 0 when nothing matches', () => {
        const f = facts([])
        expect(computeSpendForWindow(f, EMPTY_FILTERS, quarterStart, quarterEnd)).toBe(0)
    })
})
