// JAS 2026 targets, transcribed from the growth team's channel x micromarket sheet
// (owned by Nikita). Static on purpose: the grid changes once a quarter, at the same
// moment QUARTER_START_ISO and QUARTER_END_ISO have to be rolled forward, so one edit
// keeps both in step. Replace wholesale each quarter.
//
// Columns, in order: leads, qualified, oldVisits, newVisits, totalVisits,
// oldConversions, newConversions, totalConversions, spendInr.
//
// Every Warm Leads is NOT a column in the sheet. Nikita confirmed it is set at 20% of
// the Total Visits target, so it is derived rather than stored — see warmFromVisits.
//
// CPL/CPQL/CPV/CAC are NOT stored either — the sheet's own CPQL/CPV/CAC columns are
// exactly Spend divided by QL/New Visits/New Conversions respectively (verified against
// the sheet's Powai row: 13,26,737 / 543 = 2,442 = CPQL; /130 = 10,206 = CPV; /6 = 2,21,123
// = CAC), so every cost target is computed downstream from spendInr the same way the
// achieved cost figures are, rather than transcribed a second time.
//
// Micromarket names are ours (Athens, not "Andheri (E)"), and channel names match
// CHANNEL_MAP's output, not the sheet's spellings ("Society WA + Managemnt Groups",
// "Organic (IG+Website)", "Referral + WOM").

export type TargetMetrics = {
    leads: number
    qualified: number
    oldVisits: number
    newVisits: number
    totalVisits: number
    oldConversions: number
    newConversions: number
    totalConversions: number
    spendInr: number
}

/** The share of Total Visits that should turn warm. Confirmed by Nikita 2026-09-01:
 *  "Ever warm we've to consider 20% as target". */
export const WARM_SHARE_OF_VISITS = 0.2

export function warmFromVisits(totalVisits: number): number {
    return Math.round(totalVisits * WARM_SHARE_OF_VISITS * 100) / 100
}

type Row = [string, string, number, number, number, number, number, number, number, number, number]

// channel, micromarket|cluster|ALL, leads, qual, oldV, newV, totalV, oldC, newC, totalC, spendInr
const ROWS: Row[] = [
    ['ALL', 'Powai', 1695, 543, 62, 130, 192, 3, 6, 9, 1326737],
    ['ALL', 'Vegas', 1040, 313, 31, 79.7, 110.8, 2, 4, 6, 702961],
    ['ALL', 'Athens', 579, 155, 6, 31, 37, 0, 1, 1, 282512],
    ['ALL', 'Glasgow', 1599, 578, 34, 139, 173, 2, 5, 7, 1433558],
    ['ALL', 'Amsterdam', 879, 293, 17, 60, 77, 1, 2, 3, 530136],
    ['ALL', 'Boston', 551, 172, 4, 44, 48, 0, 2, 2, 1085964],
    ['ALL', 'Barcelona', 503, 186, 5, 27, 32, 0, 1, 1, 2044936],
    ['ALL', 'Singapore', 677, 202, 0, 38, 38, 0, 1, 1, 895468],
    ['ALL', 'Bangalore', 231, 52, 0, 15, 15, 0, 0, 0, 171968],

    ['Paid Ads', 'Powai', 1125, 382, 35, 65, 100, 2, 2, 4, 767041],
    ['Paid Ads', 'Vegas', 582, 194, 18, 31, 48.8, 1, 1, 2, 541713],
    ['Paid Ads', 'Athens', 379, 114, 4, 16, 20, 0, 1, 1, 205200],
    ['Paid Ads', 'Glasgow', 975, 398, 27, 64, 91, 2, 1, 3, 913374],
    ['Paid Ads', 'Amsterdam', 671, 219, 15, 35, 50, 1, 1, 2, 394200],
    ['Paid Ads', 'Boston', 363, 115, 4, 21, 25, 0, 1, 1, 747500],
    ['Paid Ads', 'Barcelona', 418, 167, 5, 20, 25, 0, 1, 1, 1837000],
    ['Paid Ads', 'Singapore', 557, 167, 0, 25, 25, 0, 1, 1, 751500],
    ['Paid Ads', 'Bangalore', 44, 12, 0, 3, 3, 0, 0, 0, 48000],

    ['3P', 'Powai', 367, 44, 8, 12, 20, 1, 0, 1, 234496],
    ['3P', 'Vegas', 285, 37, 5, 13, 18, 0, 1, 1, 117248],
    ['3P', 'Athens', 139, 17, 2, 5, 7, 0, 0, 0, 29312],
    ['3P', 'Glasgow', 349, 45, 7, 10, 17, 0, 1, 1, 205184],
    ['3P', 'Amsterdam', 120, 30, 2, 6, 8, 0, 0, 0, 87936],
    ['3P', 'Boston', 113, 17, 0, 5, 5, 0, 0, 0, 278464],
    ['3P', 'Barcelona', 42, 5, 0, 2, 2, 0, 0, 0, 87936],
    ['3P', 'Singapore', 67, 10, 0, 3, 3, 0, 0, 0, 43968],
    ['3P', 'Bangalore', 89, 8, 0, 2, 2, 0, 0, 0, 43968],

    ['Offline Branding', 'Powai', 54, 38, 0, 20, 20, 0, 1, 1, 205200],
    ['Offline Branding', 'Vegas', 16, 8, 0, 5, 5, 0, 0, 0, 44000],
    ['Offline Branding', 'Athens', 16, 8, 0, 3, 3, 0, 0, 0, 48000],
    ['Offline Branding', 'Glasgow', 86, 30, 0, 15, 15, 0, 0, 0, 195000],
    ['Offline Branding', 'Amsterdam', 15, 6, 0, 5, 5, 0, 0, 0, 48000],
    ['Offline Branding', 'Boston', 25, 10, 0, 3, 3, 0, 0, 0, 60000],
    ['Offline Branding', 'Barcelona', 33, 10, 0, 3, 3, 0, 0, 0, 120000],
    ['Offline Branding', 'Singapore', 20, 10, 0, 3, 3, 0, 0, 0, 100000],
    ['Offline Branding', 'Bangalore', 33, 10, 0, 3, 3, 0, 0, 0, 80000],

    ['Society WA Groups & Management Apps', 'Powai', 20, 10, 3, 6, 9, 0, 1, 1, 0],
    ['Society WA Groups & Management Apps', 'Vegas', 35, 14, 2, 7, 9, 0, 1, 1, 0],
    ['Society WA Groups & Management Apps', 'Athens', 12, 6, 0, 3, 3, 0, 0, 0, 0],
    ['Society WA Groups & Management Apps', 'Glasgow', 22, 13, 0, 10, 10, 0, 1, 1, 0],
    ['Society WA Groups & Management Apps', 'Amsterdam', 8, 4, 0, 2, 2, 0, 0, 0, 0],
    ['Society WA Groups & Management Apps', 'Boston', 6, 4, 0, 2, 2, 0, 0, 0, 0],
    ['Society WA Groups & Management Apps', 'Barcelona', 0, 0, 0, 0, 0, 0, 0, 0, 0],
    ['Society WA Groups & Management Apps', 'Singapore', 8, 5, 0, 2, 2, 0, 0, 0, 0],
    ['Society WA Groups & Management Apps', 'Bangalore', 8, 5, 0, 2, 2, 0, 0, 0, 0],

    ['Organic', 'Powai', 98, 49, 16, 17, 33, 0, 1, 1, 0],
    ['Organic', 'Vegas', 111, 50, 5, 20, 25, 1, 1, 2, 0],
    ['Organic', 'Athens', 33, 10, 0, 4, 4, 0, 0, 0, 0],
    ['Organic', 'Glasgow', 134, 67, 0, 30, 30, 0, 1, 1, 0],
    ['Organic', 'Amsterdam', 58, 29, 0, 10, 10, 0, 1, 1, 0],
    ['Organic', 'Boston', 43, 26, 0, 13, 13, 0, 1, 1, 0],
    ['Organic', 'Barcelona', 10, 4, 0, 2, 2, 0, 0, 0, 0],
    ['Organic', 'Singapore', 25, 10, 0, 5, 5, 0, 0, 0, 0],
    ['Organic', 'Bangalore', 57, 17, 0, 5, 5, 0, 0, 0, 0],

    ['Referral & WOM', 'Powai', 32, 20, 0, 10, 10, 0, 1, 1, 120000],
    ['Referral & WOM', 'Vegas', 11, 10, 1, 4, 5, 0, 0, 0, 0],
    ['Referral & WOM', 'Athens', 0, 0, 0, 0, 0, 0, 0, 0, 0],
    ['Referral & WOM', 'Glasgow', 33, 25, 0, 10, 10, 0, 1, 1, 120000],
    ['Referral & WOM', 'Amsterdam', 7, 5, 0, 2, 2, 0, 0, 0, 0],
    ['Referral & WOM', 'Boston', 0, 0, 0, 0, 0, 0, 0, 0, 0],
    ['Referral & WOM', 'Barcelona', 0, 0, 0, 0, 0, 0, 0, 0, 0],
    ['Referral & WOM', 'Singapore', 0, 0, 0, 0, 0, 0, 0, 0, 0],
    ['Referral & WOM', 'Bangalore', 0, 0, 0, 0, 0, 0, 0, 0, 0],
]

const EMPTY: TargetMetrics = {
    leads: 0,
    qualified: 0,
    oldVisits: 0,
    newVisits: 0,
    totalVisits: 0,
    oldConversions: 0,
    newConversions: 0,
    totalConversions: 0,
    spendInr: 0,
}

function add(a: TargetMetrics, b: TargetMetrics): TargetMetrics {
    return {
        leads: a.leads + b.leads,
        qualified: a.qualified + b.qualified,
        oldVisits: a.oldVisits + b.oldVisits,
        newVisits: a.newVisits + b.newVisits,
        totalVisits: a.totalVisits + b.totalVisits,
        oldConversions: a.oldConversions + b.oldConversions,
        newConversions: a.newConversions + b.newConversions,
        totalConversions: a.totalConversions + b.totalConversions,
        spendInr: a.spendInr + b.spendInr,
    }
}

const CELL = new Map<string, TargetMetrics>()
for (const [channel, mm, leads, qualified, oldVisits, newVisits, totalVisits, oldC, newC, totalC, spendInr] of ROWS) {
    CELL.set(`${channel}|${mm}`, {
        leads,
        qualified,
        oldVisits,
        newVisits,
        totalVisits,
        oldConversions: oldC,
        newConversions: newC,
        totalConversions: totalC,
        spendInr,
    })
}

/** Sums the grid over the selected channels and micromarkets. An empty selection means
 *  everything. Returns null when nothing in the grid covers the selection, so the caller
 *  can show a dash instead of a misleading zero. */
export function targetsFor(opts: { channels?: string[]; micromarkets?: string[] }): TargetMetrics | null {
    const allMms = [...new Set(ROWS.map((r) => r[1]))]
    const allChannels = [...new Set(ROWS.map((r) => r[0]))].filter((c) => c !== 'ALL')

    const mms = opts.micromarkets?.length ? opts.micromarkets : allMms
    // With no channel filter, use the pre-summed ALL row rather than adding the six
    // channels — the sheet's own totals differ from the sum by a rounding unit or two.
    const channels = opts.channels?.length ? opts.channels : ['ALL']
    void allChannels

    let out: TargetMetrics | null = null
    for (const c of channels) {
        for (const m of mms) {
            const cell = CELL.get(`${c}|${m}`)
            if (!cell) continue
            out = add(out ?? EMPTY, cell)
        }
    }
    return out
}

const divTarget = (n: number, d: number): number | null => (n > 0 && d > 0 ? n / d : null)

/** The funnel rows, in dashboard order, for a given selection — counts, spend, and the
 *  cost ratios derived from spend the same way the achieved figures are. */
export function funnelTargetsFor(opts: { channels?: string[]; micromarkets?: string[] }): Record<string, number> | null {
    const t = targetsFor(opts)
    if (!t) return null
    const out: Record<string, number> = {
        'Total Leads': t.leads,
        'Qualified Leads': t.qualified,
        'New Visits': t.newVisits,
        'Old Visits': t.oldVisits,
        'Total Visits': t.totalVisits,
        'Every Warm Leads': warmFromVisits(t.totalVisits),
        'New Conversions': t.newConversions,
        'Old Conversions': t.oldConversions,
        'Total Conversions': t.totalConversions,
        Spend: t.spendInr,
    }
    const cpl = divTarget(t.spendInr, t.leads)
    const cpql = divTarget(t.spendInr, t.qualified)
    const cpv = divTarget(t.spendInr, t.newVisits)
    const cac = divTarget(t.spendInr, t.newConversions)
    if (cpl != null) out.CPL = cpl
    if (cpql != null) out.CPQL = cpql
    if (cpv != null) out.CPV = cpv
    if (cac != null) out.CAC = cac
    return out
}
