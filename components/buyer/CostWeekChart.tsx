'use client'

import type { CostWeekPoint } from '@/lib/buyer/types'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

interface Props {
    data: CostWeekPoint[]
    label: string
    color?: string
}

function inrShort(n: number): string {
    if (n >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`
    if (n >= 1e5) return `₹${(n / 1e5).toFixed(2)} L`
    return '₹' + Math.round(n).toLocaleString('en-IN')
}

function CustomTooltip({
    active,
    payload,
    label,
    seriesLabel,
}: {
    active?: boolean
    payload?: { payload: CostWeekPoint }[]
    label?: string
    seriesLabel: string
}) {
    if (!active || !payload?.length) return null
    const row = payload[0]?.payload
    if (!row) return null
    return (
        <div
            style={{
                background: '#FFFFFF',
                border: '1px solid #CCCCCC',
                borderRadius: 8,
                padding: '10px 12px',
                fontSize: 12,
                fontFamily: "'IBM Plex Mono', monospace",
            }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>{label}</div>
            <div style={{ color: '#333333' }}>
                {seriesLabel}: {row.value == null ? '—' : inrShort(row.value)}
            </div>
        </div>
    )
}

/** A single cost-per-week ratio, no dimension split and not clickable — same reasoning
 *  visitsByBidSource already uses ("a ratio has no lead list to open"). Modeled on
 *  FrtChart.tsx's single-metric LineChart, with a currency-formatted Y axis. */
export default function CostWeekChart({ data, label, color = '#0067FF' }: Props) {
    return (
        <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 4, right: 4, bottom: 4, left: 0 }}>
                <CartesianGrid vertical={false} stroke="#F5F5F5" strokeDasharray="0" />
                <XAxis
                    dataKey="weekLabel"
                    tick={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, fill: '#333333' }}
                    axisLine={false}
                    tickLine={false}
                />
                <YAxis
                    width={56}
                    tickFormatter={(v: number) => inrShort(v)}
                    tick={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, fill: '#333333' }}
                    axisLine={false}
                    tickLine={false}
                />
                <Tooltip content={<CustomTooltip seriesLabel={label} />} cursor={{ stroke: '#CCCCCC' }} />
                <Line type="monotone" dataKey="value" name={label} stroke={color} strokeWidth={2} dot={{ r: 3 }} connectNulls />
            </LineChart>
        </ResponsiveContainer>
    )
}
