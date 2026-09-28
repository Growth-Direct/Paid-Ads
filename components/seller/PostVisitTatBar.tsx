'use client'

import { MONO } from '@/components/shared/FilterControls'
import type { Scope } from '@/lib/seller/filters'
import type { PostVisitTatData, PostVisitTatStagePoint, PostVisitTatTransitionPoint } from '@/lib/seller/types'
import { useState } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { colorFor } from './palette'
import { ScopeFilterDropdown } from './ScopeFilterDropdown'

// Post Visit TAT — 4 bars (Visit Completed / Sent for Valuation / Valuation Completed / Offer
// Made to Seller), one per stage. Rebuilt 2026-09-24: each stage's count is now time-windowed by
// its own transition date and split New/Old server-side (lib/seller/derive.ts); this component
// adds the chart-local New/Old scope toggle (mirrors SellerFilterBar's own Visits/Conversions
// pills, just chart-local instead of page-level, like MicromarketStatusBar's status filter) and
// blends the two cohorts by summing raw counts/day-sums — never averaging two averages.
//
// Below the bars, a plain-language line per adjacent stage pair reports the average time between
// them. A pixel-perfect connector drawn between two recharts bars would need to reach into its
// internal coordinate system for a fragile payoff; a labelled sentence is exactly as informative
// and reads better for the growth team besides.

interface Props {
    data: PostVisitTatData
    onBarClick: (stage: string, leadIds: string[]) => void
}

interface ChartRow {
    stage: string
    count: number
    leadIds: string[]
}

function scopedStage(point: PostVisitTatStagePoint, scope: Scope[]): ChartRow {
    const leadIds = [...(scope.includes('New') ? point.leadIdsNew : []), ...(scope.includes('Old') ? point.leadIdsOld : [])]
    return { stage: point.stage, count: leadIds.length, leadIds }
}

/** Sums raw days/pairs across the selected cohorts before dividing — the only way to blend New
 *  and Old without averaging two averages (which would misweight a stage with few Old pairs
 *  against one with many). */
function scopedAvgDays(point: PostVisitTatTransitionPoint, scope: Scope[]): number | null {
    const sumDays = (scope.includes('New') ? point.sumDaysNew : 0) + (scope.includes('Old') ? point.sumDaysOld : 0)
    const pairs = (scope.includes('New') ? point.pairsNew : 0) + (scope.includes('Old') ? point.pairsOld : 0)
    return pairs > 0 ? sumDays / pairs : null
}

interface RechartsTooltipProps {
    active?: boolean
    payload?: Array<{ payload?: ChartRow }>
}

function CustomTooltip({ active, payload }: RechartsTooltipProps) {
    if (!active || !payload?.length || !payload[0]?.payload) return null
    const point = payload[0].payload
    return (
        <div
            style={{
                background: '#fbf9f4',
                border: '1px solid #e9e4db',
                borderRadius: 8,
                fontSize: 12,
                fontFamily: MONO,
                padding: '8px 10px',
            }}>
            <div style={{ fontWeight: 600 }}>{point.stage}</div>
            <div style={{ color: '#9a948a', marginTop: 2 }}>{point.count.toLocaleString('en-IN')} properties</div>
        </div>
    )
}

function makeTotalLabel() {
    return (props: { x?: number; y?: number; width?: number; value?: number }) => {
        const { x, y, width, value } = props
        if (x == null || y == null || width == null || !value) return <></>
        return (
            <text x={x + width / 2} y={y - 6} textAnchor="middle" fontSize={10} fontWeight={700} fill="#3a3630" fontFamily={MONO}>
                {value.toLocaleString('en-IN')}
            </text>
        )
    }
}

export default function PostVisitTatBar({ data, onBarClick }: Props) {
    const [scope, setScope] = useState<Scope[]>(['New', 'Old'])
    const chartData = data.stages.map((s) => scopedStage(s, scope))
    const tooltipContent = (props: RechartsTooltipProps) => <CustomTooltip {...props} />

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8, flexShrink: 0 }}>
                <ScopeFilterDropdown label="Visits" scope={scope} onChange={setScope} />
            </div>
            <div style={{ flex: 1, minHeight: 0 }}>
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} margin={{ top: 20, right: 4, bottom: 4, left: 0 }} barSize={48}>
                        <CartesianGrid vertical={false} stroke="#efe9e0" strokeDasharray="0" />
                        <XAxis
                            dataKey="stage"
                            tick={{ fontFamily: MONO, fontSize: 10, fill: '#6b655c' }}
                            axisLine={false}
                            tickLine={false}
                        />
                        <YAxis
                            allowDecimals={false}
                            width={40}
                            tick={{ fontFamily: MONO, fontSize: 10, fill: '#9a948a' }}
                            axisLine={false}
                            tickLine={false}
                        />
                        <Tooltip content={tooltipContent} cursor={{ fill: 'rgba(0,0,0,0.04)' }} />
                        <Bar
                            dataKey="count"
                            cursor="pointer"
                            label={makeTotalLabel()}
                            onClick={(_, index) => {
                                const point = chartData[index as number]
                                if (point) onBarClick(point.stage, point.leadIds)
                            }}>
                            {chartData.map((p) => (
                                <Cell key={p.stage} fill={colorFor(p.stage)} />
                            ))}
                        </Bar>
                    </BarChart>
                </ResponsiveContainer>
            </div>
            <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 3, marginTop: 6, fontSize: 10.5, fontFamily: MONO, color: '#9a948a' }}>
                {data.transitions.map((t) => {
                    const avg = scopedAvgDays(t, scope)
                    return (
                        <div key={`${t.from}->${t.to}`}>
                            {t.from} → {t.to}: {avg == null ? '—' : `avg ${avg.toFixed(1)}d`}
                        </div>
                    )
                })}
            </div>
        </div>
    )
}
