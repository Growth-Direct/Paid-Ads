export const CHANNELS = [
    'Paid Ads',
    '3P',
    'Offline Branding',
    'Society WA Groups & Management Apps',
    'Organic',
    'Referral & WOM',
    'Unmapped',
] as const
export type Channel = (typeof CHANNELS)[number]

// The individual Zoho Lead_Source values behind each channel, in the display order the
// by-source charts stack and colour them in. Grouped by channel so a stack still reads as
// its channel at a glance (each channel owns a hue family in palette.ts) while showing the
// real source name — "99Acres" rather than "3P".
//
// Display spellings, not raw Zoho values: shared.ts's sourceLabel() folds the live casing
// junk (`ig`, `meta`, `google`, `Magicbricks`) onto these. Order within a channel is by
// volume over the last 24 months. Anything unrecognised renders as Unmapped and is kept.
export const SOURCES_BY_CHANNEL: Record<Channel, string[]> = {
    'Paid Ads': ['Meta', 'Google Ads', 'Paid Ads (Unattributed)', 'LinkedIn'],
    '3P': ['99Acres', 'Housing', 'MagicBricks'],
    Organic: ['Website', 'Instagram', 'Organic', 'WhatsApp'],
    'Offline Branding': ['Offline Branding'],
    'Society WA Groups & Management Apps': ['Society WA Groups', 'Society Management App', 'Society Data'],
    'Referral & WOM': ['Word of Mouth', 'Referral', 'Seller Referral'],
    Unmapped: ['Unmapped'],
}

/** Every known source label, channel-grouped. Series order for the by-source charts. */
export const SOURCE_ORDER: string[] = CHANNELS.flatMap((c) => SOURCES_BY_CHANNEL[c])

export const CLUSTERS = ['PAV', 'GLAM', 'BABU', 'HABIBI', 'Unknown'] as const

export const QUALIFIED_STATUSES = [
    'Qualified',
    'Site visit Scheduled',
    'In follow Up',
    'Pre Qualified',
    'Purchased with Truva',
    'Purchased Outside Truva',
    'Visit to be scheduled',
    'Paused Search',
] as const

export const VISIT_PIPELINE_STATUSES = ['Visit to be scheduled', 'Site visit Scheduled'] as const

// JAS 2026 — the quarter every card on the Metabase buyer dashboard is scoped to.
// Roll this forward each quarter; nothing else in the aggregation should need to change.
export const QUARTER_START_ISO = '2026-07-01T00:00:00+05:30'
export const QUARTER_END_ISO = '2026-10-01T00:00:00+05:30'
export const QUARTER_LABEL = 'JAS 2026'

export interface LeadListItem {
    id: string
    name: string
    status: string
    source: string
    createdAt: string
}

export interface WeekSeriesPoint {
    weekStart: string // YYYY-MM-DD, Monday IST
    weekLabel: string // e.g. "18 Aug"
    counts: Partial<Record<string, number>> // series key -> count
    leadIds: Partial<Record<string, string[]>> // series key -> lead ids in that bucket, for drill-down
    /** This bucket is still in progress, so its counts cover only part of a week or month.
     *  Charts render it hatched and label it "partial" — see Buckets.bucketIncomplete. */
    incomplete?: boolean
    /** This bucket starts before the selected range, so it holds only its tail end — the
     *  stub week a quarter starting mid-week leaves behind. Charts that pair weeks into
     *  fortnights leave it standing alone; nothing else changes, no hatching and no label
     *  change. See Buckets.bucketPartialStart. */
    partialStart?: boolean
}

export interface MicromarketPoint {
    micromarket: string
    counts: Partial<Record<string, number>> // status -> count
    leadIds: Partial<Record<string, string[]>>
}

export interface ReasonPoint {
    reason: string
    count: number
    leadIds: string[]
}

export interface TwoWeekRow {
    metric: string
    unit: 'count' | '%' | 'currency' | 'x'
    qTarget: number | null
    qAchieved: number | null
    /** Positive = behind (red), negative = ahead (green) — already sign-flipped for a
     *  cost-per-X row, where more spend-per-unit is the bad direction. */
    qLag: number | null
    /** The FULL, un-paced quarter target — `qTarget` is this same number paced down by
     *  days-elapsed-so-far. Optional so `lib/seller/derive.ts` (which builds its own
     *  TwoWeekRow[] for the same shared TwoWeekTable component) doesn't need to supply it —
     *  Seller's table just renders "—" in this column until/unless it's wired up there too. */
    qTargetFull?: number | null
    /** qAchieved ÷ qTargetFull as a percentage — progress toward the WHOLE quarter's goal, a
     *  different read from qLag (which compares to the paced target). Same optionality as
     *  qTargetFull. */
    qPctCompleted?: number | null
    w2Target: number | null
    w2Achieved: number | null
    w2Lag: number | null
    /** The same flat 14-day pro-rata share of the full quarter target as w2Target — the target
     *  grid paces at a constant run-rate, so the upcoming 2 weeks' target is the identical
     *  number as the last 2 weeks' was, just with no "achieved" yet to compare it to. */
    nextW2Target: number | null
    /** An alternative to nextW2Target: instead of a flat run-rate share, spreads whatever's
     *  LEFT to hit qTargetFull (qTargetFull - qAchieved) evenly over the days remaining in the
     *  window, then takes a 14-day slice — steeper than nextW2Target when behind pace, easier
     *  when ahead (floored at 0). Rate metrics (LTQL %, QLTV %, CPL, CPQL, CPV, CAC) skip this
     *  math and just carry qTargetFull unchanged, same as nextW2Target already does for them.
     *  Optional and Seller-only for now — see lib/seller/derive.ts and
     *  components/buyer/TwoWeekTable.tsx's showProRataNextTarget prop. */
    nextW2TargetProRata?: number | null
}

export interface HouseWarmPoint {
    house: string
    uniqueVisits: number
    everWarmYes: number
    everWarmNo: number
}

export interface FunnelBlockPoint {
    label: string
    target: number | null
    actual: number | null
}

export interface FunnelArrowPoint {
    label: string | null // null = plain connector, no ratio shown
    unit: '%' | 'x' // 'x' = multiplier (e.g. visits per person), '%' = share
    target: number | null
    achieved: number | null
}

// arrows.length === blocks.length - 1; arrows[i] connects blocks[i] to blocks[i + 1].
export interface OverallFunnelData {
    blocks: FunnelBlockPoint[]
    arrows: FunnelArrowPoint[]
}

export const TOTAL_VISITS_RAW_TARGET_MULTIPLIER = 1.2

export interface FrtWeekPoint {
    weekStart: string
    weekLabel: string
    avgMinutes: number | null
    medianMinutes: number | null
    p80Minutes: number | null // 4 of 5 leads were contacted within this many minutes
    count: number // leads with a computed FRT in this bucket
}

export interface BuyerReportData {
    cachedAt: string
    /** Provenance for the Spend and cost rows: which source produced them, and whether what it
     *  read was complete. Rendered by SpendNote. Mirrors the seller report. */
    spendIngest: import('./facts').SpendIngest
    quarterLabel: string
    expectedPctOfTarget: number
    windowWeeks: number

    // 1-3: WoW by lead-created week
    leadsBySource: WeekSeriesPoint[]
    leadsByStatus: WeekSeriesPoint[]
    qualifiedBySource: WeekSeriesPoint[]

    // 4
    notQualifiedReasons: ReasonPoint[]

    // 5: current snapshot, not time-windowed
    visitPipeline: MicromarketPoint[]

    // Last 2-Week Target vs Achieved — the one consolidated funnel+cost table (Cost tiles
    // and the separate Quarter Overview table were removed and folded into this).
    twoWeekTable: TwoWeekRow[]

    // Overall Funnel block-and-arrow diagram (spec 5.1). Answers to the same filters as
    // Quarter Overview (dimension filters yes, time filter no — always the full quarter).
    overallFunnel: OverallFunnelData

    // First Response Time = EE_Response_Time - Created_Time, minutes. Only for leads created
    // during working hours (9AM-7PM IST) — a non-working-hours lead isn't held to the same
    // response-time expectation, so it's excluded entirely rather than measured differently.
    // Bucketed by lead-created week, same as the WoW charts.
    frtByWeek: FrtWeekPoint[]

    // 8-9: WoW by visit week
    uniqueVisitsBySource: WeekSeriesPoint[]
    totalVisitsByMicromarket: WeekSeriesPoint[]

    // Dashboard-only addition (2026-09-15): dedupes on (person, property), not person alone, so
    // the same buyer visiting a different flat counts again — see derive.ts's comment where it's
    // computed and metric-definitions.md for the full definition and its live-Zoho caveat.
    uniqueGrossVisitsBySource: WeekSeriesPoint[]
    /** Visits split by the BID's own source (Direct vs Channel Partner), one count per visit
     *  EVENT. The only visit series on this tab that includes Channel Partner activity at all —
     *  so it does NOT reconcile with the other visit charts, which are Direct-only and
     *  per-person. Not clickable and not filter-aware; see metric-definitions.md. */
    visitsByBidSource: WeekSeriesPoint[]

    // Dashboard-only addition (2026-09-15): warm vs not-warm bids, by visit week. Does NOT
    // reconcile against the Target vs Actuals table's own "Ever Warm %" row — see derive.ts's
    // comment where it's computed and metric-definitions.md for the full note.
    everWarmByWeek: WeekSeriesPoint[]

    // 10: WoW by lead-created week, cluster split
    qualifiedByCluster: WeekSeriesPoint[]

    // 11: per live property
    visitedByEverWarm: HouseWarmPoint[]

    leadsById: Record<string, LeadListItem>
}
