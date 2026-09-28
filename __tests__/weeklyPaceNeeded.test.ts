import { deriveReport } from '@/lib/buyer/derive'
import type { BuyerFacts, LeadFact } from '@/lib/buyer/facts'
import { EMPTY_FILTERS } from '@/lib/buyer/filters'
import { targetsFor } from '@/lib/buyer/targets'
import { describe, expect, it } from 'vitest'

// Weekly Pace Needed replaced the old hand-typed "Next 2wk Target" (2026-09-29): what's
// required per week, every week, for the rest of the REAL quarter (never the Time filter's
// window) to land on the full quarter target. (qTargetFull − QTD achieved) ÷ weeks remaining.

function lead(id: string, createdAt: string): LeadFact {
    return {
        id, name: id, status: 'Qualified', statusFolded: 'Qualified', rawSource: 'Meta',
        sourceLabel: 'Meta', channel: 'Paid Ads', createdAt, clusters: ['PAV'], clusterPrimary: 'PAV',
        micromarkets: ['Powai'], micromarketPrimary: 'Powai', notQualifiedReason: null, isQualified: true,
        hasWarmBid: false, responseAt: null, utmChannel: null, acefoneLeadId: null, phoneKey: '',
        dedupKey: `id:${id}`, isPrimary: true, inPopulation: true, inPipeline: false,
        attributedSource: '', attributedChannel: null, attributedMicromarket: null, attributedAt: null,
        hasAttribution: false, attributedCampaign: '', attributedAdSet: '', attributedAd: '', attributedProperty: '',
    }
}

function baseFacts(leads: LeadFact[]): BuyerFacts {
    return {
        leads,
        visits: [], conversions: [], soldBids: [], visitSplit: [], houses: [], lshTouches: [],
        spend: [], bidSources: [],
        spendIngest: {
            origin: 'snapshot',
            status: 'ok', error: null, rowsRead: 0, rowsKept: 0, droppedBadDate: 0,
            droppedBadSpend: 0, unmappedSources: [], unknownMicromarkets: [], builtAt: null,
        },
        windowStart: '2026-07-01T00:00:00+05:30',
        windowEnd: '2026-10-01T00:00:00+05:30',
    }
}

const QUARTER = {
    quarterStart: new Date('2026-07-01T00:00:00+05:30'),
    quarterEnd: new Date('2026-10-01T00:00:00+05:30'),
}

describe('weeklyPaceNeeded', () => {
    it('is (full quarter target − QTD achieved) ÷ weeks remaining in the REAL quarter', () => {
        const facts = baseFacts([lead('A', '2026-07-01T10:00:00+05:30'), lead('B', '2026-07-02T10:00:00+05:30')])
        const report = deriveReport(facts, { ...QUARTER, now: new Date('2026-09-16T12:00:00+05:30'), filters: EMPTY_FILTERS })
        const row = report.twoWeekTable.find((r) => r.metric === 'Total Unique Leads')!
        const fullTarget = targetsFor({})!.leads // ALL-channel, ALL-micromarket row = 7754
        const weeksRemaining = (QUARTER.quarterEnd.getTime() - new Date('2026-09-16T12:00:00+05:30').getTime()) / 86400000 / 7
        expect(row.qAchieved).toBe(2)
        expect(row.weeklyPaceNeeded).toBeCloseTo((fullTarget - 2) / weeksRemaining, 1)
    })

    it('is null for rate metrics (%, cost-per-X) — they do not accumulate', () => {
        const facts = baseFacts([lead('A', '2026-07-01T10:00:00+05:30')])
        const report = deriveReport(facts, { ...QUARTER, now: new Date('2026-09-16T12:00:00+05:30'), filters: EMPTY_FILTERS })
        for (const metric of ['LTQL %', 'QL-V %', 'Visit Duplication Rate', 'Ever Warm %', 'CPL', 'CPQL', 'CPV', 'CAC']) {
            const row = report.twoWeekTable.find((r) => r.metric === metric)!
            expect(row.weeklyPaceNeeded).toBeNull()
        }
    })

    it('is null for a metric with no target-grid entry at all', () => {
        const facts = baseFacts([lead('A', '2026-07-01T10:00:00+05:30')])
        const report = deriveReport(facts, { ...QUARTER, now: new Date('2026-09-16T12:00:00+05:30'), filters: EMPTY_FILTERS })
        const row = report.twoWeekTable.find((r) => r.metric === 'Total Leads (LSH)')!
        expect(row.weeklyPaceNeeded).toBeNull()
    })

    it('floors at 0 rather than going negative once already past the full quarter target', () => {
        // A large enough burst on day one blows past any real single-micromarket target
        // (Powai's own ALL-channel target is 1695 for the whole quarter) instantly.
        const manyLeads = Array.from({ length: 2000 }, (_, i) => lead(`L${i}`, '2026-07-01T10:00:00+05:30'))
        const facts = baseFacts(manyLeads)
        const report = deriveReport(facts, {
            ...QUARTER,
            now: new Date('2026-07-02T12:00:00+05:30'),
            filters: { ...EMPTY_FILTERS, micromarkets: ['Powai'] },
        })
        const row = report.twoWeekTable.find((r) => r.metric === 'Total Unique Leads')!
        expect(row.qTargetFull).toBeLessThan(2000)
        expect(row.weeklyPaceNeeded).toBe(0)
    })

    it('is null once the quarter has fully ended (no weeks remaining)', () => {
        const facts = baseFacts([lead('A', '2026-07-01T10:00:00+05:30')])
        const report = deriveReport(facts, { ...QUARTER, now: new Date('2026-10-05T12:00:00+05:30'), filters: EMPTY_FILTERS })
        const row = report.twoWeekTable.find((r) => r.metric === 'Total Unique Leads')!
        expect(row.weeklyPaceNeeded).toBeNull()
    })
})
