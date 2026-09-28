import type { Scope } from './filters'

// JAS 2026 seller targets: 7 channels × 9 grid micromarkets, transcribed from the growth
// team's own planning workbook (Truva_JAS26_Planning_ChannelLevel.xlsx, "MM-WISE View
// (Seller)" tab, JAS rows), NOT Metabase — the earlier grid here (transcribed from Metabase
// card 739) had no spend column and no real per-micromarket split for Helsinki/Berlin/Hong
// Kong, just an even three-way division of a single combined figure invented in an earlier
// session. This sheet is the authoritative source for both; see the HABIBI note below for
// what changed. Columns, in grid order: leads, ql, newVisits, oldVisits, totalVisits,
// newConv, oldConv, totalConv, spendInr. Static on purpose — replace wholesale each quarter
// alongside the quarter dates, from the same sheet's next quarter tab.
//
// Each micromarket ALSO carries an 'Overall' row — the sheet's own pre-computed all-channels
// total (same tab, rows 21-51/276, filtered to Channel = Overall), not the sum of the 7
// channel rows below. The two are close but not always identical (e.g. Powai's own channel
// rows sum to 304 Leads, the sheet's Overall row says 303) — a rounding-carry difference in
// the sheet itself, same reason lib/buyer/targets.ts's own 'ALL' row exists instead of an
// addition. `sellerTargetsFor` uses 'Overall' whenever no channel filter narrows the
// selection, exactly mirroring that Buyer pattern, so an unfiltered target always matches
// what the growth team sees on the sheet's own summary block.
//
// HABIBI (Helsinki, Berlin, Hong Kong) has no per-micromarket row in the sheet — only a
// single combined "Bangalore" row per channel, exactly like the BUYER grid's own
// CLUSTER_TARGET_ALIAS. A named lookup for Helsinki/Berlin/Hong Kong therefore has no cell
// (covered=false, target null) UNLESS every one of the three is requested together (a whole
// HABIBI cluster pick), in which case resolveMicromarkets swaps them for 'Bangalore' — see
// below. This is a deliberate change from the previous grid, which fabricated a 3-way split
// with no basis in the source data (67/67/66 leads — suspiciously even, and summing back to
// Bangalore's own 200). SELLER_MICROMARKETS (lib/seller/types.ts) is untouched: Helsinki,
// Berlin and Hong Kong stay real, selectable Truva_Micromarket values — sellers can carry
// them regardless of what the target grid tracks.

type Row = [
    channel: string,
    micromarket: string,
    leads: number,
    ql: number,
    newVisits: number,
    oldVisits: number,
    totalVisits: number,
    newConv: number,
    oldConv: number,
    totalConv: number,
    spendInr: number,
]

const ROWS: Row[] = [
    ['Paid Ads', 'Powai', 25, 9, 6, 2, 8, 1, 0, 1, 97184],
    ['Paid Ads', 'Vegas', 59, 5, 3, 1, 4, 0, 1, 1, 30000],
    ['Paid Ads', 'Athens', 18, 3, 2, 0, 2, 0, 0, 0, 20000],
    ['Paid Ads', 'Glasgow', 52, 15, 9, 4, 13, 1, 0, 1, 127500],
    ['Paid Ads', 'Amsterdam', 55, 13, 9, 1, 10, 1, 0, 1, 39121],
    ['Paid Ads', 'Boston', 11, 3, 2, 1, 3, 0, 0, 0, 36667],
    ['Paid Ads', 'Barcelona', 7, 2, 1, 0, 1, 0, 0, 0, 30000],
    ['Paid Ads', 'Singapore', 7, 2, 1, 0, 1, 0, 0, 0, 18000],
    ['Paid Ads', 'Bangalore', 200, 10, 6, 0, 6, 0, 0, 0, 18238],

    ['3P', 'Powai', 88, 34, 8, 2, 10, 1, 0, 1, 13600],
    ['3P', 'Vegas', 52, 12, 3, 1, 4, 0, 0, 0, 10200],
    ['3P', 'Athens', 19, 7, 4, 1, 5, 0, 0, 0, 4080],
    ['3P', 'Glasgow', 59, 17, 5, 0, 5, 0, 1, 1, 14960],
    ['3P', 'Amsterdam', 72, 13, 7, 0, 7, 0, 0, 0, 8415],
    ['3P', 'Boston', 39, 18, 8, 2, 10, 0, 0, 0, 1360],
    ['3P', 'Barcelona', 21, 8, 3, 0, 3, 0, 0, 0, 2040],
    ['3P', 'Singapore', 23, 8, 3, 0, 3, 0, 0, 0, 850],
    ['3P', 'Bangalore', 36, 9, 3, 0, 3, 0, 0, 0, 1800],

    ['Offline Branding', 'Powai', 25, 20, 10, 0, 10, 1, 0, 1, 380000],
    ['Offline Branding', 'Vegas', 29, 20, 9, 1, 10, 1, 0, 1, 230000],
    ['Offline Branding', 'Athens', 10, 7, 4, 0, 4, 1, 0, 1, 63000],
    ['Offline Branding', 'Glasgow', 38, 20, 8, 2, 10, 1, 0, 1, 200000],
    ['Offline Branding', 'Amsterdam', 18, 9, 4, 0, 4, 0, 0, 0, 180000],
    ['Offline Branding', 'Boston', 3, 2, 1, 1, 2, 1, 0, 1, 22000],
    ['Offline Branding', 'Barcelona', 8, 6, 3, 0, 3, 0, 0, 0, 96000],
    ['Offline Branding', 'Singapore', 10, 8, 3, 0, 3, 1, 0, 1, 104000],
    ['Offline Branding', 'Bangalore', 52, 26, 13, 0, 13, 1, 0, 1, 260000],

    ['Referral & WOM', 'Powai', 15, 11, 7, 0, 7, 2, 0, 2, 240000],
    ['Referral & WOM', 'Vegas', 28, 17, 10, 0, 10, 1, 0, 1, 90000],
    ['Referral & WOM', 'Athens', 0, 0, 0, 0, 0, 0, 0, 0, 0],
    ['Referral & WOM', 'Glasgow', 28, 14, 10, 0, 10, 2, 0, 2, 240000],
    ['Referral & WOM', 'Amsterdam', 8, 5, 3, 0, 3, 1, 0, 1, 150000],
    ['Referral & WOM', 'Boston', 0, 0, 0, 0, 0, 0, 0, 0, 0],
    ['Referral & WOM', 'Barcelona', 0, 0, 0, 0, 0, 0, 0, 0, 0],
    ['Referral & WOM', 'Singapore', 0, 0, 0, 0, 0, 0, 0, 0, 0],
    ['Referral & WOM', 'Bangalore', 3, 3, 0, 0, 0, 0, 0, 0, 0],

    ['Organic', 'Powai', 32, 16, 8, 2, 10, 1, 0, 1, 0],
    ['Organic', 'Vegas', 40, 12, 8, 2, 10, 1, 0, 1, 0],
    ['Organic', 'Athens', 27, 8, 3, 0, 3, 0, 0, 0, 0],
    ['Organic', 'Glasgow', 44, 11, 7, 3, 10, 1, 0, 1, 0],
    ['Organic', 'Amsterdam', 80, 28, 14, 0, 14, 1, 0, 1, 0],
    ['Organic', 'Boston', 13, 8, 5, 0, 5, 0, 0, 0, 0],
    ['Organic', 'Barcelona', 17, 10, 3, 0, 3, 0, 0, 0, 0],
    ['Organic', 'Singapore', 48, 29, 13, 0, 13, 1, 0, 1, 0],
    ['Organic', 'Bangalore', 20, 6, 3, 0, 3, 0, 0, 0, 0],

    ['Society WA Groups & Management Apps', 'Powai', 19, 13, 8, 2, 10, 1, 0, 1, 0],
    ['Society WA Groups & Management Apps', 'Vegas', 24, 17, 10, 0, 10, 1, 0, 1, 0],
    ['Society WA Groups & Management Apps', 'Athens', 0, 0, 0, 0, 0, 0, 0, 0, 0],
    ['Society WA Groups & Management Apps', 'Glasgow', 5, 3, 2, 0, 2, 0, 0, 0, 0],
    ['Society WA Groups & Management Apps', 'Amsterdam', 0, 0, 0, 0, 0, 0, 0, 0, 0],
    ['Society WA Groups & Management Apps', 'Boston', 0, 0, 0, 0, 0, 0, 0, 0, 0],
    ['Society WA Groups & Management Apps', 'Barcelona', 0, 0, 0, 0, 0, 0, 0, 0, 0],
    ['Society WA Groups & Management Apps', 'Singapore', 0, 0, 0, 0, 0, 0, 0, 0, 0],
    ['Society WA Groups & Management Apps', 'Bangalore', 0, 0, 0, 0, 0, 0, 0, 0, 0],

    ['Cold Outreach', 'Powai', 100, 20, 13, 0, 13, 2, 0, 2, 60000],
    ['Cold Outreach', 'Vegas', 65, 13, 7, 0, 7, 2, 0, 1, 39000],
    ['Cold Outreach', 'Athens', 70, 14, 10, 0, 10, 1, 0, 1, 700],
    ['Cold Outreach', 'Glasgow', 115, 23, 16, 0, 16, 1, 2, 3, 69000],
    ['Cold Outreach', 'Amsterdam', 150, 30, 21, 0, 21, 2, 0, 2, 90000],
    ['Cold Outreach', 'Boston', 45, 9, 5, 0, 5, 0, 0, 0, 27000],
    ['Cold Outreach', 'Barcelona', 55, 11, 7, 0, 7, 1, 0, 1, 33000],
    ['Cold Outreach', 'Singapore', 55, 11, 4, 0, 4, 0, 0, 0, 33000],
    ['Cold Outreach', 'Bangalore', 417, 50, 15, 0, 15, 0, 0, 0, 0],

    // The sheet's own all-channels total per micromarket (Channel = 'Overall', JAS rows) — see
    // the note above. Used by sellerTargetsFor whenever no channel filter narrows the query.
    ['Overall', 'Powai', 303, 123, 60, 8, 68, 9, 0, 9, 790784],
    ['Overall', 'Vegas', 297, 96, 50, 5, 55, 6, 0, 6, 399200],
    ['Overall', 'Athens', 143, 39, 23, 1, 24, 2, 0, 2, 87780],
    ['Overall', 'Glasgow', 342, 103, 57, 9, 66, 6, 3, 9, 651460],
    ['Overall', 'Amsterdam', 383, 98, 58, 1, 59, 5, 0, 5, 467536],
    ['Overall', 'Boston', 111, 40, 21, 4, 25, 1, 0, 1, 87027],
    ['Overall', 'Barcelona', 107, 37, 17, 0, 17, 1, 0, 1, 161040],
    ['Overall', 'Singapore', 143, 58, 24, 0, 24, 2, 0, 2, 155850],
    ['Overall', 'Bangalore', 748, 104, 40, 0, 40, 1, 0, 1, 280038],
]

interface Cell {
    leads: number
    ql: number
    newVisits: number
    oldVisits: number
    totalVisits: number
    newConv: number
    oldConv: number
    totalConv: number
    spendInr: number
}

const CELL = new Map<string, Cell>()
const ALL_MICROMARKETS = new Set<string>()
for (const [channel, mm, leads, ql, nV, oV, tV, nC, oC, tC, spendInr] of ROWS) {
    CELL.set(`${channel}|${mm}`, {
        leads,
        ql,
        newVisits: nV,
        oldVisits: oV,
        totalVisits: tV,
        newConv: nC,
        oldConv: oC,
        totalConv: tC,
        spendInr,
    })
    ALL_MICROMARKETS.add(mm)
}

// The three real Truva_Micromarket values with no grid row of their own — see the HABIBI
// note up top. Resolved to the grid's single 'Bangalore' row ONLY when every one of them is
// requested together (a whole-cluster pick); a partial pick (e.g. Helsinki alone) has no
// honest answer in this data and stays uncovered.
// Deliberately still the original three, not the four CLUSTER_TREE now carries: Ibiza joined
// the cluster on 2026-09-16 and has no grid row of its own. Requiring it here would stop a
// Helsinki+Berlin+Hong Kong pick resolving to Bangalore, which it should still do. Ticking the
// whole cluster passes all four, satisfies this check on the three, and leaves Ibiza to
// contribute nothing — which is right, since the grid holds no target for it.
const HABIBI_MICROMARKETS = ['Helsinki', 'Berlin', 'Hong Kong']
function resolveMicromarkets(requested: string[]): string[] {
    if (!HABIBI_MICROMARKETS.every((m) => requested.includes(m))) return requested
    return [...requested.filter((m) => !HABIBI_MICROMARKETS.includes(m)), 'Bangalore']
}

export interface SellerTargets {
    leads: number
    ql: number
    newVisits: number
    oldVisits: number
    totalVisits: number
    newConv: number
    oldConv: number
    totalConv: number
    spendInr: number
    /** True when at least one grid cell matched the selection — false means the selection
     *  falls entirely outside the grid (e.g. only the Unmapped channel), so the caller can
     *  show a dash rather than a misleading zero. */
    covered: boolean
}

/** Visits/conversions column chosen the way card 739's selected_targets CASE does it:
 *  both scopes → total, New only → new, Old only → old, neither → 0. Exported so callers that
 *  only need one scoped number (the Overall Funnel's single actual/target pair) don't have to
 *  re-derive this from the three raw columns `sellerTargetsFor` now always returns. */
export function scoped(scope: Scope[], newVal: number, oldVal: number, totalVal: number): number {
    const hasNew = scope.includes('New')
    const hasOld = scope.includes('Old')
    if (hasNew && hasOld) return totalVal
    if (hasNew) return newVal
    if (hasOld) return oldVal
    return 0
}

/** Sums the grid over the selected channels and micromarkets. Returns every New/Old/Total
 *  column unscoped — callers needing one scoped number (e.g. the Overall Funnel) pick via
 *  `scoped()`; callers needing all three side by side (the Target vs Achieved table) read them
 *  directly. With no channel filter, sums the sheet's own 'Overall' row per micromarket rather
 *  than adding the 7 channels — they're close but not always identical (see the note atop this
 *  file), and the sheet's own total is the one the growth team actually sees, exactly mirroring
 *  lib/buyer/targets.ts's own 'ALL' row. Empty micromarkets means "all" (which already includes
 *  'Bangalore' as a real grid row, so the HABIBI total is never silently dropped from an
 *  unfiltered total). A named micromarket selection is resolved through resolveMicromarkets
 *  first, so a whole-HABIBI pick (Helsinki + Berlin + Hong Kong, exactly how the picker ticks a
 *  cluster) still finds the grid's combined Bangalore row. */
export function sellerTargetsFor(opts: { channels?: string[]; micromarkets?: string[] }): SellerTargets {
    const channels = opts.channels?.length ? opts.channels : ['Overall']
    const micromarkets = opts.micromarkets?.length ? resolveMicromarkets(opts.micromarkets) : [...ALL_MICROMARKETS]

    let leads = 0
    let ql = 0
    let newVisits = 0
    let oldVisits = 0
    let totalVisits = 0
    let newConv = 0
    let oldConv = 0
    let totalConv = 0
    let spendInr = 0
    let covered = false
    for (const c of channels) {
        for (const m of micromarkets) {
            const cell = CELL.get(`${c}|${m}`)
            if (!cell) continue
            covered = true
            leads += cell.leads
            ql += cell.ql
            newVisits += cell.newVisits
            oldVisits += cell.oldVisits
            totalVisits += cell.totalVisits
            newConv += cell.newConv
            oldConv += cell.oldConv
            totalConv += cell.totalConv
            spendInr += cell.spendInr
        }
    }
    return { leads, ql, newVisits, oldVisits, totalVisits, newConv, oldConv, totalConv, spendInr, covered }
}
