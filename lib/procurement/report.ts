import { fetchSocietyProgress, type FetchProgressOptions } from './growth'
import { fetchPriorities, societyKey } from './priority'
import type { PriorityBand, ProcurementReport, SocietyWithPriority } from './types'

// Putting the report together: growth's numbers, plus the priority this side owns.
//
// The division of labour is the point. growth computes the ratio because only it can reach the two
// private databases. This repo attaches priority because only it can reach Airtable. Neither half
// duplicates the other's work, and an Airtable outage therefore cannot move a percentage.

/** The band societies land in when Airtable has no row for them. */
export const UNASSIGNED_PRIORITY = 'unassigned'

/** A percentage to two decimals, or null when there is nothing to divide by. */
function pct(procured: number, total: number): number | null {
    if (total <= 0) return null
    return Math.round((procured / total) * 10000) / 100
}

/** True when a society is measurably complete, rather than merely unmeasurable. */
function isAt100Pct(society: SocietyWithPriority): boolean {
    return society.procurementPct !== null && society.procurementPct >= 100
}

/**
 * Roll the societies up by priority band.
 *
 * Computed here rather than asked of growth, because growth has never seen a priority. Bands sort
 * P0, P1, P2… with `unassigned` last: it is not a priority, and leading with it would push the
 * band anyone actually watches down the page.
 */
export function rollUpByPriority(societies: SocietyWithPriority[]): PriorityBand[] {
    const groups = new Map<string, SocietyWithPriority[]>()
    for (const society of societies) {
        const key = society.priority ?? UNASSIGNED_PRIORITY
        groups.set(key, [...(groups.get(key) ?? []), society])
    }

    return [...groups.entries()]
        .map(([priority, rows]) => {
            const totalUnits = rows.reduce((sum, s) => sum + s.totalUnits, 0)
            const unitsProcured = rows.reduce((sum, s) => sum + s.unitsProcured, 0)
            return {
                priority,
                societiesTotal: rows.length,
                societiesAt100Pct: rows.filter(isAt100Pct).length,
                totalUnits,
                unitsProcured,
                procurementPct: pct(unitsProcured, totalUnits),
            }
        })
        .sort((a, b) => {
            if (a.priority === UNASSIGNED_PRIORITY) return 1
            if (b.priority === UNASSIGNED_PRIORITY) return -1
            return a.priority.localeCompare(b.priority)
        })
}

export interface ReportOptions extends FetchProgressOptions {
    /** Keep only this priority band. Applied here, since growth cannot filter on priority. */
    priority?: string
}

/**
 * Build the dashboard's procurement report.
 *
 * @throws {GrowthUnavailableError} When growth cannot be reached. Fatal by design — a report with
 *   no numbers would render as "nothing procured".
 */
export async function buildProcurementReport(options: ReportOptions = {}): Promise<ProcurementReport> {
    // Independent reads, and only one of them is allowed to fail. `fetchPriorities` never throws,
    // so a plain Promise.all is enough — an Airtable outage arrives as `unavailable`, not a
    // rejection, which is exactly the asymmetry this feature wants.
    const [progress, priorities] = await Promise.all([fetchSocietyProgress(options), fetchPriorities()])

    const warnings = [...progress.warnings]
    if (priorities.unavailable) warnings.push(priorities.unavailable)

    let matchedSocieties = 0
    let societies: SocietyWithPriority[] = progress.societies.map((society) => {
        const match = priorities.bySocietyName.get(societyKey(society.societyName))
        if (match) matchedSocieties++
        return {
            ...society,
            priority: match?.priority ?? null,
            priorityInconsistent: match?.priorityInconsistent ?? false,
        }
    })

    // The last of the three quiet Airtable failures, and the only one that can only be seen from
    // here: the table is fine, the columns are fine, but not one of its society names is a name
    // truiq uses. Usually it holds federation names ("Kalpataru Aura") where truiq holds the
    // buildings beneath them ("Kalpataru Aura Building 1 ABCD").
    if (priorities.bySocietyName.size > 0 && matchedSocieties === 0 && progress.societies.length > 0) {
        warnings.push('airtable_no_society_match')
    }

    if (options.priority) {
        const wanted = options.priority.toUpperCase()
        societies = societies.filter((s) => s.priority?.toUpperCase() === wanted)
    }

    // growth's summary describes what growth returned. Once a priority filter has been applied here
    // it no longer describes what the caller is looking at, so it is recomputed — otherwise a P0
    // view would show the whole TQ set's totals above a P0 table.
    const summary = options.priority
        ? {
              totalSocieties: societies.length,
              totalUnits: societies.reduce((sum, s) => sum + s.totalUnits, 0),
              unitsProcured: societies.reduce((sum, s) => sum + s.unitsProcured, 0),
              procurementPct: pct(
                  societies.reduce((sum, s) => sum + s.unitsProcured, 0),
                  societies.reduce((sum, s) => sum + s.totalUnits, 0)
              ),
              societiesAt100Pct: societies.filter(isAt100Pct).length,
          }
        : progress.summary

    return {
        asOf: progress.asOf,
        warnings,
        summary,
        // Both passed through untouched. They describe growth's join and the federation grain,
        // neither of which a priority filter on this side changes — and rewriting them to match
        // a filter would make a real data gap look smaller than it is.
        ...(progress.federationSummary ? { federationSummary: progress.federationSummary } : {}),
        matchCoverage: progress.matchCoverage,
        byPriority: rollUpByPriority(societies),
        dataQuality: progress.dataQuality,
        societies,
        ...(progress.federations ? { federations: progress.federations } : {}),
        ...(progress.weekly ? { weekly: progress.weekly } : {}),
    }
}
