import { deriveReport } from '@/lib/buyer/derive'
import type { BuyerFacts, LeadFact } from '@/lib/buyer/facts'
import { EMPTY_FILTERS } from '@/lib/buyer/filters'
import { describe, expect, it } from 'vitest'

// The Target vs Actuals table runs on the reporting QUARTER, 1 Jul - 30 Sep, and nothing
// earlier. This matters because the WoW charts beside it label their first bar "29 Jun" —
// that is the Monday its week starts on, not a claim that 29-30 June are counted. The growth
// team asked on 2026-09-16 for those two days to be excluded from the table; they already
// were, and this test is here so they stay that way.

function lead(id: string, createdAt: string): LeadFact {
    return {
        id, name: id, status: 'Qualified', statusFolded: 'Qualified', rawSource: 'Meta',
        sourceLabel: 'Meta', channel: 'Paid Ads', createdAt, clusters: ['PAV'], clusterPrimary: 'PAV',
        micromarkets: ['Powai'], micromarketPrimary: 'Powai', notQualifiedReason: null, isQualified: true,
        hasWarmBid: false, responseAt: null, utmChannel: null, acefoneLeadId: null, phoneKey: '',
        dedupKey: `id:${id}`, isPrimary: true, inPopulation: true, inPipeline: false,
        attributedSource: '', attributedChannel: null, attributedMicromarket: null, attributedAt: null,
        hasAttribution: false,
    }
}

const facts: BuyerFacts = {
    leads: [
        lead('JUN29', '2026-06-29T10:00:00+05:30'),
        lead('JUN30', '2026-06-30T10:00:00+05:30'),
        lead('JUL01', '2026-07-01T10:00:00+05:30'),
        lead('JUL02', '2026-07-02T10:00:00+05:30'),
    ],
    visits: [], conversions: [], soldBids: [], visitSplit: [], houses: [],
    lshTouches: [
        { leadId: 'JUN29', timestamp: '2026-06-29T10:00:00+05:30' },
        { leadId: 'JUN30', timestamp: '2026-06-30T10:00:00+05:30' },
        { leadId: 'JUL01', timestamp: '2026-07-01T10:00:00+05:30' },
    ],
    spend: [], bidSources: [],
    spendIngest: {
        origin: 'snapshot',
        status: 'ok', error: null, rowsRead: 0, rowsKept: 0, droppedBadDate: 0,
        droppedBadSpend: 0, unmappedSources: [], unknownMicromarkets: [], builtAt: null,
    },
    windowStart: '2026-07-01T00:00:00+05:30',
    windowEnd: '2026-10-01T00:00:00+05:30',
}

const report = deriveReport(facts, {
    quarterStart: new Date('2026-07-01T00:00:00+05:30'),
    quarterEnd: new Date('2026-10-01T00:00:00+05:30'),
    now: new Date('2026-09-16T12:00:00+05:30'),
    filters: EMPTY_FILTERS,
})
const qtd = (metric: string) => report.twoWeekTable.find((r) => r.metric === metric)!.qAchieved

describe('Target vs Actuals quarter window', () => {
    it('counts leads from 1 Jul only, never 29-30 June', () => {
        expect(qtd('Total Unique Leads')).toBe(2) // JUL01, JUL02 — not JUN29/JUN30
    })

    it('windows the LSH row on the touch date, also from 1 Jul only', () => {
        expect(qtd('Total Leads (LSH)')).toBe(1) // the 1 Jul touch alone
    })

    it("labels the first chart bucket by its Monday, while counting only the quarter's days", () => {
        // The label says 29 Jun because that is when the week starts; the count proves the
        // June days are not in it. Reading the label as a date range is the trap here.
        expect(report.leadsBySource[0]!.weekLabel).toBe('29 Jun')
        expect(report.leadsBySource[0]!.counts).toEqual({ Meta: 2 })
    })
})
