'use client'

import type { HouseWarmPoint } from '@/lib/buyer/types'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

// Every live house is charted, so the plot is given a fixed width per house and scrolled
// horizontally rather than capped to a top slice.
const PX_PER_HOUSE = 38

const SERIES = [
    { key: 'everWarmYes', name: 'Ever warm', fill: '#3a7d5d' },
    { key: 'everWarmNo', name: 'Never warm', fill: '#a9a294' },
] as const

export default function HouseWarmBar({ data }: { data: HouseWarmPoint[] }) {
    // Axis labels keep the unit number and drop the tail; the full name is on the tooltip.
    const rows = data.map((p) => ({
        ...p,
        fullHouse: p.house,
        house: p.house.length > 24 ? p.house.slice(0, 24) + '…' : p.house,
    }))

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            {/* Legend sits outside the scroll area so it neither overlaps the rotated axis
                labels nor scrolls out of view. */}
            <div
                style={{
                    display: 'flex',
                    gap: 18,
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: 11,
                    color: '#9a948a',
                    marginBottom: 8,
                }}>
                {SERIES.map((s) => (
                    <span key={s.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ width: 10, height: 10, borderRadius: 2, background: s.fill }} />
                        {s.name}
                    </span>
                ))}
            </div>

            <div style={{ flex: 1, overflowX: 'auto', overflowY: 'hidden' }}>
                <div style={{ width: rows.length * PX_PER_HOUSE, minWidth: '100%', height: '100%' }}>
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={rows} margin={{ top: 4, right: 4, bottom: 4, left: 0 }} barSize={14}>
                            <CartesianGrid vertical={false} stroke="#efe9e0" strokeDasharray="0" />
                            <XAxis
                                dataKey="house"
                                tick={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, fill: '#9a948a' }}
                                axisLine={false}
                                tickLine={false}
                                angle={-40}
                                textAnchor="end"
                                height={100}
                                interval={0}
                            />
                            <YAxis
                                allowDecimals={false}
                                width={32}
                                tick={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, fill: '#9a948a' }}
                                axisLine={false}
                                tickLine={false}
                            />
                            <Tooltip
                                labelFormatter={(_label, payload) => payload?.[0]?.payload?.fullHouse ?? ''}
                                contentStyle={{
                                    background: '#fbf9f4',
                                    border: '1px solid #e9e4db',
                                    borderRadius: 8,
                                    fontSize: 12,
                                    fontFamily: "'IBM Plex Mono', monospace",
                                }}
                                cursor={{ fill: 'rgba(0,0,0,0.04)' }}
                            />
                            {SERIES.map((s, i) => (
                                <Bar
                                    key={s.key}
                                    dataKey={s.key}
                                    stackId="a"
                                    fill={s.fill}
                                    name={s.name}
                                    radius={i === 0 ? [3, 3, 0, 0] : undefined}
                                />
                            ))}
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            </div>
        </div>
    )
}
