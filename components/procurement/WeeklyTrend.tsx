'use client'

import WoWStackedBar from '@/components/buyer/WoWStackedBar'
import { SERIES_COLORS } from '@/components/buyer/palette'
import ChartCard from '@/components/shared/ChartCard'
import type { WeekSeriesPoint } from '@/lib/buyer/types'
import type { WeeklyProcurement } from '@/lib/procurement/types'
import { useMemo } from 'react'

// Week-over-week procurement, drawn with the same chart the Buyer tab uses for leads by source —
// same Weekly/Bi-Weekly and Count/% toggles, same stacking, same hatched partial week. Reused
// rather than rebuilt so the two tabs cannot drift into two different ideas of what a week is.
//
// **The x-axis is when data was loaded, not when a home was visited.** `Created_Time` is the only
// timestamp a Zoho record carries. The imports are lumpy — 8,113 owners in one week, 8 in another
// — so the bars are a staircase, and the caption says so rather than leaving it to be inferred.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** `2026-08-17` -> `17 Aug`, the shape WoWStackedBar expects and builds its ranges from. */
function weekLabel(week: string): string {
    const [y, m, d] = week.split('-').map(Number)
    if (!y || !m || !d) return week
    return `${d} ${MONTHS[m - 1]}`
}

/** The latest week that actually moved, and the one before it. */
export function latestMovement(weekly: WeeklyProcurement[]): {
    current: WeeklyProcurement | null
    deltaPct: number | null
    newlyProcured: number
} {
    if (weekly.length === 0) return { current: null, deltaPct: null, newlyProcured: 0 }
    // Quiet weeks carry the previous total forward, so the last row's delta is 0 whenever the most
    // recent import was a while ago. The useful figure is the last week that actually moved.
    const moved = [...weekly].reverse().find((w) => w.newlyProcured > 0)
    return {
        current: weekly[weekly.length - 1]!,
        deltaPct: moved?.deltaPct ?? null,
        newlyProcured: moved?.newlyProcured ?? 0,
    }
}

interface Props {
    weekly: WeeklyProcurement[]
    /** Narrow the stack to one micromarket, following the tab's filter. */
    micromarket?: string
    /** Percentage-point move in the last week that had an import. */
    deltaPct?: number | null
    /** Owners added in that week. */
    newlyProcured?: number
}

export default function WeeklyTrend({ weekly, micromarket, deltaPct, newlyProcured }: Props) {
    const { points, order, colorFor } = useMemo(() => {
        const totals = new Map<string, number>()
        for (const w of weekly) {
            for (const [mm, n] of Object.entries(w.byMicromarket)) {
                if (micromarket && mm !== micromarket) continue
                totals.set(mm, (totals.get(mm) ?? 0) + n)
            }
        }
        // Biggest micromarket first, so the stack reads consistently week to week and the colour
        // a micromarket gets does not move when a quiet week reorders it.
        const order = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([mm]) => mm)
        const colors = new Map(order.map((mm, i) => [mm, SERIES_COLORS[i % SERIES_COLORS.length]!]))

        const points: WeekSeriesPoint[] = weekly.map((w) => {
            const counts: Record<string, number> = {}
            for (const [mm, n] of Object.entries(w.byMicromarket)) {
                if (micromarket && mm !== micromarket) continue
                counts[mm] = n
            }
            return {
                weekStart: w.week,
                weekLabel: weekLabel(w.week),
                counts,
                // No drill-down here: procurement counts homeowners, and the endpoint returns
                // totals rather than the record ids behind them.
                leadIds: {},
            }
        })
        return { points, order, colorFor: (k: string) => colors.get(k) ?? SERIES_COLORS[0]! }
    }, [weekly, micromarket])

    if (weekly.length === 0) return null

    const movedWeeks = weekly.filter((w) => w.newlyProcured > 0).length
    // The week-on-week move belongs here rather than in a tile: on its own "+0.01pp" says
    // nothing, and next to the bars it is obviously the last step of the staircase.
    const move =
        deltaPct === null || deltaPct === undefined
            ? ''
            : ` Last import moved it ${deltaPct >= 0 ? '+' : ''}${deltaPct.toFixed(2)}pp` +
              (newlyProcured ? ` on ${newlyProcured.toLocaleString()} new owners.` : '.')

    return (
        <div style={{ marginBottom: 20 }}>
            <ChartCard
                title="WoW procurement by micromarket"
                subtitle={
                    `Owners newly procured each week, by the week their Zoho record was created — a load history, ` +
                    `not a field-work rate. ${movedWeeks} of ${weekly.length} weeks had an import.${move}` +
                    (micromarket ? ` Filtered to ${micromarket}.` : '')
                }
                height={360}>
                <WoWStackedBar
                    data={points}
                    seriesOrder={order}
                    colorFor={colorFor}
                    // Nothing to drill into, so clicking a segment does nothing rather than
                    // opening an empty modal.
                    onSegmentClick={() => {}}
                    allowPercentToggle
                    allowBiWeeklyToggle
                    showSharePercent
                />
            </ChartCard>
        </div>
    )
}
