import { CLUSTER_TREE, IST_OFFSET_MS } from '@/lib/buyer/shared'
import { computeSellerSpendForWindow, computeSellerUnallocatedSpendForWindow } from './costs'
import type { SellerFacts } from './facts'
import { EMPTY_SELLER_FILTERS, type SellerFilters } from './filters'
import { sellerTargetsFor } from './targets'

// The seller-side sibling of lib/buyer/budgetPacing.ts — same daily-run-rate columns, same
// row layout, over seller's own channel/target taxonomy. See that file's doc comment for the
// shape of every column; nothing about the math differs here.
//
// Budgets are scoped to Paid Ads specifically (`sellerTargetsFor({ ..., channels: ['Paid
// Ads'] })`), never the default blended 'Overall' row `sellerTargetsFor({ micromarkets })`
// alone would return — the live ad-platform sheet this paces is Paid Ads spend only, so
// comparing it against an all-channel target understates % of budget spent. This is the exact
// bug the buyer table had until 2026-09-29; fixed here from the start.

const DAY_MS = 86400000

export interface BudgetPacingDetailRow {
    label: string
    kind: 'leaf' | 'subtotal' | 'grandTotal'
    quarterBudget: number | null
    shouldHaveSpentQtd: number | null
    spentTillYesterday: number
    lag: number | null
    pctOfBudgetSpent: number | null
    budgetLeft: number | null
    dailyExpectedToFinish: number | null
    dailyActualYesterday: number
    dailyActual7dAvg: number
    runwayDays: number | null
}

export interface BudgetPacingData {
    byChannel: BudgetPacingDetailRow[]
    byMicromarket: BudgetPacingDetailRow[]
}

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

/** Paid Ads only — see lib/buyer/budgetPacing.ts's buildChannelRows for why the other 6
 *  seller channels don't get a row here. */
function buildChannelRows(facts: SellerFacts, windows: Windows): BudgetPacingDetailRow[] {
    return ['Paid Ads'].map((channel) => {
        const filters: SellerFilters = { ...EMPTY_SELLER_FILTERS, channels: [channel] }
        const target = sellerTargetsFor({ channels: [channel] })
        const quarterBudget = target.covered ? target.spendInr : null
        return buildRow(channel, 'leaf', quarterBudget, windows, (s, e) => computeSellerSpendForWindow(facts, filters, s, e).total)
    })
}

/** Mirrors lib/buyer/budgetPacing.ts's buildMicromarketRows exactly — same PAV/GLAM/BABU
 *  grouping (CLUSTER_TREE is shared with buyer), same Bangalore/HABIBI target-grid alias, same
 *  row order and two grand totals. */
function buildMicromarketRows(facts: SellerFacts, windows: Windows): BudgetPacingDetailRow[] {
    const rowOf = (label: string, kind: BudgetPacingDetailRow['kind'], micromarkets: string[]) => {
        const filters: SellerFilters = { ...EMPTY_SELLER_FILTERS, micromarkets, channels: ['Paid Ads'] }
        const target = sellerTargetsFor({ micromarkets, channels: ['Paid Ads'] })
        const quarterBudget = target.covered ? target.spendInr : null
        return buildRow(label, kind, quarterBudget, windows, (s, e) => computeSellerSpendForWindow(facts, filters, s, e).total)
    }
    const unallocatedFilters: SellerFilters = { ...EMPTY_SELLER_FILTERS, channels: ['Paid Ads'] }
    const unallocatedComputer: SpendComputer = (s, e) => computeSellerUnallocatedSpendForWindow(facts, unallocatedFilters, s, e)
    const totalOf = (label: string, micromarkets: string[]) => {
        const filters: SellerFilters = { ...EMPTY_SELLER_FILTERS, micromarkets, channels: ['Paid Ads'] }
        const target = sellerTargetsFor({ micromarkets, channels: ['Paid Ads'] })
        const quarterBudget = target.covered ? target.spendInr : null
        return buildRow(label, 'grandTotal', quarterBudget, windows, (s, e) => computeSellerSpendForWindow(facts, filters, s, e).total + unallocatedComputer(s, e))
    }

    const pav = CLUSTER_TREE.PAV! // ['Powai', 'Vegas', 'Athens']
    const glam = CLUSTER_TREE.GLAM! // ['Glasgow', 'Amsterdam']
    const babu = CLUSTER_TREE.BABU! // ['Boston', 'Barcelona', 'Singapore']
    const babuExSingapore = babu.filter((mm) => mm !== 'Singapore')
    const exBlr = [...pav, ...glam, ...babu]
    // Helsinki+Berlin+Hong Kong together resolve to the grid's single combined 'Bangalore'
    // row via sellerTargetsFor's resolveMicromarkets — see targets.ts's own HABIBI note.
    const habibi = ['Helsinki', 'Berlin', 'Hong Kong']

    return [
        rowOf('Powai', 'leaf', ['Powai']),
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
        totalOf('TOTAL — Truva ex BLR', exBlr),
        rowOf('Bangalore', 'leaf', habibi),
        // No target: the grid has no cell for a campaign that named no micromarket at all.
        buildRow('All MM', 'leaf', null, windows, unallocatedComputer),
        totalOf('TOTAL — Truva inc. BLR', [...exBlr, ...habibi]),
    ]
}

export function computeSellerBudgetPacing(
    facts: SellerFacts,
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
