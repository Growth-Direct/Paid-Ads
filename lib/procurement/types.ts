// The shapes this dashboard works in: what growth serves, and what this side adds to it.
//
// `Society`/`Summary`/`DataQuality` mirror growth's response. They are restated here rather than
// imported because this repo is not in the monorepo workspace — there is no package to import
// from. That means they can drift, so `lib/procurement/growth.ts` validates the fields it depends
// on at the boundary instead of trusting the cast.

/** Procurement progress for one tower, as growth serves it. */
export interface TowerProgress {
    towerId: string
    towerName: string
    totalUnits: number
    unitsProcured: number
    /** Null when the tower has no mapped units — not 0, and not 100. */
    procurementPct: number | null
}

/** Procurement progress for one society, as growth serves it. */
export interface SocietyProgress {
    societyId: string
    societyName: string
    federationName: string | null
    townshipName: string | null
    truvaMicroMarketName: string | null
    /** One of the seven TQ standings. Not a boolean. */
    truvaQualified: string
    totalUnits: number
    unitsProcured: number
    /** Null when the society has no mapped units. Can exceed 100 — co-owners are real. */
    procurementPct: number | null
    towers?: TowerProgress[]
}

/** A society with the priority this dashboard attached to it. */
export interface SocietyWithPriority extends SocietyProgress {
    /** P0/P1/P2/… from Airtable, or null when unknown or Airtable is unreachable. */
    priority: string | null
    /** True when the society's units disagreed and the most frequent value was taken. */
    priorityInconsistent: boolean
}

/** Totals across every society returned. */
export interface ProgressSummary {
    totalSocieties: number
    totalUnits: number
    unitsProcured: number
    procurementPct: number | null
    societiesAt100Pct: number
}

/** One priority band's totals — computed here, because priority is attached here. */
export interface PriorityBand {
    /** The priority label, or `unassigned` for societies Airtable has no row for. */
    priority: string
    societiesTotal: number
    societiesAt100Pct: number
    totalUnits: number
    unitsProcured: number
    procurementPct: number | null
}

/** growth's data-quality block: how much to trust the numbers above. */
export interface DataQuality {
    unmatchedSocietyNames: { societyName: string; procured: number }[]
    unmatchedProcuredRecords: number
    recoveredFromClutteredNames: number
    recordsWithoutSociety: number
    ambiguousSocietyNames: string[]
    towerCoverage: { withTower: number; total: number; pct: number | null }
}

/**
 * Procurement progress for one federation, as growth serves it.
 *
 * The federation is the grain Zoho actually records at — its `Society_Name` is usually the name
 * truiq holds as a federation — so this is generally the more honest of the two numbers.
 */
export interface FederationProgress {
    federationId: string
    federationName: string | null
    townshipName: string | null
    truvaMicroMarketName: string | null
    societies: number
    /** Every unit under the federation — the denominator `procurementPct` uses. */
    totalUnits: number
    /** Only units under societies of the requested TQ standing. */
    unitsInQualifyingSocieties: number
    truvaQualifiedStandings: string[]
    /** True when the societies beneath disagree on TQ. The federation is not one thing. */
    truvaQualifiedMixed: boolean
    unitsProcured: number
    procurementPct: number | null
    /** `truiq_id` is an exact join; `name` is a fallback the mirror's lag still needs. */
    matchedBy: 'truiq_id' | 'name' | 'none'
}

/**
 * How much of the procured pool growth could place, at each grain.
 *
 * **Read this before rendering any percentage.** A procurement figure built on a third of the
 * records is a floor, not a measurement, and showing it without this context is how a chart
 * starts lying politely.
 */
export interface MatchCoverage {
    procuredPool: number
    society: { matched: number; pct: number | null; viaId: number; viaName: number }
    federation: { matched: number; pct: number | null; viaId: number; viaName: number }
    idsWrittenInMirror: { society: number; federation: number }
}

/**
 * Cumulative procurement at the end of one week.
 *
 * Built from the Zoho record's `Created_Time`, the only timestamp it carries — so this tracks
 * when data landed in Zoho, not when a home was visited. The data arrives in bulk imports, so
 * the curve is a staircase, and a reader who takes a step for a week of field work will be wrong.
 */
export interface WeeklyProcurement {
    /** Monday of the ISO week, IST, as `YYYY-MM-DD`. */
    week: string
    newlyProcured: number
    cumulativeProcured: number
    procurementPct: number | null
    /** Change against the previous week, in percentage points. Null for the first week. */
    deltaPct: number | null
    /**
     * That week's newly-procured owners split by truiq micromarket, for the stacked chart.
     *
     * From truiq's society, not Zoho's own `Truva_Micromarket` picklist — the two disagree often
     * enough not to mix. Societies with no micromarket land under `Unknown`, so the segments sum
     * to `newlyProcured` rather than quietly falling short of the bar they are drawn in.
     */
    byMicromarket: Record<string, number>
}

/** growth's response, verbatim. */
export interface GrowthProgressResponse {
    asOf: string
    warnings: string[]
    summary: ProgressSummary
    /** Federation totals. Absent only if growth was asked to skip them. */
    federationSummary?: ProgressSummary
    matchCoverage: MatchCoverage
    dataQuality: DataQuality
    societies: SocietyProgress[]
    federations?: FederationProgress[]
    /** The week-by-week trend, at society grain. */
    weekly?: WeeklyProcurement[]
}

/** What this dashboard's own route serves: growth's answer, plus priority and its rollup. */
export interface ProcurementReport {
    asOf: string
    /** growth's warnings, plus any this side adds (e.g. `airtable_unavailable`). */
    warnings: string[]
    summary: ProgressSummary
    /** Federation totals, passed through from growth. */
    federationSummary?: ProgressSummary
    /** Passed through unchanged — it describes growth's join, not this view. */
    matchCoverage: MatchCoverage
    byPriority: PriorityBand[]
    dataQuality: DataQuality
    societies: SocietyWithPriority[]
    /**
     * Federation rows, passed through without priority attached.
     *
     * Priority is an Airtable label keyed on a society name, and a federation is not a society —
     * mapping one onto the other would mean picking a priority for a development whose buildings
     * may carry different ones. Left for whoever rules on that.
     */
    federations?: FederationProgress[]
    /**
     * The week-by-week trend, passed through unchanged.
     *
     * Not recomputed when a priority filter is applied: the series is built at society grain from
     * a timestamp, and growth has never seen a priority, so there is nothing here that could
     * honestly narrow it.
     */
    weekly?: WeeklyProcurement[]
}
