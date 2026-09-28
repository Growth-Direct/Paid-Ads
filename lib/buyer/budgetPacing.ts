import { computeSpendForWindow } from './costs'
import type { BuyerFacts } from './facts'
import { EMPTY_FILTERS, type BuyerFilters } from './filters'
import { CLUSTER_TREE, IST_OFFSET_MS } from './shared'
import { targetsFor } from './targets'

// The standalone Budget Pacing tab beside Buyer/Seller — daily-run-rate spend pacing by
// Channel and by Micromarket/Cluster, per the growth team's own explicit column list
// (2026-09-26). Reuses the same target grid (lib/buyer/targets.ts) and spend ledger
// (lib/buyer/costs.ts) as every other spend figure on this dashboard — no new data source,
// no new spend definition, just a different set of derived columns from it.
//
// Always the full reporting quarter: this tab has no time filter of its own, unlike the
// Buyer tab's Target vs Actuals table.
//
// Covers all 6 real channels (not just Paid Ads/3P) and every micromarket with a
// target-grid row — spend happens company-wide regardless of which leads currently count
// toward the Paid-Ads/3P-restricted buyer population (see shared.ts's isEligibleChannel).

const DAY_MS = 86400000

export interface BudgetPacingDetailRow {
    label: string
    /** Governs indent/weight in the table — a leaf micromarket/channel renders plain, a
     *  cluster subtotal or grand total renders bold/flush. Purely presentational. */
    kind: 'leaf' | 'subtotal' | 'grandTotal'
    /** The full-quarter Spend target for this cut — null when the grid has no cell for it. */
    quarterBudget: number | null
    /** quarterBudget paced by days elapsed as of right now (same paceShare formula as the
     *  Buyer tab's own Spend row) — "what we should have spent by today". */
    shouldHaveSpentQtd: number | null
    /** Spend from the quarter's start up to but NOT including today — deliberately excludes
     *  today's row, since the growth team's spend sheet is committed for the whole quarter up
     *  front (not filled in day by day), so a same-day figure would overcount. */
    spentTillYesterday: number
    /** shouldHaveSpentQtd minus spentTillYesterday. Positive = under plan, negative = over —
     *  same sign convention as every other Lag figure on this dashboard. Null when there's no
     *  target to compare against. */
    lag: number | null
    /** spentTillYesterday over quarterBudget, as a percentage. Null when there's no budget to
     *  divide by (never 0, which would misleadingly read as "0% spent, on track"). */
    pctOfBudgetSpent: number | null
    /** quarterBudget minus spentTillYesterday — what remains to spend this quarter. Null
     *  when there's no budget target for this cut. Can go negative if already overspent. */
    budgetLeft: number | null
    /** budgetLeft divided by the whole days remaining in the quarter (today through
     *  quarter-end) — the flat daily rate needed for the rest of the quarter to land exactly
     *  on the full-quarter budget. Null with no budget, or with the quarter already over. */
    dailyExpectedToFinish: number | null
    /** Spend on exactly yesterday's calendar date (IST). */
    dailyActualYesterday: number
    /** Average daily spend over the 7 complete days ending yesterday (not including today). */
    dailyActual7dAvg: number
    /** budgetLeft divided by dailyActual7dAvg — how many more days the remaining budget lasts
     *  at the recent pace. Null when the 7-day average is 0 (no pace to project) or there's no
     *  budget target. Negative means already spent past budgetLeft at that pace (over-budget). */
    runwayDays: number | null
}

export interface BudgetPacingData {
    byChannel: BudgetPacingDetailRow[]
    byMicromarket: BudgetPacingDetailRow[]
}

/** Midnight IST of the calendar day containing `d` — the "today" cutoff every column here is
 *  measured against, so "yesterday" and "the last 7 complete days" both exclude today. */
function startOfDayIST(d: Date): Date {
    const ist = new Date(d.getTime() + IST_OFFSET_MS)
    const day = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate())
    return new Date(day - IST_OFFSET_MS)
}

interface Windows {
    quarterStart: Date
    quarterEnd: Date
    todayStart: Date
    paceShare: number
}

/** Spend for a window, from whatever cut of `facts` this row represents. Pulled out to a
 *  callback rather than passing (facts, filters) straight into buildRow so every row —
 *  channel or micromarket — shares one spend/pacing calculation. */
type SpendComputer = (windowStart: Date, windowEnd: Date) => number

function buildRow(
    label: string,
    kind: BudgetPacingDetailRow['kind'],
    quarterBudget: number | null,
    windows: Windows,
    computeSpend: SpendComputer
): BudgetPacingDetailRow {
    const { quarterStart, quarterEnd, todayStart, paceShare } = windows
    const yesterdayStart = new Date(todayStart.getTime() - DAY_MS)
    const sevenDayStart = new Date(todayStart.getTime() - 7 * DAY_MS)

    const shouldHaveSpentQtd = quarterBudget == null ? null : Math.round(quarterBudget * paceShare * 1000) / 1000
    const spentTillYesterday = computeSpend(quarterStart, todayStart)
    const lag = shouldHaveSpentQtd == null ? null : Math.round((shouldHaveSpentQtd - spentTillYesterday) * 1000) / 1000
    const pctOfBudgetSpent =
        quarterBudget != null && quarterBudget > 0 ? Math.round((spentTillYesterday / quarterBudget) * 1000) / 10 : null
    const budgetLeft = quarterBudget == null ? null : Math.round((quarterBudget - spentTillYesterday) * 1000) / 1000

    const daysRemaining = Math.max(0, Math.round((quarterEnd.getTime() - todayStart.getTime()) / DAY_MS))
    const dailyExpectedToFinish = budgetLeft == null || daysRemaining <= 0 ? null : Math.round((budgetLeft / daysRemaining) * 1000) / 1000

    const dailyActualYesterday = computeSpend(yesterdayStart, todayStart)
    const sevenDayTotal = computeSpend(sevenDayStart, todayStart)
    const dailyActual7dAvg = Math.round((sevenDayTotal / 7) * 1000) / 1000
    const runwayDays = budgetLeft == null || dailyActual7dAvg <= 0 ? null : Math.round((budgetLeft / dailyActual7dAvg) * 10) / 10

    return {
        label,
        kind,
        quarterBudget,
        shouldHaveSpentQtd,
        spentTillYesterday,
        lag,
        pctOfBudgetSpent,
        budgetLeft,
        dailyExpectedToFinish,
        dailyActualYesterday,
        dailyActual7dAvg,
        runwayDays,
    }
}

/** Paid Ads only — per the growth team (2026-09-29), Budget Pacing paces ad spend
 *  specifically, not the other 5 channels in ACTIONABLE_CHANNELS. The live ad-platform sheet
 *  this table reads (see lib/buyer/spend/liveSheet.ts) only ever contains Paid Ads rows
 *  anyway, so a 3P/Offline/etc. row would show real budget against zero measurable spend. */
function buildChannelRows(facts: BuyerFacts, windows: Windows): BudgetPacingDetailRow[] {
    return ['Paid Ads'].map((channel) => {
        const filters: BuyerFilters = { ...EMPTY_FILTERS, channels: [channel] }
        const quarterBudget = targetsFor({ channels: [channel] })?.spendInr ?? null
        return buildRow(channel, 'leaf', quarterBudget, windows, (s, e) => computeSpendForWindow(facts, filters, s, e))
    })
}

/** Micromarkets grouped under their cluster with a cluster subtotal after each group, plus
 *  Bangalore (HABIBI's target-grid alias — see CLUSTER_TARGET_ALIAS) and two grand totals, in
 *  the exact order the growth team asked for. BABU gets both an inclusive-of-Singapore and an
 *  excluding-Singapore subtotal, per their own spec — not a general pattern, just this one
 *  cluster's own two readings.
 *
 *  Budgets are scoped to Paid Ads specifically (`targetsFor({ micromarkets, channels: ['Paid
 *  Ads'] })`), NOT the default all-channel 'ALL' row `targetsFor({ micromarkets })` would
 *  return — this table paces the live ad-platform sheet's spend, which is Paid Ads only, so
 *  the budget it's measured against has to be too. Verified against the growth team's own
 *  reference table 2026-09-29: Powai's Paid Ads target is ₹7,67,041, not the ALL-channel
 *  ₹13,26,737 this used to compare against, and the two "TOTAL" rows below sum to exactly the
 *  reference's ₹61,57,528 / ₹62,05,528 only under the Paid Ads scoping. Getting this wrong
 *  doesn't just mislabel a number — it makes every % of budget spent read far too low. */
function buildMicromarketRows(facts: BuyerFacts, windows: Windows): BudgetPacingDetailRow[] {
    const rowOf = (label: string, kind: BudgetPacingDetailRow['kind'], micromarkets: string[]) => {
        const filters: BuyerFilters = { ...EMPTY_FILTERS, micromarkets, channels: ['Paid Ads'] }
        const quarterBudget = targetsFor({ micromarkets, channels: ['Paid Ads'] })?.spendInr ?? null
        return buildRow(label, kind, quarterBudget, windows, (s, e) => computeSpendForWindow(facts, filters, s, e))
    }

    const pav = CLUSTER_TREE.PAV! // ['Powai', 'Vegas', 'Athens']
    const glam = CLUSTER_TREE.GLAM! // ['Glasgow', 'Amsterdam']
    const babu = CLUSTER_TREE.BABU! // ['Boston', 'Barcelona', 'Singapore']
    const babuExSingapore = babu.filter((mm) => mm !== 'Singapore')
    const exBlr = [...pav, ...glam, ...babu]
    const incBlr = [...exBlr, 'Bangalore']

    return [
        rowOf('Powai', 'leaf', ['Powai']),
        // The growth team's real-world name for what the target grid calls "Athens" —
        // see targets.ts's own header comment.
        rowOf('Andheri (E)', 'leaf', ['Athens']),
        rowOf('Vegas', 'leaf', ['Vegas']),
        rowOf('PAV', 'subtotal', pav),
        rowOf('Glasgow', 'leaf', ['Glasgow']),
        rowOf('Amsterdam', 'leaf', ['Amsterdam']),
        rowOf('GLAM', 'subtotal', glam),
        rowOf('Boston', 'leaf', ['Boston']),
        rowOf('Barcelona', 'leaf', ['Barcelona']),
        rowOf('Singapore', 'leaf', ['Singapore']),
        rowOf('BABU (incl. Singapore)', 'subtotal', babu),
        rowOf('BABU ex Singapore', 'subtotal', babuExSingapore),
        rowOf('TOTAL — Truva ex BLR', 'grandTotal', exBlr),
        rowOf('Bangalore', 'leaf', ['Bangalore']),
        rowOf('TOTAL — Truva inc. BLR', 'grandTotal', incBlr),
    ]
}

export function computeBudgetPacing(
    facts: BuyerFacts,
    opts: { quarterStart: Date; quarterEnd: Date; now: Date }
): BudgetPacingData {
    const { quarterStart, quarterEnd, now } = opts
    const todayStart = startOfDayIST(now)
    const daysElapsed = (todayStart.getTime() - quarterStart.getTime()) / DAY_MS
    const daysTotal = (quarterEnd.getTime() - quarterStart.getTime()) / DAY_MS
    const paceShare = daysTotal > 0 ? Math.min(1, Math.max(0, daysElapsed / daysTotal)) : 0
    const windows: Windows = { quarterStart, quarterEnd, todayStart, paceShare }

    return {
        byChannel: buildChannelRows(facts, windows),
        byMicromarket: buildMicromarketRows(facts, windows),
    }
}
