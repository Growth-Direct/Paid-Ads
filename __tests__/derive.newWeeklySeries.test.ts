import { deriveReport } from '@/lib/buyer/derive'
import type { BuyerFacts, LeadFact, LshTouchFact, SpendFact, VisitFact } from '@/lib/buyer/facts'
import { EMPTY_FILTERS } from '@/lib/buyer/filters'
import { describe, expect, it } from 'vitest'

// Coverage for the growth team's 2026-09-26 page-reorder request's genuinely NEW series:
// LSH Count/Qualified Count WoW trends, the "(Visit based on created time)" visit variants,
// and the WoW CPL/CPQL/CPV cost-per-week charts. See derive.golden.test.ts for the ORIGINAL
// twelve cards' own characterisation test, and derive.newAttribution.test.ts for the
// Campaign/AdSet/Ad/Property/Micromarket series — this file is deliberately separate, same
// reasoning as that file's own comment.

let seq = 0
function lead(p: Partial<LeadFact> & { createdAt: string }): LeadFact {
    seq += 1
    const id = p.id ?? `L${seq}`
    return {
        id,
        name: `Lead ${id}`,
        status: p.status ?? 'Qualified',
        statusFolded: p.statusFolded ?? p.status ?? 'Qualified',
        rawSource: p.rawSource ?? 'Meta',
        sourceLabel: p.sourceLabel ?? 'Meta',
        channel: p.channel ?? 'Paid Ads',
        createdAt: p.createdAt,
        clusters: p.clusters ?? ['PAV'],
        clusterPrimary: p.clusterPrimary ?? 'PAV',
        micromarkets: p.micromarkets ?? ['Powai'],
        micromarketPrimary: p.micromarketPrimary ?? 'Powai',
        notQualifiedReason: p.notQualifiedReason ?? null,
        isQualified: p.isQualified ?? true,
        hasWarmBid: p.hasWarmBid ?? false,
        responseAt: p.responseAt ?? null,
        utmChannel: p.utmChannel ?? null,
        acefoneLeadId: p.acefoneLeadId ?? null,
        phoneKey: p.phoneKey ?? '',
        dedupKey: p.dedupKey ?? `id:${id}`,
        isPrimary: p.isPrimary ?? true,
        inPopulation: p.inPopulation ?? true,
        inPipeline: p.inPipeline ?? false,
        attributedSource: p.attributedSource ?? '',
        attributedChannel: p.attributedChannel ?? null,
        attributedMicromarket: p.attributedMicromarket ?? null,
        attributedAt: p.attributedAt ?? null,
        hasAttribution: p.hasAttribution ?? false,
        attributedCampaign: p.attributedCampaign ?? '',
        attributedAdSet: p.attributedAdSet ?? '',
        attributedAd: p.attributedAd ?? '',
        attributedProperty: p.attributedProperty ?? '',
    }
}

function touch(p: Partial<LshTouchFact> & { leadId: string; timestamp: string }): LshTouchFact {
    return {
        campaign: '',
        adSet: '',
        ad: '',
        property: '',
        micromarket: '',
        leadStatus: '',
        ...p,
    }
}

function visit(p: Partial<VisitFact> & { leadId: string; startAt: string; leadCreatedAt: string }): VisitFact {
    return {
        eventId: p.eventId ?? `E${Math.random()}`,
        eventMicromarket: p.eventMicromarket ?? 'Powai',
        channel: p.channel ?? 'Paid Ads',
        sourceLabel: p.sourceLabel ?? 'Meta',
        leadClusters: p.leadClusters ?? ['PAV'],
        leadMicromarkets: p.leadMicromarkets ?? ['Powai'],
        propertyId: p.propertyId ?? 'PROP1',
        ...p,
    }
}

function spend(p: Partial<SpendFact> & { date: string; spendInr: number }): SpendFact {
    return {
        channel: p.channel ?? 'Paid Ads',
        micromarket: p.micromarket ?? 'Powai',
        rawSource: p.rawSource ?? 'meta',
        impressions: p.impressions ?? 0,
        clicks: p.clicks ?? 0,
        ...p,
    }
}

function baseFacts(over: Partial<BuyerFacts> = {}): BuyerFacts {
    return {
        leads: [],
        visits: [],
        conversions: [],
        soldBids: [],
        visitSplit: [],
        houses: [],
        lshTouches: [],
        spend: [],
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
        windowStart: '2026-07-01T00:00:00+05:30',
        windowEnd: '2026-10-01T00:00:00+05:30',
        ...over,
    }
}

const opts = {
    quarterStart: new Date('2026-07-01T00:00:00+05:30'),
    quarterEnd: new Date('2026-10-01T00:00:00+05:30'),
    now: new Date('2026-08-15T12:00:00+05:30'),
    filters: EMPTY_FILTERS,
}

function sumSeries(points: { counts: Partial<Record<string, number>> }[]): number {
    return points.reduce((s: number, p) => s + Object.values(p.counts).reduce((a: number, n) => a + (n ?? 0), 0), 0)
}

describe('WoW Leads (LSH) / Qualified Leads (LSH) — added 2026-09-26', () => {
    it('counts every touch for lshCountByWeek, and only Qualified-family touches for lshQualifiedByWeek', () => {
        const leads = [lead({ id: 'L1', createdAt: '2026-07-05T09:00:00+05:30' })]
        const touches = [
            touch({ leadId: 'L1', timestamp: '2026-07-06T09:00:00+05:30', leadStatus: 'Qualified' }),
            touch({ leadId: 'L1', timestamp: '2026-07-06T10:00:00+05:30', leadStatus: 'Attempted to Contact' }),
        ]
        const report = deriveReport(baseFacts({ leads, lshTouches: touches }), opts)
        expect(sumSeries(report.lshCountByWeek)).toBe(2)
        expect(sumSeries(report.lshQualifiedByWeek)).toBe(1)
    })

    it('drops a touch whose lead never resolves (not in the population), same gate as totalLeadsRaw', () => {
        const touches = [touch({ leadId: 'GHOST', timestamp: '2026-07-06T09:00:00+05:30', leadStatus: 'Qualified' })]
        const report = deriveReport(baseFacts({ lshTouches: touches }), opts)
        expect(sumSeries(report.lshCountByWeek)).toBe(0)
        expect(sumSeries(report.lshQualifiedByWeek)).toBe(0)
    })

    it('respects the current filters, same as lshExtraByDimension', () => {
        const leads = [lead({ id: 'L1', createdAt: '2026-07-05T09:00:00+05:30', channel: '3P', sourceLabel: '99Acres' })]
        const touches = [touch({ leadId: 'L1', timestamp: '2026-07-06T09:00:00+05:30', leadStatus: 'Qualified' })]
        const filtered = deriveReport(baseFacts({ leads, lshTouches: touches }), {
            ...opts,
            filters: { ...EMPTY_FILTERS, channels: ['Paid Ads'] },
        })
        expect(sumSeries(filtered.lshCountByWeek)).toBe(0)
    })
})

describe('Visit variants "(by Lead Created Week)" — added 2026-09-26', () => {
    it('buckets by the LEAD created week, not the visit week — differs from the visit-week series when they land in different weeks', () => {
        const leads = [lead({ id: 'L1', createdAt: '2026-07-05T09:00:00+05:30' })]
        // Created in the week of Jun 29, but the visit itself happens weeks later (Jul 20).
        const visits = [visit({ leadId: 'L1', startAt: '2026-07-20T09:00:00+05:30', leadCreatedAt: '2026-07-05T09:00:00+05:30' })]
        const report = deriveReport(baseFacts({ leads, visits }), opts)

        const createdWeekIdx = report.uniqueVisitsByLeadCreatedWeek.findIndex((p) => Object.keys(p.counts).length > 0)
        const visitWeekIdx = report.uniqueVisitsBySource.findIndex((p) => Object.keys(p.counts).length > 0)
        expect(createdWeekIdx).toBeGreaterThanOrEqual(0)
        expect(visitWeekIdx).toBeGreaterThanOrEqual(0)
        expect(createdWeekIdx).not.toBe(visitWeekIdx)
        expect(sumSeries(report.uniqueVisitsByLeadCreatedWeek)).toBe(1)
        expect(sumSeries(report.uniqueGrossVisitsByLeadCreatedWeek)).toBe(1)
    })

    it('dedupes on person, same as the visit-week series — two visits by the same lead in the same created week count once', () => {
        const leads = [lead({ id: 'L1', createdAt: '2026-07-05T09:00:00+05:30', dedupKey: 'phone1' })]
        const visits = [
            visit({ leadId: 'L1', startAt: '2026-07-06T09:00:00+05:30', leadCreatedAt: '2026-07-05T09:00:00+05:30', propertyId: 'PROP1' }),
            visit({ leadId: 'L1', startAt: '2026-07-08T09:00:00+05:30', leadCreatedAt: '2026-07-05T09:00:00+05:30', propertyId: 'PROP1' }),
        ]
        const report = deriveReport(baseFacts({ leads, visits }), opts)
        expect(sumSeries(report.uniqueVisitsByLeadCreatedWeek)).toBe(1)
        // Gross dedupes on person+property — same property twice still counts once.
        expect(sumSeries(report.uniqueGrossVisitsByLeadCreatedWeek)).toBe(1)
    })

    it('gross dedupe counts a different property again, same as the visit-week series', () => {
        const leads = [lead({ id: 'L1', createdAt: '2026-07-05T09:00:00+05:30', dedupKey: 'phone1' })]
        const visits = [
            visit({ leadId: 'L1', startAt: '2026-07-06T09:00:00+05:30', leadCreatedAt: '2026-07-05T09:00:00+05:30', propertyId: 'PROP1' }),
            visit({ leadId: 'L1', startAt: '2026-07-08T09:00:00+05:30', leadCreatedAt: '2026-07-05T09:00:00+05:30', propertyId: 'PROP2' }),
        ]
        const report = deriveReport(baseFacts({ leads, visits }), opts)
        expect(sumSeries(report.uniqueVisitsByLeadCreatedWeek)).toBe(1)
        expect(sumSeries(report.uniqueGrossVisitsByLeadCreatedWeek)).toBe(2)
    })
})

describe('WoW CPL/CPQL/CPV — added 2026-09-26', () => {
    it('divides that week\'s spend by that week\'s Lead/Qualified/Visit count', () => {
        const leads = [
            lead({ id: 'L1', createdAt: '2026-07-06T09:00:00+05:30', isQualified: true }),
            lead({ id: 'L2', createdAt: '2026-07-06T09:00:00+05:30', isQualified: false }),
        ]
        const visits = [visit({ leadId: 'L1', startAt: '2026-07-08T09:00:00+05:30', leadCreatedAt: '2026-07-06T09:00:00+05:30' })]
        const spendRows = [spend({ date: '2026-07-06', spendInr: 1000 })]
        const report = deriveReport(baseFacts({ leads, visits, spend: spendRows }), opts)

        const cplWeek = report.cplByWeek.find((p) => p.value != null)
        const cpqlWeek = report.cpqlByWeek.find((p) => p.value != null)
        const cpvWeek = report.cpvByWeek.find((p) => p.value != null)
        expect(cplWeek?.value).toBe(500) // 1000 / 2 leads
        expect(cpqlWeek?.value).toBe(1000) // 1000 / 1 qualified lead
        expect(cpvWeek?.value).toBe(1000) // 1000 / 1 unique visit (by created week)
    })

    it('is null, not zero, for a week with spend but no leads', () => {
        const spendRows = [spend({ date: '2026-07-06', spendInr: 500 })]
        const report = deriveReport(baseFacts({ spend: spendRows }), opts)
        const week = report.cplByWeek.find((p) => p.weekStart <= '2026-07-06' && p.weekStart >= '2026-06-29')
        expect(week?.value).toBeNull()
    })
})
