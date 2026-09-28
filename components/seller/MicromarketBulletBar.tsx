'use client'

import type { MicromarketTargetPoint } from '@/lib/seller/types'
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { colorFor } from './palette'

// Micromarket Analysis' two "Overall Quarter" bullet bars — a horizontal fill-against-target
// reading per the growth team's own reference (a Metabase "MM Wise Qualified Leads" bar): a
// light grey track spans the full row, a coloured bar fills it up to the achieved value (the
// number labelled in white inside the fill), and a solid vertical line marks the paced quarter
// target with its own "Target : N" label to the right of the line. All three are the SAME
// horizontal bar overlaid at the same y position — barGap set to -barSize forces the three
// <Bar> elements to share it instead of sitting side by side, so the track, fill and target
// line all read as one row rather than three.

interface Props {
    data: MicromarketTargetPoint[]
}

const MONO = "'IBM Plex Mono', monospace"
const BAR_SIZE = 26
const FILL_COLOR_FALLBACK = '#8ea3d4'

function n(v: number): string {
    return Math.round(v).toLocaleString('en-IN')
}

/** The achieved value, centred inside its own fill bar (white, so it reads against any of the
 *  cluster hues) — matches the reference chart's in-bar labelling. */
function AchievedLabel(props: { x?: number; y?: number; width?: number; height?: number; value?: number }) {
    const { x, y, width, height, value } = props
    if (x == null || y == null || width == null || height == null || value == null) return <></>
    return (
        <text x={x + width / 2} y={y + height / 2} dy={4} textAnchor="middle" fontSize={12} fontWeight={700} fill="#fff" fontFamily={MONO}>
            {n(value)}
        </text>
    )
}

/** A solid vertical line at the target's own x position (recharts places this pseudo-bar's
 *  right edge — `x + width` — exactly at the pixel matching the target value on the shared
 *  x-scale), with "Target : N" labelled just to its right. Renders nothing when this
 *  micromarket has no grid-covered target (the ceiling would otherwise sit at x=0). */
function TargetLineShape(props: { x?: number; y?: number; width?: number; height?: number; payload?: MicromarketTargetPoint }) {
    const { x, y, width, height, payload } = props
    if (x == null || y == null || width == null || height == null || payload?.target == null) return <></>
    const lineX = x + width
    return (
        <g>
            <line x1={lineX} y1={y} x2={lineX} y2={y + height} stroke="#2a2620" strokeWidth={2} />
            <text x={lineX + 6} y={y + height / 2} dy={4} fontSize={10.5} fill="#3a3630" fontFamily={MONO}>
                Target : {n(payload.target)}
            </text>
        </g>
    )
}

interface RechartsTooltipPayload {
    dataKey?: string | number
    value?: number
    payload?: MicromarketTargetPoint
}

function BulletTooltip({ payload }: { payload?: RechartsTooltipPayload[] }) {
    const p = payload?.[0]?.payload
    if (!p) return null
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
            <div style={{ fontWeight: 700, color: '#3a3630', marginBottom: 4 }}>{p.micromarket}</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14 }}>
                <span>Achieved</span>
                <span>{n(p.actual)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, color: '#6b655c' }}>
                <span>Target</span>
                <span>{p.target != null ? n(p.target) : '—'}</span>
            </div>
        </div>
    )
}

export default function MicromarketBulletBar({ data }: Props) {
    // Rounded to a whole number — recharts places an explicit tick at the exact domain max
    // (allowDecimals only governs the ticks IN BETWEEN), so an unrounded max renders as a
    // garbled decimal like "60.05375" at the edge of the axis.
    const domainMax = Math.ceil(Math.max(1, ...data.map((d) => Math.max(d.actual, d.target ?? 0))) * 1.25)
    const chartData = data.map((d) => ({ ...d, trackMax: domainMax }))
    const tooltipContent = ({ active, payload }: { active?: boolean; payload?: RechartsTooltipPayload[] }) =>
        active ? <BulletTooltip payload={payload} /> : null
    const axisTick = { fontFamily: MONO, fontSize: 10.5, fill: '#6b655c' }

    return (
        <ResponsiveContainer width="100%" height="100%">
            <BarChart
                data={chartData}
                layout="vertical"
                margin={{ top: 4, right: 90, bottom: 4, left: 4 }}
                barGap={-BAR_SIZE}
                barCategoryGap="32%">
                <CartesianGrid horizontal={false} stroke="#e6e0d6" strokeDasharray="3 3" />
                <XAxis type="number" domain={[0, domainMax]} allowDecimals={false} tick={axisTick} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="micromarket" width={82} tick={axisTick} axisLine={false} tickLine={false} />
                <Tooltip content={tooltipContent} cursor={{ fill: 'rgba(0,0,0,0.04)' }} />
                <Bar dataKey="trackMax" barSize={BAR_SIZE} radius={4} fill="#e9e4da" isAnimationActive={false} />
                <Bar dataKey="actual" barSize={BAR_SIZE} radius={4} label={AchievedLabel} isAnimationActive={false}>
                    {data.map((p, i) => (
                        <Cell key={i} fill={colorFor(p.micromarket) || FILL_COLOR_FALLBACK} />
                    ))}
                </Bar>
                <Bar dataKey="target" barSize={BAR_SIZE} shape={TargetLineShape} isAnimationActive={false} />
            </BarChart>
        </ResponsiveContainer>
    )
}
