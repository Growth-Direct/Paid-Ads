'use client'

import { LEGEND_STYLE, legendFormatter } from '@/components/shared/chartLegend'
import type { ClusterPipelinePoint } from '@/lib/seller/types'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { colorFor } from './palette'

interface Props {
    data: ClusterPipelinePoint[]
    onSegmentClick: (point: ClusterPipelinePoint, micromarket: string) => void
}

const MONO = "'IBM Plex Mono', monospace"

function totalOf(p: ClusterPipelinePoint): number {
    return Object.values(p.counts).reduce((s: number, n) => s + (n ?? 0), 0)
}

/** Renders each bar's grand total just past its rightmost stacked segment — the horizontal-bar
 *  equivalent of WoWStackedBar's makeTotalLabel (which sits above a vertical bar's top). Attached
 *  only to the LAST `<Bar>` in a stack, so its own `x + width` is already the end of the whole
 *  bar; the displayed number comes from a precomputed `totals` lookup by row index. */
function makeTotalLabel(totals: number[]) {
    return (props: { x?: number; y?: number; width?: number; height?: number; index?: number }) => {
        const { x, y, width, height, index } = props
        if (x == null || y == null || width == null || height == null || index == null) return <></>
        const total = totals[index]
        if (!total) return <></>
        return (
            <text
                x={x + width + 6}
                y={y + height / 2}
                dy={4}
                textAnchor="start"
                fontSize={10}
                fontWeight={700}
                fill="#3a3630"
                fontFamily={MONO}>
                {total.toLocaleString('en-IN')}
            </text>
        )
    }
}

/** The slice of recharts' Tooltip content props this component actually reads — avoids pulling
 *  in recharts' full generic TooltipProps type for one narrow use (mirrors WoWStackedBar). */
interface RechartsTooltipProps {
    active?: boolean
    payload?: Array<{ dataKey?: string | number; name?: string | number; value?: number; color?: string }>
}

/** One tooltip entry per micromarket in the hovered cluster's bar, each showing its own count
 *  and its share of that bar's total — mirrors WoWStackedBar's ShareTooltip, simplified since
 *  there's only ever one row per hover here (no fortnight-pair grouping). */
function ShareTooltip({ payload }: Pick<RechartsTooltipProps, 'payload'>) {
    if (!payload?.length) return null
    const total = payload.reduce((s, e) => s + (e.value ?? 0), 0)
    return (
        <div
            style={{
                background: '#fbf9f4',
                border: '1px solid #e9e4db',
                borderRadius: 8,
                fontSize: 12,
                fontFamily: MONO,
                padding: '8px 10px',
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
            }}>
            {payload.map((e) => (
                <div key={String(e.dataKey)} style={{ display: 'flex', justifyContent: 'space-between', gap: 14, color: e.color ?? '#3a3630' }}>
                    <span>{e.name}</span>
                    <span>
                        {e.value} ({total > 0 ? (((e.value ?? 0) / total) * 100).toFixed(1) : '0.0'}%)
                    </span>
                </div>
            ))}
        </div>
    )
}

export default function ClusterPipelineBar({ data, onSegmentClick }: Props) {
    const micromarkets = [...new Set(data.flatMap((p) => Object.keys(p.counts)))]
    const chartData = data.map((p) => ({ cluster: p.cluster, ...p.counts }))
    const totals = data.map(totalOf)
    const tooltipContent = ({ active, payload }: RechartsTooltipProps) => (active ? <ShareTooltip payload={payload} /> : null)

    return (
        <ResponsiveContainer width="100%" height="100%">
            <BarChart layout="vertical" data={chartData} margin={{ top: 4, right: 40, bottom: 4, left: 4 }} barSize={20}>
                <CartesianGrid horizontal={false} stroke="#efe9e0" strokeDasharray="0" />
                <XAxis
                    type="number"
                    allowDecimals={false}
                    tick={{ fontFamily: MONO, fontSize: 10, fill: '#9a948a' }}
                    axisLine={false}
                    tickLine={false}
                />
                <YAxis
                    type="category"
                    dataKey="cluster"
                    width={72}
                    tick={{ fontFamily: MONO, fontSize: 10, fill: '#6b655c' }}
                    axisLine={false}
                    tickLine={false}
                />
                <Tooltip content={tooltipContent} cursor={{ fill: 'rgba(0,0,0,0.04)' }} />
                <Legend wrapperStyle={LEGEND_STYLE} formatter={legendFormatter} />
                {micromarkets.map((mm, i) => (
                    <Bar
                        key={mm}
                        dataKey={mm}
                        stackId="a"
                        fill={colorFor(mm)}
                        name={mm}
                        cursor="pointer"
                        label={i === micromarkets.length - 1 ? makeTotalLabel(totals) : undefined}
                        onClick={(_, index) => {
                            const point = data[index as number]
                            if (point) onSegmentClick(point, mm)
                        }}
                    />
                ))}
            </BarChart>
        </ResponsiveContainer>
    )
}
