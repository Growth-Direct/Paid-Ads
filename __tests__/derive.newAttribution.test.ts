import { deriveReport } from '@/lib/buyer/derive'
import type { BuyerFacts, LeadFact, LshTouchFact } from '@/lib/buyer/facts'
import { EMPTY_FILTERS } from '@/lib/buyer/filters'
import { describe, expect, it } from 'vitest'

// Coverage for the FIVE new dimension pairs added 2026-09-23 (Campaign/AdSet/Ad/Property/
// Micromarket x Leads/Qualified), sourced from LeadFact's attributedCampaign/attributedAdSet/
// attributedAd/attributedProperty (first-touch Lead_Source_History) and micromarketPrimary.
// See derive.golden.test.ts for the ORIGINAL twelve cards' own characterisation test — this
// file is deliberately separate, per that file's fixture comment.

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

const ISO = (m: number, d: number) => `2026-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T09:00:00+05:30`

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

function baseFacts(leads: LeadFact[], lshTouches: LshTouchFact[] = []): BuyerFacts {
    return {
        leads,
        visits: [],
        conversions: [],
        soldBids: [],
        visitSplit: [],
        houses: [],
        lshTouches,
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
        windowStart: ISO(7, 1),
        windowEnd: '2026-10-01T00:00:00+05:30',
    }
}

const opts = {
    quarterStart: new Date('2026-07-01T00:00:00+05:30'),
    quarterEnd: new Date('2026-10-01T00:00:00+05:30'),
    now: new Date('2026-08-15T12:00:00+05:30'),
    filters: EMPTY_FILTERS,
}

function sumSeries(points: { counts: Partial<Record<string, number>> }[], key: string): number {
    return points.reduce((s, p) => s + (p.counts[key] ?? 0), 0)
}

describe('Leads/Qualified by Campaign/AdSet/Ad/Property/Micromarket (2026-09-23)', () => {
    it('buckets a lead with real attribution under its own value, for both Leads and Qualified', () => {
        const leads = [
            lead({
                createdAt: ISO(7, 5),
                isQualified: true,
                attributedCampaign: 'Meta_TOF_Buyer_Powai',
                attributedAdSet: 'Powai_LAL',
                attributedAd: 'Ad_Video_Powai',
                attributedProperty: '1802 - K L Astoria',
                micromarketPrimary: 'Powai',
            }),
        ]
        const report = deriveReport(baseFacts(leads), opts)
        expect(sumSeries(report.leadsByCampaign, 'Meta_TOF_Buyer_Powai')).toBe(1)
        expect(sumSeries(report.qualifiedByCampaign, 'Meta_TOF_Buyer_Powai')).toBe(1)
        expect(sumSeries(report.leadsByAdSet, 'Powai_LAL')).toBe(1)
        expect(sumSeries(report.leadsByAd, 'Ad_Video_Powai')).toBe(1)
        expect(sumSeries(report.leadsByProperty, '1802 - K L Astoria')).toBe(1)
        expect(sumSeries(report.leadsByMicromarket, 'Powai')).toBe(1)
        expect(sumSeries(report.qualifiedByMicromarket, 'Powai')).toBe(1)
    })

    it('never drops a lead with no ad-campaign attribution — buckets it under Not Applicable, not silently', () => {
        // A real, expected case (Direct/CP/organic/referral touches), not a data gap —
        // verified live 2026-09-23, ~27% of first-touch rows have no campaign at all.
        const leads = [lead({ createdAt: ISO(7, 5), attributedCampaign: '', attributedAdSet: '', attributedAd: '' })]
        const report = deriveReport(baseFacts(leads), opts)
        expect(sumSeries(report.leadsByCampaign, 'Not Applicable')).toBe(1)
        expect(sumSeries(report.leadsByAdSet, 'Not Applicable')).toBe(1)
        expect(sumSeries(report.leadsByAd, 'Not Applicable')).toBe(1)
    })

    it('never drops a lead with no attributed property — buckets it under Unmapped', () => {
        const leads = [lead({ createdAt: ISO(7, 5), attributedProperty: '' })]
        const report = deriveReport(baseFacts(leads), opts)
        expect(sumSeries(report.leadsByProperty, 'Unmapped')).toBe(1)
    })

    it('never drops a lead with no micromarket — buckets it under Unknown, same convention as the visit pipeline', () => {
        const leads = [lead({ createdAt: ISO(7, 5), micromarkets: [], micromarketPrimary: '' })]
        const report = deriveReport(baseFacts(leads), opts)
        expect(sumSeries(report.leadsByMicromarket, 'Unknown')).toBe(1)
    })

    it('only counts a Not-Qualified lead in Leads-by-X, never in Qualified-by-X', () => {
        const leads = [
            lead({ createdAt: ISO(7, 5), isQualified: false, status: 'Not Qualified', attributedCampaign: 'CampaignA' }),
        ]
        const report = deriveReport(baseFacts(leads), opts)
        expect(sumSeries(report.leadsByCampaign, 'CampaignA')).toBe(1)
        expect(sumSeries(report.qualifiedByCampaign, 'CampaignA')).toBe(0)
    })

    it('excludes a lead outside the population, same gate as every other card', () => {
        const leads = [lead({ createdAt: ISO(7, 5), inPopulation: false, attributedCampaign: 'CampaignA' })]
        const report = deriveReport(baseFacts(leads), opts)
        expect(sumSeries(report.leadsByCampaign, 'CampaignA')).toBe(0)
    })

    it('lshExtraByDimension counts every touch, not every lead — a re-enquiry counts twice', () => {
        const leads = [lead({ id: 'L1', createdAt: ISO(7, 5) })]
        const lshTouches = [
            touch({ leadId: 'L1', timestamp: ISO(7, 5), campaign: 'CampaignA', leadStatus: 'Unassigned' }),
            // Same lead, re-enquires later in the window under the same campaign
            touch({ leadId: 'L1', timestamp: ISO(7, 20), campaign: 'CampaignA', leadStatus: 'Qualified' }),
        ]
        const report = deriveReport(baseFacts(leads, lshTouches), opts)
        const extra = report.lshExtraByDimension.campaign['CampaignA']
        expect(extra?.nonUniqueCount).toBe(2)
        expect(extra?.statusBreakdown).toEqual({ Unassigned: 1, Qualified: 1 })
    })

    it('lshExtraByDimension excludes a touch whose lead fails the active filters, same leadMatches gate as totalLeadsRaw', () => {
        // Same convention as computeFunnelActuals' totalLeadsRaw: a touch does NOT require
        // inPopulation (see derive.golden.test.ts's OLD1 fixture — a re-enquiry outside the
        // population still counts as a real touch). It DOES require leadMatches(filters).
        const leads = [lead({ id: 'L1', createdAt: ISO(7, 5), clusters: ['PAV'], clusterPrimary: 'PAV' })]
        const lshTouches = [touch({ leadId: 'L1', timestamp: ISO(7, 5), campaign: 'CampaignA' })]
        const filtered = { ...opts, filters: { ...EMPTY_FILTERS, clusters: ['GLAM'] } }
        const report = deriveReport(baseFacts(leads, lshTouches), filtered)
        expect(report.lshExtraByDimension.campaign['CampaignA']).toBeUndefined()
    })

    it('lshExtraByDimension is separate from the unique Leads-by-Campaign chart — it is not part of the funnel', () => {
        const leads = [lead({ id: 'L1', createdAt: ISO(7, 5), attributedCampaign: 'CampaignA' })]
        const lshTouches = [
            touch({ leadId: 'L1', timestamp: ISO(7, 5), campaign: 'CampaignA' }),
            touch({ leadId: 'L1', timestamp: ISO(7, 20), campaign: 'CampaignA' }),
        ]
        const report = deriveReport(baseFacts(leads, lshTouches), opts)
        // The unique funnel chart still counts one lead...
        expect(sumSeries(report.leadsByCampaign, 'CampaignA')).toBe(1)
        // ...while the extra info counts both touches.
        expect(report.lshExtraByDimension.campaign['CampaignA']?.nonUniqueCount).toBe(2)
    })

    it('caps Campaign/AdSet/Ad/Property to their top MAX_ATTRIBUTION_SERIES values, folding the rest into Other', () => {
        // 20 distinct campaigns, one lead each — well over the cap, which must fold the
        // long tail rather than render 20 separate stacked-bar series.
        const leads = Array.from({ length: 20 }, (_, i) =>
            lead({ createdAt: ISO(7, 5), attributedCampaign: `Campaign${i}` })
        )
        const report = deriveReport(baseFacts(leads), opts)
        const keys = new Set(report.leadsByCampaign.flatMap((p) => Object.keys(p.counts)))
        expect(keys.size).toBeLessThanOrEqual(16) // 15 kept + "Other Campaigns"
        expect(keys.has('Other Campaigns')).toBe(true)
        const total = report.leadsByCampaign.reduce(
            (s, p) => s + Object.values(p.counts).reduce((a: number, n) => a + (n ?? 0), 0),
            0
        )
        expect(total).toBe(20) // every lead still counted somewhere, none dropped
    })

    it('never caps Micromarket, whose cardinality is already small and bounded', () => {
        const leads = Array.from({ length: 20 }, (_, i) =>
            lead({ createdAt: ISO(7, 5), micromarketPrimary: `Micromarket${i}` })
        )
        const report = deriveReport(baseFacts(leads), opts)
        const keys = new Set(report.leadsByMicromarket.flatMap((p) => Object.keys(p.counts)))
        expect(keys.size).toBe(20)
        expect(keys.has('Other')).toBe(false)
    })

    it('folds the SAME campaigns into Other on both Leads and Qualified charts, ranked by Leads volume', () => {
        // Campaign0..14 (15, at the cap) get 2 leads each; Campaign15..19 (5, over the cap)
        // get 1 qualified lead each — by count of LEADS they rank below the top 15, so they
        // must fold on the Qualified chart too, even though every one of them is qualified.
        const leads = [
            ...Array.from({ length: 15 }, (_, i) => [
                lead({ createdAt: ISO(7, 5), attributedCampaign: `Campaign${i}`, isQualified: false }),
                lead({ createdAt: ISO(7, 6), attributedCampaign: `Campaign${i}`, isQualified: false }),
            ]).flat(),
            ...Array.from({ length: 5 }, (_, i) =>
                lead({ createdAt: ISO(7, 5), attributedCampaign: `Campaign${15 + i}`, isQualified: true })
            ),
        ]
        const report = deriveReport(baseFacts(leads), opts)
        const qualifiedKeys = new Set(report.qualifiedByCampaign.flatMap((p) => Object.keys(p.counts)))
        expect(qualifiedKeys.has('Campaign15')).toBe(false)
        expect(qualifiedKeys.has('Other Campaigns')).toBe(true)
        expect(sumSeries(report.qualifiedByCampaign, 'Other Campaigns')).toBe(5)
    })

    it('changing only attribution fields never changes any of the original twelve cards', () => {
        // The hard guardrail derive.golden.test.ts documents: the twelve original cards must
        // never read attributedSource/attributedChannel/attributedMicromarket/attributedAt,
        // and now must never read attributedCampaign/attributedAdSet/attributedAd/
        // attributedProperty either. Prove it mechanically: two fact sets differing ONLY in
        // attribution fields must produce byte-identical output once the ten new keys this
        // PR added are stripped out.
        const NEW_KEYS = [
            'leadsByCampaign',
            'qualifiedByCampaign',
            'leadsByAdSet',
            'qualifiedByAdSet',
            'leadsByAd',
            'qualifiedByAd',
            'leadsByProperty',
            'qualifiedByProperty',
            'leadsByMicromarket',
            'qualifiedByMicromarket',
            'lshExtraByDimension',
        ] as const

        const stripNew = (report: ReturnType<typeof deriveReport>) => {
            const copy = { ...report } as Record<string, unknown>
            for (const k of NEW_KEYS) delete copy[k]
            return copy
        }

        const before = lead({
            createdAt: ISO(7, 5),
            attributedCampaign: '',
            attributedAdSet: '',
            attributedAd: '',
            attributedProperty: '',
        })
        const after = {
            ...before,
            attributedCampaign: 'SomeCampaign',
            attributedAdSet: 'SomeAdSet',
            attributedAd: 'SomeAd',
            attributedProperty: 'Some Property',
        }

        const reportBefore = stripNew(deriveReport(baseFacts([before]), opts))
        const reportAfter = stripNew(deriveReport(baseFacts([after]), opts))
        expect(reportAfter).toEqual(reportBefore)
    })

    it('a Campaign filter changes WHO is counted, never what bucket they land in', () => {
        // Added 2026-09-23 alongside the Attribution filter dropdowns. leadMatches now
        // checks attributedCampaign, but that is a FILTER (does this lead count at all),
        // not a change to the twelve cards' own bucketing (which key a counted lead lands
        // under) — that distinction is the whole point of the guardrail. Two leads, same
        // real source, different campaigns: filtering to one campaign must drop the OTHER
        // lead entirely, but the one that remains must still bucket under its own real
        // sourceLabel, not something derived from the campaign.
        const leads = [
            lead({ createdAt: ISO(7, 5), rawSource: 'Meta', sourceLabel: 'Meta', attributedCampaign: 'CampaignA' }),
            lead({ createdAt: ISO(7, 5), rawSource: 'Meta', sourceLabel: 'Meta', attributedCampaign: 'CampaignB' }),
        ]
        const unfiltered = deriveReport(baseFacts(leads), opts)
        expect(sumSeries(unfiltered.leadsBySource, 'Meta')).toBe(2)

        const filtered = deriveReport(baseFacts(leads), {
            ...opts,
            filters: { ...EMPTY_FILTERS, campaigns: ['CampaignA'] },
        })
        // Population shrank to one lead...
        expect(sumSeries(filtered.leadsBySource, 'Meta')).toBe(1)
        // ...but the one that remains is still bucketed under its real source label, not a
        // campaign-derived one, and no new "CampaignA" bucket appeared on leadsBySource.
        const sourceKeys = new Set(filtered.leadsBySource.flatMap((p) => Object.keys(p.counts)))
        expect(sourceKeys).toEqual(new Set(['Meta']))
    })
})
