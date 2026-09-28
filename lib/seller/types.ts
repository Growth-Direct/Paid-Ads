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

// A seller counts as qualified on these three Call_Status values. Changed on the Notion doc
// 2026-09-07: `Already sold the flat` dropped, `Prospect` added — verified live against the
// doc directly, same day. Note the exact spellings — the buyer-side capital-Q "Not qualified"
// trap does not apply to the qualified set, but the not-qualified status IS lowercase
// 'Not qualified' on the seller side.
export const SELLER_QUALIFIED_STATUSES = ['Qualified', 'Explore Later', 'Prospect'] as const

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
// as a prop since the two tables' metric names don't overlap.
export const SELLER_PRIMARY_METRICS = new Set([
    'Total Leads',
    'Total Qualified Seller Leads',
    'Qualified Property Leads',
    'Unique Seller Total Visits',
    'Total Property Visits',
    'Visits in Pipeline',
    'Total Conversions',
    // Spend is a primary row with the four cost-per metrics indented beneath it, the same
    // hierarchy the Buyer table uses.
    'Spend',
])

// One node of the Overall Funnel spine: an achieved value with its (possibly absent) target.
export interface FunnelNode {
    actual: number
    target: number | null
}

// The Overall Funnel visualization's data, mirroring Buyer's OverallFunnelData in spirit but
// purpose-built for the seller shape: TWO float boxes, each with its own number (not sharing
// one like the first version of this chart did), and the branch below the visit node is a
// plain pipeline count rather than a percentage. See components/seller/OverallFunnel.tsx.
export interface SellerOverallFunnelData {
    uniqueLeads: FunnelNode
    qualified: FunnelNode
    /** Distinct sellers with >=1 qualifying property — NOT the pacing table's old per-property
     *  meaning. See the note on `visits` in derive.ts's computeActuals. */
    uniqueSellerVisits: FunnelNode
    conversions: FunnelNode
    /** EVERY property (any Acq_Status) belonging to a seller in this window's Qualified Leads
     *  set — not gated on Acq_Status at all, unlike qualifyingProperties below. Floats above
     *  Qualified Leads, labelled "Qualified Properties". Not New/Old-scoped, mirroring how
     *  Qualified Leads itself has no New/Old toggle. */
    qualifiedSellerProperties: number
    /** The three-case-rule qualifying-visit count, gated on the seller also being a Qualified
     *  Lead, New/Old-scoped by filters.visitScope (unlike qualifiedSellerProperties above,
     *  which has no New/Old scope, so the two aren't guaranteed to nest when Old is in scope).
     *  Floats above Unique Seller Visits, labelled "Qualified Property Visits". */
    qualifyingProperties: number
    /** Properties at Acq_Status 'Visit Scheduled' or 'Visit to be Scheduled', same seller-match,
     *  Qualified-seller gate and New/Old scoping as visits. Shown as a plain count. */
    pipelineCount: number
    /** Direct conversions, New+Old, unconditionally — not gated by the conversionScope pill.
     *  The numerator of the dotted-line badge's percentage (of totalConversionsWithChannelPartner
     *  below). */
    directConversionsTotal: number
    /** directConversionsTotal plus every in-window Channel Partner-sourced conversion, which the
     *  rest of the dashboard excludes entirely. Floats above Conversions, labelled "Total
     *  Conversions". */
    totalConversionsWithChannelPartner: number
    ltqlPct: number | null
    qltvPct: number | null
    convRatePct: number | null
    /** Target percentages for the three ribbon rates, from ratios of the target grid's own
     *  values (mirroring lib/buyer/derive.ts's safeRatio pattern) — null outside the
     *  reporting quarter or when the grid doesn't cover the selection. */
    ltqlTarget: number | null
    qltvTarget: number | null
    convRateTarget: number | null
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

    // The Overview section's funnel diagram — see SellerOverallFunnelData.
    overallFunnel: SellerOverallFunnelData

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
    /** Every qualifying property, not deduped by seller. */
    propertyVisitsByChannel: import('@/lib/buyer/types').WeekSeriesPoint[]

    // Added 2026-09-26, for the growth team's requested page reorder — "(by created week)"
    // variants of the two visit charts just above, and WoW CPL/CPQL/CPV. No new metric
    // definitions: same qualifying-visit rule and per-seller/per-property grain as
    // sellerVisitsByChannel/propertyVisitsByChannel, just bucketed by the SELLER's own
    // created week instead of the qualifying visit's own attribution date; same Spend/Leads/
    // QL/Visits figures as the Target vs Achieved table's own rows, just per week instead of
    // per quarter/2-week. See metric-definitions.md. There is no Seller equivalent of
    // Buyer's LSH Count/Qualified Count charts — no Lead_Source_History-style raw-touch
    // source exists for sellers.
    sellerVisitsByChannelCreatedWeek: import('@/lib/buyer/types').WeekSeriesPoint[]
    propertyVisitsByChannelCreatedWeek: import('@/lib/buyer/types').WeekSeriesPoint[]
    /** Weekly Spend ÷ that week's Total Leads. */
    cplByWeek: import('@/lib/buyer/types').CostWeekPoint[]
    /** Weekly Spend ÷ that week's Total Qualified Seller Leads. */
    cpqlByWeek: import('@/lib/buyer/types').CostWeekPoint[]
    /** Weekly Spend ÷ that week's count from sellerVisitsByChannelCreatedWeek. */
    cpvByWeek: import('@/lib/buyer/types').CostWeekPoint[]

    // Pre-sales — bucketed within the selected time window, same population gate as the WoW
    // charts above (unlike pipelineByCluster below).
    notQualifiedReasons: import('@/lib/buyer/types').ReasonPoint[]
    /** Sub-reasons for the "Not Truva approved" slice specifically, from the SEPARATE
     *  Truva_Qualified multiselect field — rendered as a small dotted-arrow annotation off that
     *  slice. A seller can carry more than one, so these are % of "Not Truva approved"'s own
     *  total (that reason's count in notQualifiedReasons above), not of each other. */
    notTruvaApprovedSubReasons: import('@/lib/buyer/types').ReasonPoint[]
    /** A live snapshot — ignores the time filter entirely, mirroring Buyer's own pipeline chart
     *  ("what is queued right now has no time dimension to slice"). */
    pipelineByCluster: ClusterPipelinePoint[]

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
