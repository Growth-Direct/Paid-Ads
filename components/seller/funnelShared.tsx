'use client'

// Shared visual system for the Seller Overview's two branching funnel diagrams — "Overall
// Funnel (Unique Seller)" (components/seller/OverallFunnel.tsx) and "Overall Funnel (Unique
// Property)" (components/seller/OverallFunnelProperty.tsx). Both fork after their own
// "qualified" stage into a New arm (above the center line) and an Old arm (below it),
// recombining into one Total node at the end, on the identical coordinate grid — extracted here
// so neither funnel's ribbon/node/float visual language can drift from the other's.
// See components/buyer/OverallFunnel.tsx for the original ribbon/taper/pace-colour rationale
// this was adapted from.

export const MONO = "'IBM Plex Mono', monospace"
export const GREEN = '#3a7d5d'
export const RED = '#c7533e'
export const MUTED = '#9a948a'
export const INK = '#3a3630'
export const RIBBON = '#3a7d5d'

export const VBW = 1320
export const VBH = 460
export const SY = 230
export const ARM_OFFSET = 110
export const UPPER_Y = SY - ARM_OFFSET
export const LOWER_Y = SY + ARM_OFFSET
export const NODE_W = 168
export const NODE_H = 82
export const XS = [110, 380, 650, 920, 1190]

export function n(v: number | null): string {
    return v == null ? '—' : Math.round(v).toLocaleString('en-IN')
}
export function pctLabel(v: number | null, unit: '%' | 'x'): string {
    if (v == null) return ''
    return unit === 'x' ? `${v.toFixed(2)}×` : `${v.toFixed(1)}%`
}

export interface FNode {
    key: string
    label: string
    x: number
    y: number
    actual: number | null
    target: number | null
}

export interface Rate {
    label: string | null
    achieved: number | null
    target: number | null
    side: 'above' | 'below'
}

/** Independent y1/y2 rather than one shared y — the New/Old arms fork and recombine
 *  diagonally, unlike a straight horizontal spine. A horizontal ribbon (y1 === y2) renders
 *  exactly as a straight one would. */
export function ribbonPath(x1: number, t1: number, y1: number, x2: number, t2: number, y2: number): string {
    const mx = (x1 + x2) / 2
    const tl = y1 - t1 / 2
    const bl = y1 + t1 / 2
    const tr = y2 - t2 / 2
    const br = y2 + t2 / 2
    return [
        `M ${x1} ${tl}`,
        `C ${mx} ${tl}, ${mx} ${tr}, ${x2} ${tr}`,
        `L ${x2} ${br}`,
        `C ${mx} ${br}, ${mx} ${bl}, ${x1} ${bl}`,
        'Z',
    ].join(' ')
}

/** The pace-delta math itself, decoupled from FNode so FloatNode (which has no node object of
 *  its own, just a bare value/target pair) can share it without constructing a fake one. */
function paceDelta(target: number | null, actual: number | null, expectedPct: number): { delta: number | null; behind: boolean } {
    if (target == null || actual == null) return { delta: null, behind: false }
    // Nothing to compare when the target and the achieved figure are both zero — a filter
    // selection with no data, or a grid cell with no target. delta would be 0, which is "not
    // behind", which paints the node green with a ▲: an empty funnel reading as every node
    // ahead of pace. Neutral instead, same as an absent target.
    if (target === 0 && actual === 0) return { delta: null, behind: false }
    const paced = target * (expectedPct / 100)
    const delta = paced - actual
    return { delta, behind: delta > 0 }
}

/** Per-node pace delta: prorated target minus achieved (positive = behind) — same meaning as
 *  Buyer's OverallFunnel's "vs pace". */
export function paceOf(s: FNode, expectedPct: number): { delta: number | null; behind: boolean } {
    return paceDelta(s.target, s.actual, expectedPct)
}

/** A ribbon's rate readout — label/value/target stacked in that order whichever side of the
 *  ribbon it sits on, so the reading order is always "what this is, then the number, then the
 *  target" moving away from the ribbon, not literally top-to-bottom on the page. */
export function RateLabel({
    mx,
    my,
    side,
    label,
    achieved,
    target,
}: {
    mx: number
    my: number
    side: 'above' | 'below'
    label: string | null
    achieved: number | null
    target: number | null
}) {
    const [oLabel, oVal, oTarget] = side === 'above' ? [-40, -22, -8] : [8, 22, 40]
    return (
        <>
            {label && (
                <text x={mx} y={my + oLabel} textAnchor="middle" fontSize={9} fill={MUTED} letterSpacing="0.07em">
                    {label}
                </text>
            )}
            <text x={mx} y={my + oVal} textAnchor="middle" fontSize={19} fontWeight={800} fill={INK}>
                {pctLabel(achieved, '%')}
            </text>
            {target != null && (
                <text x={mx} y={my + oTarget} textAnchor="middle" fontSize={11} fill={MUTED}>
                    target {pctLabel(target, '%')}
                </text>
            )}
        </>
    )
}

export function FloatNode({
    cx,
    cy,
    w,
    h,
    title,
    value,
    sub,
    target,
    expectedPct,
}: {
    cx: number
    cy: number
    w: number
    h: number
    title: string
    value: number | null
    sub: string
    /** Optional quarter target — when present, the box grows to fit a "target N" line and (with
     *  `expectedPct`) a pace-coloured "▲/▼ N vs pace" line, mirroring FunnelNodeBox's target/pace
     *  language at a smaller scale. Omitted entirely, this renders exactly as it always has. */
    target?: number | null
    expectedPct?: number
}) {
    const hasTarget = target !== undefined
    const boxH = hasTarget ? h + 26 : h
    const x = cx - w / 2
    const y = cy - boxH / 2
    const { delta, behind } = hasTarget && expectedPct != null ? paceDelta(target ?? null, value, expectedPct) : { delta: null, behind: false }
    const status = delta == null ? MUTED : behind ? RED : GREEN
    return (
        <g>
            <rect
                x={x}
                y={y}
                width={w}
                height={boxH}
                rx={11}
                fill="#f4efe7"
                stroke={delta == null ? '#e6e0d5' : status}
                strokeOpacity={delta == null ? 1 : 0.45}
                strokeWidth={1}
            />
            <text x={cx} y={y + 17} textAnchor="middle" fontSize={9} fill={MUTED} letterSpacing="0.06em">
                {title.toUpperCase()}
            </text>
            <text x={cx} y={y + 38} textAnchor="middle" fontSize={19} fontWeight={800} fill={INK}>
                {n(value)}
            </text>
            <text x={cx} y={y + 50} textAnchor="middle" fontSize={8.5} fill={MUTED}>
                {sub}
            </text>
            {hasTarget && target != null && (
                <text x={cx} y={y + 63} textAnchor="middle" fontSize={8.5} fill={MUTED}>
                    target {n(target)}
                </text>
            )}
            {delta != null && (
                <text x={cx} y={y + 75} textAnchor="middle" fontSize={9} fontWeight={700} fill={status}>
                    {behind ? '▼' : '▲'} {n(Math.abs(delta))} vs pace
                </text>
            )}
        </g>
    )
}

export function FloatLink({
    x,
    topY,
    nodeY,
    ratio,
    unit = 'x',
}: {
    x: number
    topY: number
    /** The y of the node this float connects down to. */
    nodeY: number
    ratio: number | null
    /** 'x' for a multiplier (the float number is bigger than its base), '%' for a share of a
     *  whole (a part of the total, not a multiple of it). */
    unit?: '%' | 'x'
}) {
    const y2 = nodeY - NODE_H / 2
    return (
        <g>
            <path
                d={`M ${x} ${topY} C ${x} ${(topY + y2) / 2}, ${x} ${(topY + y2) / 2}, ${x} ${y2}`}
                stroke={MUTED}
                strokeWidth={1.3}
                fill="none"
                strokeDasharray="3 3"
            />
            {ratio != null && (
                <>
                    <rect x={x + 6} y={(topY + y2) / 2 - 10} width={58} height={18} rx={9} fill="#fbf9f4" stroke="#e6e0d5" />
                    <text x={x + 35} y={(topY + y2) / 2 + 3} textAnchor="middle" fontSize={11} fontWeight={700} fill={INK}>
                        {pctLabel(ratio, unit)}
                    </text>
                </>
            )}
        </g>
    )
}

/** One ribbon (with its optional rate readout) between two nodes — the shared per-segment
 *  renderer both funnels map their own ribbon list through. */
export function Ribbon({ from, to, rate, maxVal }: { from: FNode; to: FNode; rate?: Rate; maxVal: number }) {
    const thick = (v: number | null): number => 6 + Math.sqrt(Math.max(0, v ?? 0) / maxVal) * 40
    const x1 = from.x + NODE_W / 2
    const x2 = to.x - NODE_W / 2
    const t1 = thick(from.actual)
    const t2 = thick(to.actual)
    const mx = (x1 + x2) / 2
    const my = (from.y + to.y) / 2
    return (
        <g>
            <path d={ribbonPath(x1, t1, from.y, x2, t2, to.y)} fill={RIBBON} opacity={0.16} />
            {rate?.achieved != null && <RateLabel mx={mx} my={my} side={rate.side} label={rate.label} achieved={rate.achieved} target={rate.target} />}
        </g>
    )
}

/** One spine/arm node box, pace-coloured — the shared per-node renderer both funnels map their
 *  own node list through. */
export function FunnelNodeBox({ node, expectedPct }: { node: FNode; expectedPct: number }) {
    const { delta, behind } = paceOf(node, expectedPct)
    const status = delta == null ? MUTED : behind ? RED : GREEN
    const x = node.x - NODE_W / 2
    const y = node.y - NODE_H / 2
    return (
        <g>
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
            <text x={node.x} y={node.target != null ? y + 19 : y + 34} textAnchor="middle" fontSize={9.5} fill={MUTED} letterSpacing="0.06em">
                {node.label.toUpperCase()}
            </text>
            <text x={node.x} y={node.target != null ? y + 45 : y + 60} textAnchor="middle" fontSize={26} fontWeight={800} fill={INK}>
                {n(node.actual)}
            </text>
            {node.target != null && (
                <text x={node.x} y={y + 60} textAnchor="middle" fontSize={10.5} fill={MUTED}>
                    target {n(node.target)}
                </text>
            )}
            {delta != null && (
                <text x={node.x} y={y + 74} textAnchor="middle" fontSize={11} fontWeight={700} fill={status}>
                    {behind ? '▼' : '▲'} {n(Math.abs(delta))} vs pace
                </text>
            )}
        </g>
    )
}

/** Total Visits float, converging from the New and Old visit nodes via two dashed connectors
 *  (an annotative merge point, not a literal ribbon — the arms stay separate through
 *  Conversions), with Visits in Pipeline hanging off its bottom edge as a dashed line and plain
 *  text, no box (there's no agreed target for it, unlike a real node). Shared because both
 *  funnels place this identically, just with different sub-labels/values. */
export function VisitsConvergence({
    pipelineCount,
    totalVisits,
    sub,
    target,
    expectedPct,
}: {
    pipelineCount: number
    totalVisits: number | null
    sub: string
    /** Total Visits' own quarter target + pace, per an explicit growth-team request ("Total
     *  Visits targets in the funnels and their lag etc. need to be mentioned") — both funnels'
     *  totalVisits.target already carries the right figure (Property Visits' own target reuse
     *  landed earlier this session), this just threads it into the float box. */
    target?: number | null
    expectedPct?: number
}) {
    // Mirrors FloatNode's own h+26 growth when a target is present, so the connectors and the
    // "Visits in Pipeline" caption below always meet the box's actual edge instead of overlapping
    // it. With no target (target left undefined), halfH is 24 — the original, unchanged layout.
    const halfH = (target !== undefined ? 48 + 26 : 48) / 2
    return (
        <>
            <path d={`M ${XS[2]} ${UPPER_Y + NODE_H / 2} L ${XS[2]} ${SY - halfH}`} stroke={MUTED} strokeWidth={1.3} fill="none" strokeDasharray="3 3" />
            <path d={`M ${XS[2]} ${LOWER_Y - NODE_H / 2} L ${XS[2]} ${SY + halfH}`} stroke={MUTED} strokeWidth={1.3} fill="none" strokeDasharray="3 3" />
            <FloatNode cx={XS[2]!} cy={SY} w={150} h={48} title="Total Visits" value={totalVisits} sub={sub} target={target} expectedPct={expectedPct} />
            <path d={`M ${XS[2]} ${SY + halfH} L ${XS[2]} ${SY + halfH + 18}`} stroke={MUTED} strokeWidth={1.3} fill="none" strokeDasharray="3 3" />
            <text x={XS[2]!} y={SY + halfH + 32} textAnchor="middle" fontSize={12.5} fontWeight={700} fill={INK}>
                Visits in Pipeline {n(pipelineCount)}
            </text>
        </>
    )
}
