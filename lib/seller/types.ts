// Seller-side taxonomy and payload shapes. Mirrors lib/buyer/types.ts, but the seller
// dashboard is a different beast: it stacks by CHANNEL (not source), counts unique sellers
// deduped by phone, and carries a New/Old visit-and-conversion scope the buyer tab has no
// equivalent for. The neutral series/list shapes (WeekSeriesPoint, LeadListItem) are reused
// straight from the buyer module rather than redeclared — they carry no buyer semantics.

export type { LeadListItem, ReasonPoint, TwoWeekRow, WeekSeriesPoint } from '@/lib/buyer/types'

// Visits in Pipeline by Cluster — one row per cluster, stacked by that cluster's own
// micromarkets. Mirrors lib/buyer/types.ts's MicromarketPoint shape exactly, just with a
// cluster-named category field instead of a micromarket one (the field name matters here since
// this chart nests micromarket UNDER cluster, unlike anything on the buyer side).
export interface ClusterPipelinePoint {
    cluster: string
    counts: Partial<Record<string, number>>
    leadIds: Partial<Record<string, string[]>>
}

// Pre-Visit Pipeline / Acq Pipeline / Stalled Conversions by Micromarket — rebuilt 2026-09-24 per
// an explicit growth-team request. Each of these three charts' Window and Till Date readings
// carries this New/Old split (rather than one flat ClusterPipelinePoint[]) so the chart's own
// New/Old scope toggle (default Overall = both) can pick a cohort client-side, no refetch. `new`
// = lead created within the currently selected time window; `old` = every lead that ISN'T — no
// "before" requirement, so a lead created AFTER a narrowed window (e.g. an Aug-created lead while
// viewing a Jul-only period) still lands in `old`, same as a lead from a prior quarter would. In
// Window mode `old` is always `[]` — Window means "attribute basis lead creation time", so
// anything outside the current window's population simply isn't shown; Old only ever appears
// once Till Date's time restriction is lifted, at which point `new` + `old` together are
// literally everyone (Till Date has no time gate at all). See lib/seller/derive.ts's
// `windowSplit` for the full reasoning (this is what fixed the window/till-date toggle changing
// nothing under the default, unfiltered quarter view).
export interface CohortSplitPipeline {
    new: ClusterPipelinePoint[]
    old: ClusterPipelinePoint[]
}

// Post Visit TAT — rebuilt 2026-09-24 per an explicit growth-team request to time-window it
// (was a live snapshot) and split New/Old. Property-level, not deduped to the seller.
/** One stage's count, split New/Old by the same cohort rule as every other visit metric
 *  (parent seller's creation date vs the funnel window). A property counts here when its OWN
 *  stage-transition date (Visit_Date / Valuation_Request_date / Pricing_completion_date /
 *  Offer_Date) falls in the window — NOT when its CURRENT Acq_Status equals this stage, so a
 *  property that has since moved past this stage still counts (these are lifecycle timestamps,
 *  not the live pipeline position; see known-traps.md if that assumption is ever disproven). */
export interface PostVisitTatStagePoint {
    stage: string
    countNew: number
    countOld: number
    leadIdsNew: string[]
    leadIdsOld: string[]
}
/** Average days between two adjacent stages' own transition dates, over properties with BOTH
 *  dates populated and both falling in the window. Carries sum+count (not a pre-divided
 *  average) so the chart's New/Old scope toggle can blend the two cohorts correctly instead of
 *  averaging two averages. */
export interface PostVisitTatTransitionPoint {
    from: string
    to: string
    sumDaysNew: number
    pairsNew: number
    sumDaysOld: number
    pairsOld: number
}
export interface PostVisitTatData {
    stages: PostVisitTatStagePoint[]
    transitions: PostVisitTatTransitionPoint[]
}

// Micromarket Analysis' two "Overall Quarter" bars — one row per micromarket, an achieved
// count against its (possibly absent) paced quarter target. Mirrors FunnelNode's actual/target
// pair, plus the micromarket's own name for the bar chart's category axis.
export interface MicromarketTargetPoint {
    micromarket: string
    actual: number
    target: number | null
}

// The seven direct seller channels plus the always-visible Unmapped catch-all. Cold
// Outreach is new versus the buyer side, and NoBroker folds into 3P here (opposite of the
// buyer taxonomy). Transcribed from the Metabase "Seller Weekly - Direct" channel_clean CASE.
export const SELLER_CHANNELS = [
    'Paid Ads',
    '3P',
    'Offline Branding',
    'Society WA Groups & Management Apps',
    'Organic',
    'Referral & WOM',
    'Cold Outreach',
    'Unmapped',
] as const
export type SellerChannel = (typeof SELLER_CHANNELS)[number]

// The 11 named seller micromarkets, in target-grid order. Seller cluster data is poor
// ("Unknown" dominates), so although the picker nests them under their cluster like the
// buyer tab, it is the micromarket that carries the filter — see sellerMatches.
export const SELLER_MICROMARKETS = [
    'Powai',
    'Vegas',
    'Athens',
    'Glasgow',
    'Amsterdam',
    'Boston',
    'Barcelona',
    'Singapore',
    'Helsinki',
    'Berlin',
    'Hong Kong',
    // Added 2026-09-16: a new HABIBI (Bangalore) micromarket. The seller picker already
    // offers it, because it builds from the shared CLUSTER_TREE — without this its records
    // would land in the unallocated bucket while the filter claimed to select them.
    'Ibiza',
] as const
export type SellerMicromarket = (typeof SELLER_MICROMARKETS)[number]

// A seller visit is decided by a THREE-CASE rule on products."Acq_Status", per
// docs/metric-skill/references/metric-definitions.md ("Seller visits") — the growth team's
// Notion DRR doc, rewritten 2026-09-01. This replaced the dashboard's older single 5-status
// exclusion rule on 2026-09-07; the doc measured the old rule as 13% low.
//
// The spellings are the `products` ones and are load-bearing — `Visit to be Scheduled` and
// `Visit Scheduled` are capitalised OPPOSITELY to the same-named `leads` statuses
// (known-traps.md #23). Verified live 2026-09-07.

/** Case 1 — never a visit, whatever Visit_Date says. */
export const ACQ_NEVER_VISIT_STATUSES = [
    'Visit to be Scheduled',
    'Explore Later - Pre Visit',
    'Visit Scheduled',
    'Junk',
] as const

/** Case 2 — counts only when Visit_Date is present; no fallback. `Qualified` and `Prospect`
 *  are 0 rows live today but named in the doc's Case 2 list — kept per its own advice to keep
 *  retired names in an IN-list "so the rule still holds if they come back". */
export const ACQ_DATED_VISIT_STATUSES = [
    'Internally Rejected',
    'Valuation Range Received',
    'Request Valuation Range',
    'Pitched to Seller',
    'Recycled',
    'Qualified',
    'Prospect',
] as const

/** Case 3 — always counts, Visit_Date or not. */
export const ACQ_ALWAYS_VISIT_STATUSES = [
    'Deal Lost',
    'Explore Later - Post Visit',
    'MoU Signed',
    'Sent for Valuation',
    'Offer Made to Broker',
    'Valuation Completed',
    'Offer Made to Seller',
    'Offer Range Rolled Out',
    'Negotiations',
    'Awaiting Data from Acquisitions',
    'Visit Completed',
    'Revaluation Requested',
] as const

/** A conversion is a property at this status (skill: "Seller conversions"). Sits in
 *  ACQ_ALWAYS_VISIT_STATUSES too — a conversion is always also a qualifying visit. */
export const ACQ_CONVERTED_STATUS = 'MoU Signed'

// "Visits in Pipeline" for the Overall Funnel — a property scheduled but not yet visited.
// Both are in ACQ_NEVER_VISIT_STATUSES, so a property can be a pipeline property or a
// qualifying visit, never both.
export const ACQ_PIPELINE_STATUSES = ['Visit Scheduled', 'Visit to be Scheduled'] as const

// A seller counts as qualified on these four Call_Status values. Changed on the Notion doc
// 2026-09-07: `Already sold the flat` dropped, `Prospect` added — verified live against the
// doc directly, same day. Reinstated 2026-09-24 per an explicit growth-team request: `Already
// sold the flat` counts as Qualified again, dashboard-wide — a deliberate divergence from the
// Notion DRR doc as of this date, not a rediscovered fact, so flagging it here rather than
// treating the 2026-09-07 removal as simply "wrong". Note the exact spellings — the buyer-side
// capital-Q "Not qualified" trap does not apply to the qualified set, but the not-qualified
// status IS lowercase 'Not qualified' on the seller side.
export const SELLER_QUALIFIED_STATUSES = ['Qualified', 'Explore Later', 'Prospect', 'Already sold the flat'] as const

// The seller reporting quarter now matches the buyer's calendar quarter exactly: Jul 1 → Oct 1.
// New/Old cohort splits on the seller's own Created_Time against this start. Roll both dates
// forward each quarter, in step with targets.ts.
//
// Changed 2026-09-09, per an explicit growth-team request, FROM the original Jul 5 → Oct 5
// (also 92 days, just shifted 4 days later). That Jul 5 start was not arbitrary — it mirrors
// Metabase card 739's own pacing/cohort-split anchor (`CURRENT_DATE - DATE '2026-07-05'`,
// verified live 2026-09-02 against the growth team's actual dashboard). The growth team was
// told this explicitly and asked for Jul 1 anyway, to match the Buyer tab's calendar-quarter
// start — so from this quarter on, Seller pacing % and New/Old seller counts will no longer
// agree with Metabase's own card by construction. See metric-definitions.md.
export const SELLER_QUARTER_START_ISO = '2026-07-01T00:00:00+05:30'
export const SELLER_QUARTER_END_ISO = '2026-10-01T00:00:00+05:30'
export const SELLER_QUARTER_LABEL = 'JAS 2026'

// The bolded/flush-left rows of the Target vs Achieved table — every other row renders
// indented and muted. Mirrors components/buyer/TwoWeekTable.tsx's own PRIMARY set, passed in
// as a prop since the two tables' metric names don't overlap. Rebuilt 2026-09-22 per an
// explicit growth-team-supplied row order (see lib/seller/derive.ts's METRIC_ORDER for the
// full sequence, including which sub-rows sit under which of these):
export const SELLER_PRIMARY_METRICS = new Set([
    'Spend', // CPL sits beneath it, unchanged from before
    'Total Leads',
    'Total Qualified Seller Leads',
    'Qualified Property Leads',
    'LTQL %',
    'CPQL',
    'Unique Seller Total Visits',
    'Unique Property Total Visits', // renamed from 'Total Property Visits'; Visits in Pipeline now nests here
    'Total Property Conversions', // renamed from 'Total Conversions'
])

// One node of the Overall Funnel spine: an achieved value with its (possibly absent) target.
export interface FunnelNode {
    actual: number
    target: number | null
}

// The Overall Funnel visualization's data. Changed 2026-09-21, per an explicit growth-team
// request, from a single spine (one Visits node, one Conversions node, each pill-scoped by
// filters.visitScope/conversionScope) to a branching one: after Qualified Leads the funnel
// forks into a New arm and an Old arm, each with its own Visits -> Conversions, recombining
// into one Total Conversions node at the end. The New/Old split here is UNCONDITIONAL — it
// always shows both cohorts regardless of the scope pills, the same way the Target vs Achieved
// table's New/Old rows already do, since the whole point of the diagram now IS that split. The
// scope pills still drive everything else on the page (the table, the WoW charts, the Overview
// stat tiles' own qltvPct/convRatePct on SellerReportData, which are separate from this type).
// See components/seller/OverallFunnel.tsx.
export interface SellerOverallFunnelData {
    uniqueLeads: FunnelNode
    qualified: FunnelNode
    /** Distinct New-cohort sellers with >=1 qualifying property. */
    newVisits: FunnelNode
    /** Distinct Old-cohort sellers with >=1 qualifying property. */
    oldVisits: FunnelNode
    /** newVisits.actual + oldVisits.actual, unconditionally — floats near the visit-arm column,
     *  not a spine node (the two arms stay visually separate all the way to Total Conversions). */
    totalVisits: FunnelNode
    newConversions: FunnelNode
    oldConversions: FunnelNode
    /** newConversions.actual + oldConversions.actual — the funnel's final spine node, where the
     *  two arms' ribbons recombine. */
    totalConversions: FunnelNode
    /** Properties at Acq_Status 'Visit Scheduled' or 'Visit to be Scheduled', same seller-match
     *  and Qualified-seller gate as visits — New+Old, unconditionally (was pill-scoped before
     *  this funnel had its own New/Old arms; now matches totalVisits' unconditional treatment).
     *  Floats near the visit-arm column, alongside totalVisits. */
    pipelineCount: number
    /** Direct conversions, place-and-time-only — no channel/source gate, not scoped by the
     *  conversionScope pill (changed 2026-09-24, per an explicit growth-team request: this float
     *  must only move with the Micromarket/Time filters, not Channel — see
     *  computeDirectConversionsPlaceOnly in derive.ts). The numerator of the dotted-line badge's
     *  percentage (of totalConversionsWithChannelPartner below). */
    directConversionsTotal: number
    /** directConversionsTotal plus every in-window Channel Partner-sourced conversion, which the
     *  rest of the dashboard excludes entirely. Floats above totalConversions, labelled "Total
     *  Conversions" — unrelated to the New/Old split, a different (sourcing-side) axis. */
    totalConversionsWithChannelPartner: number
    ltqlPct: number | null
    /** Visits as a % of Qualified Leads, per arm — replaces the old single qltvPct. */
    newQltvPct: number | null
    oldQltvPct: number | null
    /** Conversions as a % of that arm's own Visits — replaces the old single convRatePct. */
    newConvRatePct: number | null
    oldConvRatePct: number | null
    /** Target percentages for the ribbon rates, from ratios of the target grid's own values
     *  (mirroring lib/buyer/derive.ts's safeRatio pattern) — null outside the reporting quarter
     *  or when the grid doesn't cover the selection. */
    ltqlTarget: number | null
    newQltvTarget: number | null
    oldQltvTarget: number | null
    newConvRateTarget: number | null
    oldConvRateTarget: number | null
}

// "Overall Funnel (Unique Property)" — the property-level twin of SellerOverallFunnelData,
// added 2026-09-22 alongside it per an explicit growth-team request. Same branching shape, but
// every node counts PROPERTIES, not deduped to one per seller (SellerOverallFunnelData's
// newConversions/oldConversions/totalConversions ARE deduped to one per seller — see its own
// doc comment) — a seller with two converted properties counts twice here. See
// components/seller/OverallFunnelProperty.tsx for the full rationale, including why there's no
// property-level equivalent of "Leads" (a lead is a person, so both funnels share that one node).
export interface SellerOverallFunnelPropertyData {
    uniqueLeads: FunnelNode
    /** Every property (any Acq_Status) belonging to a seller in this window's Qualified Leads
     *  set — same number as SellerOverallFunnelData's old qualifiedSellerProperties. Target is
     *  the Unique Seller funnel's own Qualified Leads target (qlTargetQ) — see the note below on
     *  targets. */
    qualifiedProperties: FunnelNode
    /** The three-case-rule qualifying-visit count, per property, per cohort. */
    newVisits: FunnelNode
    oldVisits: FunnelNode
    /** newVisits.actual + oldVisits.actual — floats near the visit-arm column, not a spine node
     *  (the two arms stay visually separate all the way to Total Conversions). */
    totalVisits: FunnelNode
    /** Properties at MoU Signed, in-window signing date, per cohort — undeduped (a seller with
     *  two converted properties counts twice), unlike SellerOverallFunnelData's own
     *  newConversions/oldConversions, which ARE seller-deduped. */
    newConversions: FunnelNode
    oldConversions: FunnelNode
    totalConversions: FunnelNode
    /** Properties at Acq_Status 'Visit Scheduled'/'Visit to be Scheduled', New+Old — same number
     *  as SellerOverallFunnelData's pipelineCount (pipeline has no seller-vs-property distinction
     *  worth drawing; a scheduled-but-unvisited property is what it is either way). */
    pipelineCount: number
    /** Direct conversions, place-and-time-only — same numbers SellerOverallFunnelData's own
     *  Total Conversions (Channel Partner + Direct) float uses (already property-level, see its
     *  doc comment there for the 2026-09-24 channel-independence change). Added 2026-09-22 per an
     *  explicit growth-team request that this float appear on both funnels. */
    directConversionsTotal: number
    totalConversionsWithChannelPartner: number
    /** Qualified Property Leads as a % of Unique Leads. No named rate label in the UI — there's
     *  no established term for "properties per lead" the way LTQL/QLTV are. */
    qualPct: number | null
    qualTarget: number | null
    /** Visits as a % of Qualified Property Leads, per arm. */
    newVisitPct: number | null
    oldVisitPct: number | null
    /** Conversions as a % of that arm's own Visits, per cohort — undeduped, same basis as
     *  newConversions/oldConversions above. */
    newConvRatePct: number | null
    oldConvRatePct: number | null
    // Every target field on this type (qualTarget, newVisitTarget/oldVisitTarget,
    // newConvRateTarget/oldConvRateTarget, and every FunnelNode's own `target` above) is the
    // SAME value SellerOverallFunnelData uses for its corresponding node/rate — reused directly
    // in derive.ts, not recomputed — per an explicit growth-team request that this funnel's
    // targets match the Unique Seller funnel's throughout. That's a deliberate approximation:
    // this funnel's ACTUALS stay property-level/undeduped, compared against what is, in a few
    // places (visits, the qualified-stage node), a seller-level target.
    newVisitTarget: number | null
    oldVisitTarget: number | null
    newConvRateTarget: number | null
    oldConvRateTarget: number | null
}

// Payload from /api/seller → deriveReport. Mirrors BuyerReportData's shape where it can.
export interface SellerReportData {
    cachedAt: string
    quarterLabel: string
    /** Share of the window elapsed, 0–100, for the pacing header. */
    expectedPctOfTarget: number
    windowWeeks: number

    // Target vs Achieved — QTD + Last-2-Week Target/Achieved/Lag per DRR metric, mirroring
    // Buyer's TwoWeekTable architecture (reusing its already-generic row type).
    targetVsAchieved: import('@/lib/buyer/types').TwoWeekRow[]
    /** How the spend snapshot parsed, so the growth team can debug the sheet they fill in
     *  themselves: when it was built, and anything that fell through. Rendered under the
     *  Target vs Achieved table. */
    spendIngest: import('./facts').SellerSpendIngest
    /** Spend matching every filter EXCEPT that it carries no micromarket, and so was dropped
     *  by the active place filter. Zero without one. Rendered, because it is ~20% of seller
     *  spend and hiding it makes every filtered cost-per metric look cheaper than it is. */
    spendExcludedUnallocated: number

    // Cards 2–4: the three scalar rates, as percentages. Null when the denominator is 0.
    ltqlPct: number | null // QL / Leads
    qltvPct: number | null // Seller Visits / QL
    convRatePct: number | null // Seller Conversions / Seller Visits

    // The Overview section's two funnel diagrams — see SellerOverallFunnelData and
    // SellerOverallFunnelPropertyData.
    overallFunnel: SellerOverallFunnelData
    overallFunnelProperty: SellerOverallFunnelPropertyData

    // WoW Channel Performance — 6 charts, all stacked by the 7-channel DRR taxonomy (plus the
    // Unmapped catch-all). 1, 2 and 6 are bucketed by the seller's own Created_Time; 3 by the
    // property's own; 4 and 5 by the qualifying property's Visit_Date (falling back to the
    // seller's Created_Time only for a date-less Case 3 property). See derive.ts's
    // deriveReport for the full rationale.
    leadsByChannel: import('@/lib/buyer/types').WeekSeriesPoint[]
    qualifiedLeadsByChannel: import('@/lib/buyer/types').WeekSeriesPoint[]
    leadsByStatus: import('@/lib/buyer/types').WeekSeriesPoint[]
    qualifiedPropertiesByChannel: import('@/lib/buyer/types').WeekSeriesPoint[]
    /** Distinct sellers with >=1 qualifying property, deduped per bucket — the "unique seller"
     *  reading, mirroring Buyer's uniqueVisitsBySource. */
    sellerVisitsByChannel: import('@/lib/buyer/types').WeekSeriesPoint[]
    /** Every qualifying property, not deduped by seller, stacked by New/Old cohort instead of
     *  Channel — rebuilt 2026-09-24 (was propertyVisitsByChannel) per an explicit growth-team
     *  request. Strict Visit_Date attribution: unlike every other visit metric on this tab, this
     *  one does NOT fall back to the seller's own creation date for a date-less Case-3 New
     *  property — an event chart can't place an undated event, so that property is simply
     *  excluded from this chart (it still counts everywhere else). */
    propertyVisitsByCohort: import('@/lib/buyer/types').WeekSeriesPoint[]
    /** Same population/window as the New-cohort half of propertyVisitsByCohort (WITH the Case-3
     *  fallback, unlike that chart), split by the PROPERTY's own Source into 'Direct' / 'Channel
     *  Partner' instead of by cohort. */
    propertyVisitsByDirectCp: import('@/lib/buyer/types').WeekSeriesPoint[]

    // Pre-sales — bucketed within the selected time window, same population gate as the WoW
    // charts above (unlike pipelineByCluster below).
    notQualifiedReasons: import('@/lib/buyer/types').ReasonPoint[]
    /** Sub-reasons for the "Not Truva approved" slice specifically, from the SEPARATE
     *  Truva_Qualified multiselect field — rendered as a small dotted-arrow annotation off that
     *  slice. A seller can carry more than one, so these are % of "Not Truva approved"'s own
     *  total (that reason's count in notQualifiedReasons above), not of each other. */
    notTruvaApprovedSubReasons: import('@/lib/buyer/types').ReasonPoint[]
    /** First Response Time, bucketed by the seller's own created week — mirrors Buyer's own
     *  frtByWeek exactly (EE_Response_Time - Created_Time, working hours only). */
    frtByWeek: import('@/lib/buyer/types').FrtWeekPoint[]
    /** A live snapshot — ignores the time filter entirely, mirroring Buyer's own pipeline chart
     *  ("what is queued right now has no time dimension to slice"). */
    pipelineByCluster: ClusterPipelinePoint[]

    // Micromarket section's 3 status-stacked charts (components/seller/
    // MicromarketStatusBar.tsx). `.cluster` on each point holds the MICROMARKET name, not a
    // cluster — reusing ClusterPipelinePoint's shape rather than adding a near-identical type.
    // Each chart carries a Window reading and a Till Date reading, each itself split New/Old
    // (CohortSplitPipeline) — rebuilt 2026-09-24 per an explicit growth-team request; see
    // CohortSplitPipeline's own doc comment for what Window/Till Date/New/Old each mean here.
    /** Acq_Status in ACQ_PIPELINE_STATUSES ('Visit to be Scheduled', 'Visit Scheduled'). */
    pipelineByMicromarket: CohortSplitPipeline
    pipelineByMicromarketTillDate: CohortSplitPipeline
    /** Acq_Status already past the pipeline stage (ACQ_ALWAYS_VISIT_STATUSES ∪
     *  ACQ_DATED_VISIT_STATUSES) — "those who have already visited". */
    acqPipelineByMicromarket: CohortSplitPipeline
    acqPipelineByMicromarketTillDate: CohortSplitPipeline
    /** The 7-status "Properties with Stalled Conversions" list, gated on Visit_Date present. */
    stalledConversionsByMicromarket: CohortSplitPipeline
    stalledConversionsByMicromarketTillDate: CohortSplitPipeline
    /** Post Visit TAT — 4 stage counts (Visit Completed / Sent for Valuation / Valuation
     *  Completed / Offer Made to Seller) plus the average days between each adjacent pair. See
     *  PostVisitTatData above. */
    postVisitTat: PostVisitTatData

    // Micromarket Analysis. Which micromarkets appear is decided by the Cluster/MM filter
    // (all 11 with nothing selected); Channel still narrows the population same as everywhere
    // else. The two "Overall Quarter" bars additionally respect Time, paced against the target
    // grid exactly like the Target vs Achieved table's QTD column; the two WoW stacks bucket
    // weekly like every other WoW chart on this tab.
    qualifiedLeadsByMicromarketQuarter: MicromarketTargetPoint[]
    qualifiedVisitsByMicromarketQuarter: MicromarketTargetPoint[]
    qualifiedLeadsByMicromarket: import('@/lib/buyer/types').WeekSeriesPoint[]
    sellerVisitsByMicromarket: import('@/lib/buyer/types').WeekSeriesPoint[]

    // Drill-down lookup: seller id → list item. Deep-links to the Zoho Sellers module.
    sellersById: Record<string, import('@/lib/buyer/types').LeadListItem>
}
