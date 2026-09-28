import { computeSellerBudgetPacing } from '@/lib/seller/budgetPacing'
import type { SellerFacts, SellerSpendFact } from '@/lib/seller/facts'
import { sellerTargetsFor } from '@/lib/seller/targets'
import { describe, expect, it } from 'vitest'

// The seller-side sibling of __tests__/budgetPacing.test.ts — same coverage, over
// lib/seller/budgetPacing.ts. sellerTargetsFor is the real, unmodified target grid.

function spend(p: Partial<SellerSpendFact> & { date: string; spendInr: number }): SellerSpendFact {
    return {
        channel: p.channel ?? 'Paid Ads',
        micromarket: p.micromarket ?? 'Powai',
        rawSource: p.rawSource ?? 'meta',
        impressions: 0,
        clicks: 0,
        ...p,
    }
}

function baseFacts(spendRows: SellerSpendFact[]): SellerFacts {
    return {
        sellers: [],
        products: [],
        channelPartnerProducts: [],
        channelPartnerPlaces: {},
        spend: spendRows,
        spendIngest: {
            origin: 'snapshot',
            status: 'ok',
            error: null,
            rowsRead: 0,
            rowsKept: 0,
            droppedBadDate: 0,
            droppedBadSpend: 0,
            slashOrder: null,
            unallocatedInr: 0,
            unmappedSources: [],
            unknownMicromarkets: [],
            builtAt: null,
        },
        windowStart: '2026-07-01T00:00:00+05:30',
        windowEnd: '2026-10-01T00:00:00+05:30',
    }
}

const NOW = new Date('2026-08-16T10:00:00+05:30')
const opts = {
    quarterStart: new Date('2026-07-01T00:00:00+05:30'),
    quarterEnd: new Date('2026-10-01T00:00:00+05:30'),
    now: NOW,
}

describe('computeSellerBudgetPacing — row structure', () => {
    it('covers Paid Ads only, per the growth team (2026-09-29) — the live sheet has no other channel\'s spend', () => {
        const { byChannel } = computeSellerBudgetPacing(baseFacts([]), opts)
        expect(byChannel.map((r) => r.label)).toEqual(['Paid Ads'])
    })

    it('builds the same Micromarket/Cluster hierarchy buyer uses, in the same order', () => {
        const { byMicromarket } = computeSellerBudgetPacing(baseFacts([]), opts)
        expect(byMicromarket.map((r) => r.label)).toEqual([
            'Powai',
            'Andheri (E)',
            'Vegas',
            'PAV',
            'Glasgow',
            'Amsterdam',
            'GLAM',
            'Boston',
            'Barcelona',
            'Singapore',
            'BABU (incl. Singapore)',
            'BABU ex Singapore',
            'TOTAL — Truva ex BLR',
            'Bangalore',
            'All MM',
            'TOTAL — Truva inc. BLR',
        ])
    })

    it('"All MM" has no target but counts real spend with no micromarket, and both grand totals include it', () => {
        const spendRows: SellerSpendFact[] = [
            { date: '2026-07-05', spendInr: 1000, micromarket: null, channel: 'Paid Ads', rawSource: 'meta', impressions: 0, clicks: 0 },
        ]
        const { byMicromarket } = computeSellerBudgetPacing(baseFacts(spendRows), opts)
        const allMm = byMicromarket.find((r) => r.label === 'All MM')!
        const exBlr = byMicromarket.find((r) => r.label === 'TOTAL — Truva ex BLR')!
        expect(allMm.quarterBudget).toBeNull()
        expect(allMm.spentTillYesterday).toBe(1000)
        expect(exBlr.spentTillYesterday).toBeGreaterThanOrEqual(1000)
    })

    it('scopes every micromarket budget to Paid Ads, not the blended Overall row', () => {
        const { byMicromarket } = computeSellerBudgetPacing(baseFacts([]), opts)
        const powai = byMicromarket.find((r) => r.label === 'Powai')!
        const paidAdsOnly = sellerTargetsFor({ micromarkets: ['Powai'], channels: ['Paid Ads'] })
        const overall = sellerTargetsFor({ micromarkets: ['Powai'] })
        expect(powai.quarterBudget).toBe(paidAdsOnly.spendInr)
        expect(powai.quarterBudget).not.toBe(overall.spendInr)
    })

    it('"Bangalore" resolves Helsinki+Berlin+Hong Kong to the grid\'s single combined row', () => {
        const { byMicromarket } = computeSellerBudgetPacing(baseFacts([]), opts)
        const bangalore = byMicromarket.find((r) => r.label === 'Bangalore')!
        const direct = sellerTargetsFor({ micromarkets: ['Helsinki', 'Berlin', 'Hong Kong'], channels: ['Paid Ads'] })
        expect(bangalore.quarterBudget).toBe(direct.covered ? direct.spendInr : null)
    })

    it('"Bangalore" actual spend sums Helsinki + Berlin + Hong Kong spend facts', () => {
        const spendRows = [
            spend({ date: '2026-07-05', spendInr: 100, micromarket: 'Helsinki' }),
            spend({ date: '2026-07-05', spendInr: 200, micromarket: 'Berlin' }),
            spend({ date: '2026-07-05', spendInr: 300, micromarket: 'Hong Kong' }),
            spend({ date: '2026-07-05', spendInr: 999, micromarket: 'Powai' }), // must not leak in
        ]
        const { byMicromarket } = computeSellerBudgetPacing(baseFacts(spendRows), opts)
        const bangalore = byMicromarket.find((r) => r.label === 'Bangalore')!
        expect(bangalore.spentTillYesterday).toBe(600)
    })

    it('TOTAL inc. BLR = TOTAL ex BLR + Bangalore', () => {
        const { byMicromarket } = computeSellerBudgetPacing(baseFacts([]), opts)
        const exBlr = byMicromarket.find((r) => r.label === 'TOTAL — Truva ex BLR')!
        const incBlr = byMicromarket.find((r) => r.label === 'TOTAL — Truva inc. BLR')!
        const blr = byMicromarket.find((r) => r.label === 'Bangalore')!
        expect(incBlr.quarterBudget).toBe((exBlr.quarterBudget ?? 0) + (blr.quarterBudget ?? 0))
    })
})

describe('computeSellerBudgetPacing — daily-run-rate math', () => {
    it('paces the quarter budget by days elapsed', () => {
        const { byChannel } = computeSellerBudgetPacing(baseFacts([]), opts)
        const paidAds = byChannel.find((r) => r.label === 'Paid Ads')!
        const target = sellerTargetsFor({ channels: ['Paid Ads'] })
        expect(paidAds.quarterBudget).toBe(target.spendInr)
        // Jul 1 00:00 -> Aug 16 00:00 = 46 days of 92 total -> paceShare = 0.5.
        expect(paidAds.shouldHaveSpentQtd).toBeCloseTo(target.spendInr * 0.5, 0)
    })

    it('"Spent till Yesterday" excludes today\'s row entirely', () => {
        const spendRows = [
            spend({ date: '2026-08-15', spendInr: 5000 }),
            spend({ date: '2026-08-16', spendInr: 999999 }),
        ]
        const { byChannel } = computeSellerBudgetPacing(baseFacts(spendRows), opts)
        const paidAds = byChannel.find((r) => r.label === 'Paid Ads')!
        expect(paidAds.spentTillYesterday).toBe(5000)
    })

    it('is null, not zero, for runway when there is no spend at all', () => {
        const { byChannel } = computeSellerBudgetPacing(baseFacts([]), opts)
        const paidAds = byChannel.find((r) => r.label === 'Paid Ads')!
        expect(paidAds.runwayDays).toBeNull()
        expect(paidAds.pctOfBudgetSpent).toBe(0)
    })
})
