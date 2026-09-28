import type { BidSourceFact, BuyerFacts, SoldBidFact, VisitSplitFact, ConversionFact, HouseFact, LeadFact, LshTouchFact, SpendFact, VisitFact } from '@/lib/buyer/facts'
import { EMPTY_FILTERS } from '@/lib/buyer/filters'
import { mondayOfIST, sourceLabel } from '@/lib/buyer/shared'
import { deriveReport } from '@/lib/buyer/derive'
import { describe, expect, it } from 'vitest'

// Characterisation test for the twelve original cards. Written BEFORE LeadFact gains its
// LSH attribution fields, so the snapshot captures pre-widening behaviour. deriveReport
// must keep producing byte-identical output for those twelve after the fields are added
// and after the bucketing block is extracted to shared.ts. If ANY of the twelve changes,
// the refactor leaked.
//
// derive.ts is reconciled against Metabase and had no coverage; this is also that.
//
// 2026-09-23: the snapshot below gained eleven NEW keys (leadsByCampaign/AdSet/Ad/Property/
// Micromarket and their qualifiedBy* counterparts, plus lshExtraByDimension) — a deliberate
// extension, not a leak. They're computed in derive.ts's own separate loops, reading
// LeadFact's attributedCampaign/attributedAdSet/attributedAd/attributedProperty and
// facts.lshTouches's own campaign/adSet/ad/property/micromarket/leadStatus fields, which
// this fixture otherwise leaves at their empty defaults so nothing here accidentally
// exercises real attribution data. The point of this file is that every ORIGINAL twelve
// key stays byte-identical — check any future diff against exactly that, not against the
// eleven new keys existing at all.

const ISO = (m: number, d: number, h = 9) =>
    `2026-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T${String(h).padStart(2, '0')}:00:00+05:30`

let seq = 0
function lead(p: Partial<LeadFact> & { createdAt: string }): LeadFact {
    seq += 1
    const id = p.id ?? `L${seq}`
    const micromarkets = p.micromarkets ?? ['Powai']
    const clusters = p.clusters ?? ['PAV']
    return {
        id,
        name: p.name ?? `Lead ${id}`,
        status: p.status ?? 'Qualified',
        statusFolded: p.statusFolded ?? p.status ?? 'Qualified',
        rawSource: p.rawSource ?? 'Meta',
        // Through the real normaliser, exactly as aggregate.ts does it, so the fixture
        // can't drift into showing a spelling production would never produce.
        sourceLabel: p.sourceLabel ?? sourceLabel(p.rawSource ?? 'Meta'),
        channel: p.channel ?? 'Paid Ads',
        createdAt: p.createdAt,
        clusters,
        clusterPrimary: p.clusterPrimary ?? clusters[0] ?? 'Unknown',
        micromarkets,
        micromarketPrimary: p.micromarketPrimary ?? micromarkets[0] ?? '',
        notQualifiedReason: p.notQualifiedReason ?? null,
        isQualified: p.isQualified ?? true,
        hasWarmBid: p.hasWarmBid ?? false,
        responseAt: p.responseAt ?? null,
        utmChannel: p.utmChannel ?? null,
        acefoneLeadId: p.acefoneLeadId ?? null,
        // Each fixture lead is its own person unless a test overrides these, so the
        // pre-existing expectations stay about one-record-per-lead.
        phoneKey: p.phoneKey ?? '',
        dedupKey: p.dedupKey ?? `id:${id}`,
        isPrimary: p.isPrimary ?? true,
        inPopulation: p.inPopulation ?? true,
        inPipeline: p.inPipeline ?? false,
        // Attribution fields exist but the ORIGINAL twelve cards below must never read
        // them — left at their empty defaults so the snapshot proves derive ignores them
        // for those twelve. The five NEW attributedCampaign/etc.-driven cards (added
        // 2026-09-23) are exercised separately in derive.newAttribution.test.ts.
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

function visit(
    leadId: string,
    startAt: string,
    mm: string,
    leadCreatedAt: string,
    channel = 'Paid Ads',
    src?: string,
    propertyId = 'default-property'
): VisitFact {
    seq += 1
    return {
        eventId: `E${seq}`,
        startAt,
        eventMicromarket: mm,
        leadId,
        channel: channel as VisitFact['channel'],
        // Defaults to the channel name so the pre-existing fixtures keep their old series
        // keys; the by-source cards are exercised with real source labels in the leads.
        sourceLabel: src ?? channel,
        leadClusters: ['PAV'],
        leadMicromarkets: [mm],
        leadCreatedAt,
        propertyId,
    }
}

const leads: LeadFact[] = [
    // Week of Jun 29 (Jul 1-5): two Paid Ads Powai, one qualified one not
    lead({ createdAt: ISO(7, 1), channel: 'Paid Ads', rawSource: 'Meta' }),
    lead({ createdAt: ISO(7, 2), channel: 'Paid Ads', status: 'Not Qualified', isQualified: false, notQualifiedReason: 'Low budget' }),
    // Week of Jul 6: Organic Glasgow qualified + warm; a telephony-junk status folded
    lead({ createdAt: ISO(7, 7), channel: 'Organic', rawSource: 'Website', clusters: ['GLAM'], micromarkets: ['Glasgow'], hasWarmBid: true }),
    lead({ createdAt: ISO(7, 8), channel: '3P', rawSource: '99acres', status: 'Network Issue', statusFolded: 'Attempted to Contact', isQualified: false }),
    // Week of Jul 20: a multi-cluster lead (primary PAV) qualified
    lead({ createdAt: ISO(7, 21), channel: 'Paid Ads', clusters: ['PAV', 'GLAM'], clusterPrimary: 'PAV', micromarkets: ['Powai', 'Glasgow'], micromarketPrimary: 'Powai' }),
    // A patched-in old lead: not in population, must be ignored by every population card
    lead({ id: 'OLD1', createdAt: ISO(3, 1), inPopulation: false, isQualified: true }),
    // Two pipeline leads (current snapshot, not date-bound)
    lead({ id: 'P1', createdAt: ISO(8, 1), status: 'Site visit Scheduled', inPipeline: true, micromarkets: ['Vegas'], micromarketPrimary: 'Vegas', clusters: ['PAV'] }),
    lead({ id: 'P2', createdAt: ISO(8, 2), status: 'Visit to be scheduled', inPipeline: true, micromarkets: ['Glasgow'], micromarketPrimary: 'Glasgow', clusters: ['GLAM'] }),
]

const visits: VisitFact[] = [
    // New visit: lead created in-quarter
    visit('L1', ISO(7, 10), 'Powai', ISO(7, 1)),
    // Old visit: lead created before the quarter
    visit('OLD1', ISO(7, 12), 'Glasgow', ISO(3, 1), 'Paid Ads'),
    // Same lead visits twice in one week -> counts once that week
    visit('L3', ISO(7, 9), 'Glasgow', ISO(7, 7), 'Organic'),
    visit('L3', ISO(7, 10), 'Glasgow', ISO(7, 7), 'Organic'),
]

const conversions: ConversionFact[] = [
    { dealId: 'D1', leadId: 'L1', mouDate: ISO(8, 1), channel: 'Paid Ads', clusters: ['PAV'], micromarkets: ['Powai'], leadCreatedAt: ISO(7, 1) },
    { dealId: 'D2', leadId: 'OLD1', mouDate: ISO(8, 2), channel: 'Paid Ads', clusters: ['GLAM'], micromarkets: ['Glasgow'], leadCreatedAt: ISO(3, 1) },
]

const houses: HouseFact[] = [
    { house: '101 - A of Powai Tower', clusters: ['PAV'], uniqueVisits: 12, everWarmYes: 4 },
    { house: '202 - B of Glasgow Heights', clusters: ['GLAM'], uniqueVisits: 7, everWarmYes: 1 },
    { house: '303 - Bangalore Test', clusters: ['Unknown'], uniqueVisits: 3, everWarmYes: 0 },
]

function touch(leadId: string, timestamp: string): LshTouchFact {
    return { leadId, timestamp, campaign: '', adSet: '', ad: '', property: '', micromarket: '', leadStatus: '' }
}

const lshTouches = [
    // L1 re-enquires: two touches, one lead -> proves raw counts every touch
    touch('L1', ISO(7, 1)),
    touch('L1', ISO(7, 15)),
    touch('L3', ISO(7, 7)),
    // OLD1 (not in population) re-enquires inside the quarter: still a real touch this
    // quarter, windowed on the touch's own Timestamp, not the lead's Created_Time
    touch('OLD1', ISO(8, 1)),
    // Outside the quarter -> must not be counted
    touch('L1', ISO(3, 1)),
]

// Properties sold, unfiltered — D1/D2 mirror the two conversions above; CP1 is a
// Channel-Partner-sourced sale whose lead is outside the buyer population entirely, so it
// appears ONLY here (that is the whole point of this array). BL1 took a blocking but has
// not signed an MoU.
const soldBids: SoldBidFact[] = [
    { dealId: 'D1', soldAt: ISO(8, 1), viaBlocking: false, isChannelPartner: false, clusters: ['PAV'], micromarkets: ['Powai'], channel: 'Paid Ads', rawSource: 'Meta', sourceLabel: 'Meta', attributedCampaign: '', attributedAdSet: '', attributedAd: '', attributedProperty: '' },
    { dealId: 'D2', soldAt: ISO(8, 2), viaBlocking: false, isChannelPartner: false, clusters: ['PAV'], micromarkets: ['Powai'], channel: 'Paid Ads', rawSource: 'Meta', sourceLabel: 'Meta', attributedCampaign: '', attributedAdSet: '', attributedAd: '', attributedProperty: '' },
    { dealId: 'CP1', soldAt: ISO(8, 4), viaBlocking: false, isChannelPartner: true, clusters: ['PAV'], micromarkets: ['Powai'], channel: null, rawSource: 'Channel Partner', sourceLabel: 'Channel Partner', attributedCampaign: '', attributedAdSet: '', attributedAd: '', attributedProperty: '' },
    { dealId: 'BL1', soldAt: ISO(8, 6), viaBlocking: true, isChannelPartner: false, clusters: ['PAV'], micromarkets: ['Powai'], channel: 'Paid Ads', rawSource: 'Meta', sourceLabel: 'Meta', attributedCampaign: '', attributedAdSet: '', attributedAd: '', attributedProperty: '' },
]

// Visit events split by the BID's source. CP1's bid belongs to a lead outside the population
// entirely, so it exists ONLY here — that is the whole point of this array. E1/E2 mirror two of
// the VisitFacts above; OUT1 falls outside the quarter.
const visitSplit: VisitSplitFact[] = [
    { eventId: 'E1', startAt: ISO(7, 10), isChannelPartner: false },
    { eventId: 'E2', startAt: ISO(7, 12), isChannelPartner: false },
    { eventId: 'CPV1', startAt: ISO(7, 10), isChannelPartner: true },
    { eventId: 'CPV2', startAt: ISO(8, 4), isChannelPartner: true },
    { eventId: 'OUT1', startAt: ISO(3, 1), isChannelPartner: true },
]

const facts: BuyerFacts = {
    leads,
    visits,
    conversions,
    soldBids,
    visitSplit,
    houses,
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
    windowStart: ISO(7, 1, 0),
    windowEnd: '2026-10-01T00:00:00+05:30',
}

const opts = {
    quarterStart: new Date('2026-07-01T00:00:00+05:30'),
    quarterEnd: new Date('2026-10-01T00:00:00+05:30'),
    now: new Date('2026-08-15T12:00:00+05:30'),
    filters: EMPTY_FILTERS,
}

describe('deriveReport golden', () => {
    const report = deriveReport(facts, opts)

    it('produces the same full output (locks the twelve cards)', () => {
        expect(report).toMatchSnapshot()
    })

    // A few explicit invariants, so a failure reads in English rather than as a diff.
    it('counts population leads only', () => {
        const total = report.twoWeekTable.find((r) => r.metric === 'Total Unique Leads')!.qAchieved
        expect(total).toBe(7) // 8 leads minus OLD1 (not in population); P1/P2 count
    })

    it('splits new vs old visits by the lead creation date, deduped per week', () => {
        const nv = report.twoWeekTable.find((r) => r.metric === 'New Visits')!.qAchieved
        const ov = report.twoWeekTable.find((r) => r.metric === 'Old Visits')!.qAchieved
        expect(nv).toBe(2) // L1 and L3 (L3's two same-week visits collapse to one person-week)
        expect(ov).toBe(1) // OLD1
    })

    it('splits WoW Bids Ever Warm by lead.hasWarmBid, on the same per-week/per-person dedup as Unique Visits', () => {
        // Reuses the shared fixture's own visits: L3 has hasWarmBid: true (see the leads array
        // above), L1 and OLD1 default to false. Same 3 unique-visit population the "splits new
        // vs old" test above counts (2 + 1), just split by warmth instead of by cohort.
        const sum = (key: string) => report.everWarmByWeek.reduce((s, p) => s + (p.counts[key] ?? 0), 0)
        expect(sum('Ever Warm')).toBe(1) // L3
        expect(sum('Not Warm')).toBe(2) // L1, OLD1
    })

    it('dedupes Unique Gross Visits on person+property, not person alone', () => {
        const customVisits: VisitFact[] = [
            visit('L1', ISO(7, 10), 'Powai', ISO(7, 1), 'Paid Ads', undefined, 'PROP-A'),
            // Same person, same property, same week -> not a second gross visit.
            visit('L1', ISO(7, 11), 'Powai', ISO(7, 1), 'Paid Ads', undefined, 'PROP-A'),
            // Same person, DIFFERENT property, same week -> counts again for gross visits,
            // but still just one for the existing person-only Unique Visits metric.
            visit('L1', ISO(7, 12), 'Powai', ISO(7, 1), 'Paid Ads', undefined, 'PROP-B'),
        ]
        const withVisits = deriveReport({ ...facts, visits: customVisits }, opts)
        const sum = (pts: typeof withVisits.uniqueVisitsBySource) =>
            pts.reduce((s, p) => s + Object.values(p.counts).reduce((a: number, n) => a + (n ?? 0), 0), 0)
        expect(sum(withVisits.uniqueVisitsBySource)).toBe(1)
        expect(sum(withVisits.uniqueGrossVisitsBySource)).toBe(2)
    })

    it('folds telephony junk into Attempted to Contact', () => {
        const statuses = report.leadsByStatus.flatMap((p) => Object.keys(p.counts))
        expect(statuses).toContain('Attempted to Contact')
        expect(statuses).not.toContain('Network Issue')
    })

    it('keeps the pipeline snapshot independent of the population', () => {
        const pipelineTotal = report.visitPipeline.reduce(
            (s, p) => s + Object.values(p.counts).reduce((a: number, n) => a + (n ?? 0), 0),
            0
        )
        expect(pipelineTotal).toBe(2) // P1, P2
    })

    it('caps the QTD Spend/cost rows at `now`, excluding spend the sheet already has for future dates', () => {
        // opts.now is 2026-08-15. The growth team's spend sheet is committed for the whole
        // quarter up front, not filled in day by day (verified live 2026-09-09: it carries
        // rows through Sep 30, weeks past `now`) — so a row dated 1 Sep must not count yet
        // even though it sits inside the full quarter window. Mirrors the same fix in
        // lib/seller/derive.ts, reported 2026-09-09 against 3P specifically but applying to
        // every channel alike.
        const spend: SpendFact[] = [
            { date: '2026-07-10T00:00:00+05:30', channel: '3P', micromarket: 'Powai', rawSource: '99acres', spendInr: 1000, impressions: 0, clicks: 0 },
            { date: '2026-09-01T00:00:00+05:30', channel: '3P', micromarket: 'Powai', rawSource: '99acres', spendInr: 5000, impressions: 0, clicks: 0 },
        ]
        const withSpend = deriveReport({ ...facts, spend }, opts)
        expect(withSpend.twoWeekTable.find((r) => r.metric === 'Spend')!.qAchieved).toBe(1000)

        // Once `now` moves past the future row's date, it counts too — a cutoff, not a
        // permanent exclusion of that row.
        const later = deriveReport({ ...facts, spend }, { ...opts, now: new Date('2026-09-05T12:00:00+05:30') })
        expect(later.twoWeekTable.find((r) => r.metric === 'Spend')!.qAchieved).toBe(6000)
    })

    it('computes Direct % of Bids company-wide, excluding null-source and out-of-window bids', () => {
        const thisWeekStart = mondayOfIST(opts.now)
        const twoWkStart = new Date(thisWeekStart.getTime() - 14 * 86400000)
        const inLastTwoWeeks = new Date(twoWkStart.getTime() + 86400000).toISOString()
        const bidSources: BidSourceFact[] = [
            // Before the last-2wk window, but still inside the quarter (Jul 1 - Oct 1): 3 Direct, 1 CP
            { dealId: 'B1', leadSource: 'Direct', createdAt: ISO(7, 5) },
            { dealId: 'B2', leadSource: 'Direct', createdAt: ISO(7, 10) },
            { dealId: 'B3', leadSource: 'Direct', createdAt: ISO(7, 15) },
            { dealId: 'B4', leadSource: 'Channel Partner', createdAt: ISO(7, 20) },
            // Inside the last-2wk window: 1 Direct, 1 CP
            { dealId: 'B5', leadSource: 'Direct', createdAt: inLastTwoWeeks },
            { dealId: 'B6', leadSource: 'Channel Partner', createdAt: inLastTwoWeeks },
            // Excluded from both sides: no source
            { dealId: 'B7', leadSource: null, createdAt: ISO(7, 12) },
            // Excluded entirely: created before the quarter starts
            { dealId: 'B8', leadSource: 'Direct', createdAt: ISO(3, 1) },
        ]
        const report = deriveReport({ ...facts, bidSources }, opts)
        const row = report.twoWeekTable.find((r) => r.metric === 'Direct % of Bids')!
        // QTD spans the full quarter (not `now`-capped, unlike Spend) — B1-B6 all fall
        // inside it: 4 Direct (B1,B2,B3,B5) of 6 total (B7's null source and B8's
        // out-of-window date are excluded from the count entirely).
        expect(row.qAchieved).toBeCloseTo(66.7, 1)
        // Last 2wk: only B5 (Direct) and B6 (Channel Partner) fall in the window.
        expect(row.w2Achieved).toBe(50)
        // No target grid entry exists for this metric.
        expect(row.qTarget).toBeNull()
        expect(row.w2Target).toBeNull()
    })

    it('Overall Funnel "Total Conversions" counts every Closed-Won bid; "Unique Conversions" stays Direct-only and per-buyer', () => {
        const totalTile = report.overallFunnel.blocks.find((b) => b.label === 'Total Conversions')!
        const uniqueTile = report.overallFunnel.blocks.find((b) => b.label === 'Unique Conversions')!
        // CP1's lead is outside the buyer population entirely (Lead_Source = Channel Partner
        // is in EXCLUDED_SOURCES), so it has no ConversionFact at all — it can only be
        // counted because closedWonBids never joins to a LeadFact. That is the bug this
        // array exists to fix: filtering CP at bid level alone still lost these.
        expect(totalTile.actual).toBe(4) // D1, D2, CP1, BL1 (blocking, no MoU)
        expect(uniqueTile.actual).toBe(2) // D1 (L1) + D2 (OLD1)
    })

    it('Total Conversions answers the filter bar, but never dedupes per buyer', () => {
        // Two sales to the same buyer still count twice — "how many properties did we sell".
        // But as of 2026-09-16 the tile IS filter-aware: filtering to a channel the buyer
        // isn't in drops the sale, rather than the tile staying stubbornly company-wide.
        const twoToOneBuyer: SoldBidFact[] = [
            { dealId: 'X1', soldAt: ISO(8, 1), viaBlocking: false, isChannelPartner: false, clusters: ['PAV'], micromarkets: ['Powai'], channel: 'Paid Ads', rawSource: 'Meta', sourceLabel: 'Meta', attributedCampaign: '', attributedAdSet: '', attributedAd: '', attributedProperty: '' },
            { dealId: 'X2', soldAt: ISO(8, 2), viaBlocking: true, isChannelPartner: false, clusters: ['PAV'], micromarkets: ['Powai'], channel: 'Paid Ads', rawSource: 'Meta', sourceLabel: 'Meta', attributedCampaign: '', attributedAdSet: '', attributedAd: '', attributedProperty: '' },
        ]
        const tile = (f: typeof EMPTY_FILTERS) =>
            deriveReport({ ...facts, soldBids: twoToOneBuyer }, { ...opts, filters: f }).overallFunnel.blocks.find(
                (b) => b.label === 'Total Conversions'
            )!.actual

        expect(tile(EMPTY_FILTERS)).toBe(2) // unfiltered: both, no dedupe
        expect(tile({ ...EMPTY_FILTERS, channels: ['Paid Ads'] })).toBe(2) // their own channel
        expect(tile({ ...EMPTY_FILTERS, channels: ['Organic'] })).toBe(0) // someone else's
        expect(tile({ ...EMPTY_FILTERS, micromarkets: ['Powai'] })).toBe(2)
        expect(tile({ ...EMPTY_FILTERS, micromarkets: ['Glasgow'] })).toBe(0)
    })

    it('keeps a Channel-Partner sale in the unfiltered total, but out of every channel filter', () => {
        // A CP buyer has no channel at all (EXCLUDED_SOURCES), so `channel: null`. It must
        // still count when nothing is selected — otherwise the tile stops being a true
        // "everything we sold" total, which is the whole reason it exists.
        const cpOnly: SoldBidFact[] = [
            { dealId: 'CP9', soldAt: ISO(8, 1), viaBlocking: false, isChannelPartner: true, clusters: ['PAV'], micromarkets: ['Powai'], channel: null, rawSource: 'Channel Partner', sourceLabel: 'Channel Partner', attributedCampaign: '', attributedAdSet: '', attributedAd: '', attributedProperty: '' },
        ]
        const tile = (f: typeof EMPTY_FILTERS) =>
            deriveReport({ ...facts, soldBids: cpOnly }, { ...opts, filters: f }).overallFunnel.blocks.find(
                (b) => b.label === 'Total Conversions'
            )!.actual

        expect(tile(EMPTY_FILTERS)).toBe(1)
        expect(tile({ ...EMPTY_FILTERS, channels: ['Paid Ads'] })).toBe(0)
    })

    it('Total Conversions windows on the sale date (MoU or blocking)', () => {
        const outOfWindow: SoldBidFact[] = [
            { dealId: 'Y1', soldAt: ISO(8, 1), viaBlocking: false, isChannelPartner: false, clusters: ['PAV'], micromarkets: ['Powai'], channel: 'Paid Ads', rawSource: 'Meta', sourceLabel: 'Meta', attributedCampaign: '', attributedAdSet: '', attributedAd: '', attributedProperty: '' },
            { dealId: 'Y2', soldAt: ISO(3, 1), viaBlocking: true, isChannelPartner: false, clusters: ['PAV'], micromarkets: ['Powai'], channel: 'Paid Ads', rawSource: 'Meta', sourceLabel: 'Meta', attributedCampaign: '', attributedAdSet: '', attributedAd: '', attributedProperty: '' }, // before the quarter
        ]
        const windowed = deriveReport({ ...facts, soldBids: outOfWindow }, opts)
        expect(windowed.overallFunnel.blocks.find((b) => b.label === 'Total Conversions')!.actual).toBe(1)
    })
})
