'use client'

import { LEGEND_STYLE, legendFormatter } from '@/components/shared/chartLegend'
import { FRT_TARGET_MINUTES } from '@/lib/buyer/derive'
import type { FrtWeekPoint } from '@/lib/buyer/types'
import {
    CartesianGrid,
    Legend,
    Line,
    LineChart,
    ReferenceLine,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts'
import { colorFor } from './palette'

interface Props {
    data: FrtWeekPoint[]
}

const AVG_LABEL = 'Average FRT'
const MEDIAN_LABEL = 'Median FRT'
const P80_LABEL = 'P80 FRT'

function fmtMinutes(n: number | null): string {
    if (n == null) return '—'
    return n >= 60 ? `${(n / 60).toFixed(1)}h` : `${n.toFixed(1)}m`
}

interface ChartRow {
    weekLabel: string
    weekStart: string
    avgMinutes: number | null
    medianMinutes: number | null
    p80Minutes: number | null
    count: number
}

function CustomTooltip({
    active,
    payload,
    label,
}: {
    active?: boolean
    payload?: { payload: ChartRow }[]
    label?: string
}) {
    if (!active || !payload?.length) return null
    const row = payload[0]?.payload
    if (!row) return null
    return (
        <div
            style={{
                background: '#fbf9f4',
                border: '1px solid #e9e4db',
                borderRadius: 8,
                padding: '10px 12px',
                fontSize: 12,
                fontFamily: "'IBM Plex Mono', monospace",
            }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>{label}</div>
            <div style={{ color: colorFor(AVG_LABEL) }}>
                {AVG_LABEL}: {fmtMinutes(row.avgMinutes)}
            </div>
            <div style={{ color: colorFor(MEDIAN_LABEL), marginTop: 2 }}>
                {MEDIAN_LABEL}: {fmtMinutes(row.medianMinutes)}
            </div>
            <div style={{ color: colorFor(P80_LABEL), marginTop: 2 }}>
                {P80_LABEL}: {fmtMinutes(row.p80Minutes)}
            </div>
            <div style={{ color: '#9a948a', marginTop: 2 }}>{row.count} working-hours leads with a response</div>
        </div>
    )
}

export default function FrtChart({ data }: Props) {
    const chartData: ChartRow[] = data.map((p) => ({
        weekLabel: p.weekLabel,
        weekStart: p.weekStart,
        avgMinutes: p.avgMinutes,
        medianMinutes: p.medianMinutes,
        p80Minutes: p.p80Minutes,
        count: p.count,
    }))

    return (
        <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 4, right: 4, bottom: 4, left: 0 }}>
                <CartesianGrid vertical={false} stroke="#efe9e0" strokeDasharray="0" />
                <XAxis
                    dataKey="weekLabel"
                    tick={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, fill: '#9a948a' }}
                    axisLine={false}
                    tickLine={false}
                />
                <YAxis
                    allowDecimals={false}
                    width={40}
                    tick={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, fill: '#9a948a' }}
                    axisLine={false}
                    tickLine={false}
                    label={{
                        value: 'minutes',
                        angle: -90,
                        position: 'insideLeft',
                        style: { fontSize: 10, fill: '#9a948a', textAnchor: 'middle' },
                    }}
                />
                <Tooltip content={<CustomTooltip />} cursor={{ stroke: '#e9e4db' }} />
                <Legend wrapperStyle={LEGEND_STYLE} formatter={legendFormatter} />
                <ReferenceLine
                    y={FRT_TARGET_MINUTES}
                    stroke="#c7533e"
                    strokeDasharray="4 4"
                    label={{
                        value: `${FRT_TARGET_MINUTES}m target`,
                        position: 'insideTopLeft',
                        fill: '#c7533e',
                        fontSize: 10,
                        fontFamily: "'IBM Plex Mono', monospace",
                    }}
                />
                <Line
                    type="monotone"
                    dataKey="avgMinutes"
                    name={AVG_LABEL}
                    stroke={colorFor(AVG_LABEL)}
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    connectNulls
                />
                <Line
                    type="monotone"
                    dataKey="medianMinutes"
                    name={MEDIAN_LABEL}
                    stroke={colorFor(MEDIAN_LABEL)}
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    connectNulls
                />
                <Line
                    type="monotone"
                    dataKey="p80Minutes"
                    name={P80_LABEL}
                    stroke={colorFor(P80_LABEL)}
                    strokeWidth={2}
                    strokeDasharray="3 3"
                    dot={{ r: 3 }}
                    connectNulls
                />
            </LineChart>
        </ResponsiveContainer>
    )
}
