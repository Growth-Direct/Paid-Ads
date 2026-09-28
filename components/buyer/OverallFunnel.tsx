'use client'

import type { OverallFunnelData } from '@/lib/buyer/types'

// Option 2 — a horizontal node-flow. The four acquisition stages form the spine, joined
// by tapering Sankey ribbons whose thickness tracks the flow and whose label is the
// conversion rate. The two "duplication" measures (Total Leads, Total Visits) are not
// stages — they float above their spine node as context. Ever Warm branches below Unique
// Visits. Each node shows Achieved big, with one target signal: the vs-pace delta.
//
// Drawn as one SVG with a fixed viewBox scaled to width:100%, so it fits any screen and
// never overflows — the bug the old inline-flex row had.

const MONO = "'IBM Plex Mono', monospace"
const GREEN = '#3a7d5d'
const RED = '#c7533e'
const MUTED = '#9a948a'
const INK = '#3a3630'
const RIBBON = '#3a7d5d'

const VBW = 1160
const VBH = 300
const SY = 168 // spine centre-line
const NODE_W = 168
const NODE_H = 82
const XS = [128, 420, 712, 1004] // spine node centres

function n(v: number | null): string {
    return v == null ? '—' : Math.round(v).toLocaleString('en-IN')
}
function pctLabel(v: number | null, unit: '%' | 'x'): string {
    if (v == null) return ''
    return unit === 'x' ? `${v.toFixed(2)}×` : `${v.toFixed(1)}%`
}

interface Spine {
    label: string
    actual: number | null
    target: number | null
}

/** A tapering horizontal ribbon between two spine nodes: two cubic edges bowed toward the
 *  mid-x, filled. Thickness t1→t2 gives the Sankey taper. */
function ribbonPath(x1: number, t1: number, x2: number, t2: number, y: number): string {
    const mx = (x1 + x2) / 2
    const tl = y - t1 / 2
    const bl = y + t1 / 2
    const tr = y - t2 / 2
    const br = y + t2 / 2
    return [
        `M ${x1} ${tl}`,
        `C ${mx} ${tl}, ${mx} ${tr}, ${x2} ${tr}`,
        `L ${x2} ${br}`,
        `C ${mx} ${br}, ${mx} ${bl}, ${x1} ${bl}`,
        'Z',
    ].join(' ')
}

export default function OverallFunnel({ data, expectedPct }: { data: OverallFunnelData; expectedPct: number }) {
    const byLabel = new Map(data.blocks.map((b) => [b.label, b]))
    const get = (l: string): Spine => {
        const b = byLabel.get(l)
        return { label: l, actual: b?.actual ?? null, target: b?.target ?? null }
    }
    const uniqueLeads = get('Unique Leads')
    const qualified = get('Qualified Leads')
    const uniqueVisits = get('Unique Visits')
    const conversions = get('Unique Conversions')
    const spine: Spine[] = [uniqueLeads, qualified, uniqueVisits, conversions]
    const totalLeads = get('Total Leads')
    const totalVisits = get('Total Visits')
    const totalConversions = get('Total Conversions')

    // arrows[0]=Total/Unique-lead dup ×, [1]=LTQL %, [2]=QLTV %, [3]=Unique/Total-visit dup ×, [4]=Ever Warm %
    const a = data.arrows
    const leadDup = a[0]
    const ltql = a[1]
    const qltv = a[2]
    const visitDup = a[3]
    const everWarm = a[4]
    // Unique Visits → Conversions has no arrow in the data; derive the rate for the ribbon.
    const convRate =
        uniqueVisits.actual && uniqueVisits.actual > 0 && conversions.actual != null
            ? (conversions.actual / uniqueVisits.actual) * 100
            : null
    const spineRates = [ltql, qltv, { label: null, unit: '%' as const, target: null, achieved: convRate }]

    // Ribbon thickness scales with the downstream flow, relative to the largest spine value.
    const maxVal = Math.max(...spine.map((s) => s.actual ?? 0), 1)
    const thick = (v: number | null): number => 6 + (Math.sqrt(Math.max(0, v ?? 0) / maxVal) * 40)

    // Per-node pace delta: prorated target minus achieved (positive = behind).
    const paceOf = (s: Spine) => {
        if (s.target == null || s.actual == null) return { delta: null as number | null, behind: false }
        // Nothing to compare when the target and the achieved figure are both zero — a filter
        // selection with no data, or a grid cell with no target. delta would be 0, which is
        // "not behind", which paints the node green with a ▲: an empty funnel reading as four
        // nodes ahead of pace. Neutral instead, same as an absent target.
        if (s.target === 0 && s.actual === 0) return { delta: null as number | null, behind: false }
        const paced = s.target * (expectedPct / 100)
        const delta = paced - s.actual
        return { delta, behind: delta > 0 }
    }

    return (
        <svg viewBox={`0 0 ${VBW} ${VBH}`} width="100%" style={{ display: 'block', fontFamily: MONO }} role="img">
            {/* spine ribbons */}
            {spine.slice(0, 3).map((s, i) => {
                const from = XS[i]! + NODE_W / 2
                const to = XS[i + 1]! - NODE_W / 2
                const t1 = thick(spine[i]!.actual)
                const t2 = thick(spine[i + 1]!.actual)
                const r = spineRates[i]!
                const mx = (from + to) / 2
                return (
                    <g key={`rib${i}`}>
                        <path d={ribbonPath(from, t1, to, t2, SY)} fill={RIBBON} opacity={0.16} />
                        {r?.achieved != null && (
                            <>
                                {/* One tight stack above the ribbon: caption, rate, target. */}
                                {r.label && (
                                    <text x={mx} y={SY - 40} textAnchor="middle" fontSize={9} fill={MUTED} letterSpacing="0.07em">
                                        {r.label.replace(/\s*%$/, '').toUpperCase()}
                                    </text>
                                )}
                                <text x={mx} y={SY - 22} textAnchor="middle" fontSize={19} fontWeight={800} fill={INK}>
                                    {pctLabel(r.achieved, r.unit)}
                                </text>
                                {r.target != null && (
                                    <text x={mx} y={SY - 8} textAnchor="middle" fontSize={11} fill={MUTED}>
                                        target {pctLabel(r.target, r.unit)}
                                    </text>
                                )}
                            </>
                        )}
                    </g>
                )
            })}

            {/* float-above links: Total Leads -> Unique Leads, Total Visits -> Unique Visits.
                Total Conversions has no ratio badge — the gap versus Unique Conversions below
                is two things at once (Channel Partner inclusion AND no per-buyer dedup), and a
                single ratio number would conflate them rather than explain either. */}
            <FloatLink x={XS[0]!} topY={92} label={leadDup} />
            <FloatLink x={XS[2]!} topY={92} label={visitDup} />
            <FloatLink x={XS[3]!} topY={92} label={undefined} />

            {/* float-above context nodes */}
            <FloatNode cx={XS[0]!} cy={62} title="Total Leads" value={totalLeads.actual} sub="all touches" />
            <FloatNode cx={XS[2]!} cy={62} title="Total Visits" value={totalVisits.actual} sub="all events" />
            <FloatNode cx={XS[3]!} cy={62} title="Total Conversions" value={totalConversions.actual} sub="all sources + blocking" />

            {/* Ever Warm branch below Unique Visits */}
            {everWarm?.achieved != null && (
                <g>
                    <path
                        d={`M ${XS[2]} ${SY + NODE_H / 2} C ${XS[2]} ${SY + 58}, ${XS[2]} ${SY + 58}, ${XS[2]} ${SY + 66}`}
                        stroke={MUTED}
                        strokeWidth={1.3}
                        fill="none"
                        strokeDasharray="3 3"
                    />
                    <text x={XS[2]!} y={SY + 84} textAnchor="middle" fontSize={12.5} fontWeight={700} fill={INK}>
                        Ever Warm {pctLabel(everWarm.achieved, everWarm.unit)}
                    </text>
                    {everWarm.target != null && (
                        <text x={XS[2]!} y={SY + 99} textAnchor="middle" fontSize={10} fill={MUTED}>
                            target {pctLabel(everWarm.target, everWarm.unit)}
                        </text>
                    )}
                </g>
            )}

            {/* spine nodes on top */}
            {spine.map((s, i) => {
                const { delta, behind } = paceOf(s)
                const status = delta == null ? MUTED : behind ? RED : GREEN
                const x = XS[i]! - NODE_W / 2
                const y = SY - NODE_H / 2
                return (
                    <g key={s.label}>
                        <rect
                            x={x}
                            y={y}
                            width={NODE_W}
                            height={NODE_H}
                            rx={13}
                            fill="#fbf9f4"
                            stroke={delta == null ? '#e0dad0' : status}
                            strokeOpacity={delta == null ? 1 : 0.45}
                            strokeWidth={1.4}
                        />
                        {/* With a target the box carries four lines (label / value / target /
                            delta); with none it carries two, so centre those instead of
                            leaving the value floating where the target used to sit. */}
                        <text
                            x={XS[i]!}
                            y={s.target != null ? y + 19 : y + 34}
                            textAnchor="middle"
                            fontSize={9.5}
                            fill={MUTED}
                            letterSpacing="0.06em">
                            {s.label.toUpperCase()}
                        </text>
                        <text
                            x={XS[i]!}
                            y={s.target != null ? y + 45 : y + 60}
                            textAnchor="middle"
                            fontSize={26}
                            fontWeight={800}
                            fill={INK}>
                            {n(s.actual)}
                        </text>
                        {s.target != null && (
                            <text x={XS[i]!} y={y + 60} textAnchor="middle" fontSize={10.5} fill={MUTED}>
                                target {n(s.target)}
                            </text>
                        )}
                        {delta != null && (
                            <text x={XS[i]!} y={y + 74} textAnchor="middle" fontSize={11} fontWeight={700} fill={status}>
                                {behind ? '▼' : '▲'} {n(Math.abs(delta))} vs pace
                            </text>
                        )}
                    </g>
                )
            })}
        </svg>
    )
}

function FloatNode({ cx, cy, title, value, sub }: { cx: number; cy: number; title: string; value: number | null; sub: string }) {
    const w = 150
    const h = 56
    const x = cx - w / 2
    const y = cy - h / 2
    return (
        <g>
            <rect x={x} y={y} width={w} height={h} rx={11} fill="#f4efe7" stroke="#e6e0d5" strokeWidth={1} />
            <text x={cx} y={y + 17} textAnchor="middle" fontSize={9} fill={MUTED} letterSpacing="0.06em">
                {title.toUpperCase()}
            </text>
            <text x={cx} y={y + 38} textAnchor="middle" fontSize={19} fontWeight={800} fill={INK}>
                {n(value)}
            </text>
            <text x={cx} y={y + 50} textAnchor="middle" fontSize={8.5} fill={MUTED}>
                {sub}
            </text>
        </g>
    )
}

function FloatLink({ x, topY, label }: { x: number; topY: number; label: { unit: '%' | 'x'; achieved: number | null } | undefined }) {
    // Thin curved connector dropping from a float node into its spine node, with the × ratio.
    const y2 = SY - NODE_H / 2
    return (
        <g>
            <path
                d={`M ${x} ${topY} C ${x} ${(topY + y2) / 2}, ${x} ${(topY + y2) / 2}, ${x} ${y2}`}
                stroke={MUTED}
                strokeWidth={1.3}
                fill="none"
                strokeDasharray="3 3"
            />
            {label?.achieved != null && (
                <>
                    <rect x={x + 6} y={(topY + y2) / 2 - 10} width={58} height={18} rx={9} fill="#fbf9f4" stroke="#e6e0d5" />
                    <text x={x + 35} y={(topY + y2) / 2 + 3} textAnchor="middle" fontSize={11} fontWeight={700} fill={INK}>
                        {pctLabel(label.achieved, label.unit)}
                    </text>
                </>
            )}
        </g>
    )
}
