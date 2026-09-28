import type { Scope } from './filters'
import { mapSellerChannel } from './shared'

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
// Refreshed 2026-09-24 against a re-exported copy of the same tab
// (Truva_JAS26_Planning_ChannelLevel_Dashboard Sheet.xlsx) — six cells changed (leads/ql/
// visits/conversions only, per the growth team's own scoped request; spendInr was left as
// transcribed before, since spend wasn't part of that refresh): Paid Ads/Powai (leads, ql,
// visits all up), Paid Ads/Bangalore (leads 200→48), Cold Outreach/Vegas (New Conv 2→1),
// Overall/Powai (leads, ql, visits all up), Overall/Vegas (Conv reallocated New→Old, same
// total), Overall/Bangalore (leads 748→576). Every other cell in the grid was diffed
// programmatically against the new sheet and found unchanged.
//
// Each micromarket ALSO carries an 'Overall' row — the sheet's own pre-computed all-channels
// total (same tab, rows 21-51/276, filtered to Channel = Overall), not the sum of the 7
// channel rows below. The two are close but not always identical (e.g. Powai's own channel
// rows now sum to 310 Leads, the sheet's Overall row says 309) — a rounding-carry difference
// in the sheet itself, same reason lib/buyer/targets.ts's own 'ALL' row exists instead of an
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
    ['Paid Ads', 'Powai', 31, 11, 7, 3, 10, 1, 0, 1, 118780],
    ['Paid Ads', 'Vegas', 59, 5, 3, 1, 4, 0, 1, 1, 30000],
    ['Paid Ads', 'Athens', 18, 3, 2, 0, 2, 0, 0, 0, 20000],
    ['Paid Ads', 'Glasgow', 52, 15, 9, 4, 13, 1, 0, 1, 127500],
    ['Paid Ads', 'Amsterdam', 55, 13, 9, 1, 10, 1, 0, 1, 39121],
    ['Paid Ads', 'Boston', 11, 3, 2, 1, 3, 0, 0, 0, 36667],
    ['Paid Ads', 'Barcelona', 7, 2, 1, 0, 1, 0, 0, 0, 30000],
    ['Paid Ads', 'Singapore', 7, 2, 1, 0, 1, 0, 0, 0, 18000],
    ['Paid Ads', 'Bangalore', 48, 10, 6, 0, 6, 0, 0, 0, 18238],

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
    ['Cold Outreach', 'Vegas', 65, 13, 7, 0, 7, 1, 0, 1, 39000],
    ['Cold Outreach', 'Athens', 70, 14, 10, 0, 10, 1, 0, 1, 700],
    ['Cold Outreach', 'Glasgow', 115, 23, 16, 0, 16, 1, 2, 3, 69000],
    ['Cold Outreach', 'Amsterdam', 150, 30, 21, 0, 21, 2, 0, 2, 90000],
    ['Cold Outreach', 'Boston', 45, 9, 5, 0, 5, 0, 0, 0, 27000],
    ['Cold Outreach', 'Barcelona', 55, 11, 7, 0, 7, 1, 0, 1, 33000],
    ['Cold Outreach', 'Singapore', 55, 11, 4, 0, 4, 0, 0, 0, 33000],
    ['Cold Outreach', 'Bangalore', 417, 50, 15, 0, 15, 0, 0, 0, 0],

    // The sheet's own all-channels total per micromarket (Channel = 'Overall', JAS rows) — see
    // the note above. Used by sellerTargetsFor whenever no channel filter narrows the query.
    ['Overall', 'Powai', 309, 125, 61, 9, 70, 9, 0, 9, 812380],
    ['Overall', 'Vegas', 297, 96, 50, 5, 55, 5, 1, 6, 399200],
    ['Overall', 'Athens', 143, 39, 23, 1, 24, 2, 0, 2, 87780],
    ['Overall', 'Glasgow', 342, 103, 57, 9, 66, 6, 3, 9, 651460],
    ['Overall', 'Amsterdam', 383, 98, 58, 1, 59, 5, 0, 5, 467536],
    ['Overall', 'Boston', 111, 40, 21, 4, 25, 1, 0, 1, 87027],
    ['Overall', 'Barcelona', 107, 37, 17, 0, 17, 1, 0, 1, 161040],
    ['Overall', 'Singapore', 143, 58, 24, 0, 24, 2, 0, 2, 155850],
    ['Overall', 'Bangalore', 576, 104, 40, 0, 40, 1, 0, 1, 280038],
]

// The sheet's own "All clusters" summary row (same tab, Channel = 'Overall', Micromarket =
// 'All clusters', JAS row) — the true no-filter total the growth team actually looks at.
// Verified 2026-09-24 NOT to be a sum of the 9 named-micromarket 'Overall' rows above: this
// row's own Leads/QL are computed on a different, non-additive basis (Leads carries some kind
// of blended/forecast weighting even at this aggregate level, and doesn't decompose against
// any combination of the visible rows tried — not "+Unattributed", not "+Bangalore/HABIBI",
// not both). QL alone happens to reconcile closely against PAV+GLAM+Babu's own cluster
// subtotals (596.67 here vs 596.67 summed) — i.e. this row excludes Bangalore/HABIBI and
// Unattributed leads entirely — but Leads does not reconcile by the same logic, so this row is
// transcribed as its own independent total rather than derived. Summing the 9 micromarkets
// instead gives a materially different LTQL (29% vs this row's 14.4%), confirmed with the user
// as the wrong number for the true unfiltered case — this row is now used there instead.
// The sheet's own 'All clusters' row (see the doc comment below) PLUS the Overall/Bangalore
// row on top — corrected 2026-09-24: the truly-unfiltered case must include HABIBI/Bangalore
// sellers, since the ACHIEVED figures it's compared against always do (no filter means every
// seller everywhere), and every OTHER channel's own "all clusters" total is confirmed to mean
// "all clusters + Bangalore" (e.g. Cold Outreach: 131 + 50 = 181, confirmed live with the
// user). The first version of this fix used the 'All clusters' row alone (4,147 Leads), missing
// Bangalore's own 576 — the same gap just found and fixed for every other channel, applied here
// too for consistency. Overall/Bangalore JAS: Leads 576, QL 104, Visits 40/0/40, Conv 1/0/1,
// Spend 280,038.
const ALL_CLUSTERS_TOTAL: Cell = {
    leads: 4723,
    ql: 701,
    newVisits: 351,
    oldVisits: 29,
    totalVisits: 380,
    newConv: 32,
    oldConv: 4,
    totalConv: 36,
    spendInr: 3285375,
}

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

// Each channel's own "All clusters" row (same tab, Channel = that channel's own name, JAS row,
// Micromarket = 'All clusters') — read directly off the sheet, the same way ALL_CLUSTERS_TOTAL
// is for Overall. Replaced the previous "sum the 8 named micromarkets + a separately-maintained
// per-channel Unattributed constant" reconstruction 2026-09-24, per an explicit growth-team
// report: "jas targets not matching for channels... Unattributed has been skipped. Only use all
// clusters targets." Re-verified against a fresh extract of the same sheet/tab (Channel =
// <name>, Micromarket = 'All clusters', Quarter = 'JAS'):
//
// | Channel | Spends | Leads | QL | Old/New/Total Visits | Old/New/Total Conv |
// |---|---|---|---|---|---|
// | Paid Ads | 603,132 | 1,452 | 55 | 10/34/44 | 1/3/4 |
// | 3P | 55,505 | 371 | 117 | 6/41/47 | 1/1/2 |
// | Offline Branding | 1,275,000 | 140 | 92 | 4/42/46 | 0/6/6 |
// | Referral & WOM | 720,000 | 79 | 47 | 0/30/30 | 0/6/6 |
// | Organic | 0 | 1,401 | 122 | 7/61/68 | 0/5/5 |
// | Society WA Groups & Management Apps | 0 | 48 | 33 | 2/20/22 | 0/2/2 |
// | Cold Outreach | 351,700 | 655 | 131 | 0/83/83 | 2/8/10 |
//
// Combined with the channel's own Bangalore row on top (in sellerTargetsFor, not baked into
// these constants) — same "all clusters + Bangalore" combination ALL_CLUSTERS_TOTAL uses for
// Overall. First shipped WITHOUT that addition (matching this cell alone); corrected the same
// day per the user ("offline branding is 140, was supposed to be 193 with blr") — a
// whole-Channel pick's achieved figures always include that channel's Bangalore/HABIBI
// sellers (no micromarket filter means every micromarket), so its target must too. 140
// (Offline Branding's own row above) + 52 (its own Bangalore row, from ROWS) = 192 — one off
// the user's own "193", within the sheet's usual rounding noise (the row above is itself a
// rounded transcription of 140.39).
const CHANNEL_ALL_CLUSTERS: Partial<Record<string, Cell>> = {
    'Paid Ads': { leads: 1452, ql: 55, newVisits: 34, oldVisits: 10, totalVisits: 44, newConv: 3, oldConv: 1, totalConv: 4, spendInr: 603132 },
    '3P': { leads: 371, ql: 117, newVisits: 41, oldVisits: 6, totalVisits: 47, newConv: 1, oldConv: 1, totalConv: 2, spendInr: 55505 },
    'Offline Branding': { leads: 140, ql: 92, newVisits: 42, oldVisits: 4, totalVisits: 46, newConv: 6, oldConv: 0, totalConv: 6, spendInr: 1275000 },
    'Referral & WOM': { leads: 79, ql: 47, newVisits: 30, oldVisits: 0, totalVisits: 30, newConv: 6, oldConv: 0, totalConv: 6, spendInr: 720000 },
    Organic: { leads: 1401, ql: 122, newVisits: 61, oldVisits: 7, totalVisits: 68, newConv: 5, oldConv: 0, totalConv: 5, spendInr: 0 },
    'Society WA Groups & Management Apps': {
        leads: 48,
        ql: 33,
        newVisits: 20,
        oldVisits: 2,
        totalVisits: 22,
        newConv: 2,
        oldConv: 0,
        totalConv: 2,
        spendInr: 0,
    },
    'Cold Outreach': { leads: 655, ql: 131, newVisits: 83, oldVisits: 0, totalVisits: 83, newConv: 8, oldConv: 2, totalConv: 10, spendInr: 351700 },
}

// The four real Truva_Micromarket values (CLUSTER_TREE's HABIBI group) with no grid row of
// their own — see the HABIBI note up top. Confirmed with the user 2026-09-24: this maps
// "cluster-wise", the same way a lone raw Source maps to its parent Channel below — ANY one of
// these picked, alone or with others, resolves to the grid's single combined 'Bangalore' row,
// not just a whole-cluster pick. There is no finer-grained target data to fall back to, so the
// enclosing cluster's own combined figure is the best honest answer, same reasoning as the
// source-to-channel fallback.
const HABIBI_MICROMARKETS = ['Helsinki', 'Berlin', 'Hong Kong', 'Ibiza']
function resolveMicromarkets(requested: string[]): string[] {
    if (!HABIBI_MICROMARKETS.some((m) => requested.includes(m))) return requested
    const withoutHabibi = requested.filter((m) => !HABIBI_MICROMARKETS.includes(m))
    return withoutHabibi.includes('Bangalore') ? withoutHabibi : [...withoutHabibi, 'Bangalore']
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
/** True when a Cluster/MM selection — once resolved (HABIBI members collapsed to Bangalore) —
 *  covers every real grid micromarket, i.e. ticking every checkbox in the picker. This must
 *  read identically to ticking none of them (both mean "no restriction"), but before this fix
 *  it silently fell through to the per-cell-sum branch instead of the "no filter" shortcut,
 *  giving a materially different number: confirmed with the user 2026-09-24 after "how is the
 *  4723 when every cluster is deselected and 2411 when all clusters and unmapped are selected.
 *  should be the same" — summing all 9 named-micromarket cells (2,411) is not, and per
 *  ALL_CLUSTERS_TOTAL's own doc comment can never be made to reconcile with, the sheet's own
 *  independent "All clusters" total (4,723 combined with Bangalore). 'Unmapped' being also
 *  ticked (or not) makes no numeric difference either way — it has no cell of its own in the
 *  grid, so it contributes 0 to a per-cell sum regardless; only the 9 real micromarkets matter
 *  for this check. */
function selectionCoversAllMicromarkets(resolvedMicromarkets: string[]): boolean {
    const set = new Set(resolvedMicromarkets)
    return [...ALL_MICROMARKETS].every((m) => set.has(m))
}

export function sellerTargetsFor(opts: { channels?: string[]; micromarkets?: string[]; sources?: string[] }): SellerTargets {
    const resolvedMicromarkets = opts.micromarkets?.length ? resolveMicromarkets(opts.micromarkets) : [...ALL_MICROMARKETS]
    // "Effectively no Cluster/MM filter" — either nothing was picked, or enough was picked that
    // it covers the whole grid anyway (see selectionCoversAllMicromarkets's doc comment).
    const microFilterIsEmpty = !opts.micromarkets?.length || selectionCoversAllMicromarkets(resolvedMicromarkets)

    // The truly unfiltered case (no Channel, no Source, and no Cluster/MM filter — or one that
    // covers everything anyway) uses the sheet's own 'All clusters' row directly instead of
    // summing the 9 micromarkets below — see ALL_CLUSTERS_TOTAL's own doc comment for why the
    // two numbers genuinely disagree.
    if (!opts.channels?.length && microFilterIsEmpty && !opts.sources?.length) {
        return { ...ALL_CLUSTERS_TOTAL, covered: true }
    }
    // A raw source ticked without its own parent Channel checkbox (e.g. "Society Data - Cold
    // Call" without "Cold Outreach") maps to that source's own parent Channel's target via
    // mapSellerChannel — confirmed with the user 2026-09-24, the same "map to the nearest thing
    // that DOES have a cell" principle as HABIBI's own micromarket-to-cluster fallback below.
    // Only consulted when `channels` itself is empty — an explicit whole-Channel pick always
    // wins, mirroring sellerMatchesChannel's own "source narrows within channel" precedence on
    // the achieved side.
    const channels: string[] = opts.channels?.length
        ? opts.channels
        : opts.sources?.length
          ? [...new Set(opts.sources.map((s) => mapSellerChannel(s)).filter((c) => c != null))]
          : ['Overall']
    const micromarkets = resolvedMicromarkets
    // Whether to read each channel's own CHANNEL_ALL_CLUSTERS row directly below, instead of
    // summing the 9 named-micromarket cells — whenever there's no Cluster/MM filter narrowing
    // the result (or, as above, one that covers the whole grid anyway). Applies the same way
    // whether `channels` came from an explicit Channel tick or a lone-Source fallback above —
    // earlier this session the two were deliberately split (a lone Source didn't get the
    // channel's Unattributed leads folded in, since crediting them to one specific raw source
    // would invent data that doesn't exist), but that distinction no longer applies:
    // CHANNEL_ALL_CLUSTERS is read verbatim, not reconstructed from parts, so there's nothing
    // left to selectively fold in. A lone Source under a channel now reads the exact same "All
    // clusters" target as ticking that whole channel directly, same "nearest thing that DOES
    // have a cell" principle as the mapping above.
    const useChannelAllClusters = microFilterIsEmpty

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
        if (useChannelAllClusters) {
            // The channel's own "All clusters" row PLUS its own Bangalore row on top — mirrors
            // ALL_CLUSTERS_TOTAL's own "All clusters + Bangalore" combination exactly. Corrected
            // 2026-09-25 per the user ("offline branding is 140, was supposed to be 193 with
            // blr") — a whole-Channel pick's achieved figures always include that channel's
            // Bangalore/HABIBI sellers (no micromarket filter means every micromarket), so its
            // target must too, same reasoning as the Overall case.
            const cell = CHANNEL_ALL_CLUSTERS[c]
            const bangalore = CELL.get(`${c}|Bangalore`)
            if (cell) {
                covered = true
                leads += cell.leads + (bangalore?.leads ?? 0)
                ql += cell.ql + (bangalore?.ql ?? 0)
                newVisits += cell.newVisits + (bangalore?.newVisits ?? 0)
                oldVisits += cell.oldVisits + (bangalore?.oldVisits ?? 0)
                totalVisits += cell.totalVisits + (bangalore?.totalVisits ?? 0)
                newConv += cell.newConv + (bangalore?.newConv ?? 0)
                oldConv += cell.oldConv + (bangalore?.oldConv ?? 0)
                totalConv += cell.totalConv + (bangalore?.totalConv ?? 0)
                spendInr += cell.spendInr + (bangalore?.spendInr ?? 0)
            }
            continue
        }
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
