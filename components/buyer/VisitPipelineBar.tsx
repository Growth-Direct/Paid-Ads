'use client'

import { LEGEND_STYLE, legendFormatter } from '@/components/shared/chartLegend'
import type { MicromarketPoint } from '@/lib/buyer/types'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { colorFor } from './palette'

interface Props {
    data: MicromarketPoint[]
    onSegmentClick: (point: MicromarketPoint, status: string) => void
}

const MONO = "'IBM Plex Mono', monospace"
const TOP_N = 10 // horizontal rows readable in the card height; long tail of 1-count junk dropped

export default function VisitPipelineBar({ data, onSegmentClick }: Props) {
    const statuses = [...new Set(data.flatMap((p) => Object.keys(p.counts)))]
    const totalOf = (p: MicromarketPoint) => Object.values(p.counts).reduce((s: number, n) => s + (n ?? 0), 0)

    // Horizontal bars so the micromarket names read left-to-right, largest at the top.
    const ranked = [...data].sort((a, b) => totalOf(b) - totalOf(a)).slice(0, TOP_N)
    const chartData = ranked.map((p) => ({ micromarket: p.micromarket, ...p.counts }))

    return (
        <ResponsiveContainer width="100%" height="100%">
            <BarChart layout="vertical" data={chartData} margin={{ top: 4, right: 12, bottom: 4, left: 4 }} barSize={16}>
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
                    dataKey="micromarket"
                    width={104}
                    tick={{ fontFamily: MONO, fontSize: 10, fill: '#6b655c' }}
                    axisLine={false}
                    tickLine={false}
                />
                <Tooltip
                    contentStyle={{
                        background: '#fbf9f4',
                        border: '1px solid #e9e4db',
                        borderRadius: 8,
                        fontSize: 12,
                        fontFamily: MONO,
                    }}
                    cursor={{ fill: 'rgba(0,0,0,0.04)' }}
                />
                <Legend wrapperStyle={LEGEND_STYLE} formatter={legendFormatter} />
                {statuses.map((status) => (
                    <Bar
                        key={status}
                        dataKey={status}
                        stackId="a"
                        fill={colorFor(status)}
                        name={status}
                        cursor="pointer"
                        onClick={(_, index) => {
                            const point = ranked[index as number]
                            if (point) onSegmentClick(point, status)
                        }}
                    />
                ))}
            </BarChart>
        </ResponsiveContainer>
    )
}
