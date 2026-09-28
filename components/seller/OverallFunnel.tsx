'use client'

import type { SellerOverallFunnelData } from '@/lib/seller/types'

// Adapted from components/buyer/OverallFunnel.tsx — same spine/ribbon/float-node visual
// system, but the seller shape differs in two ways:
//   - The two float boxes hold DIFFERENT numbers with DIFFERENT gates: "Qualified Properties"
//     (any Acq_Status, every property of a Qualified seller) over Qualified Leads, and
//     "Qualified Property Visits" (the three-case rule) over Unique Seller Visits — the second
//     is not a subset of the first once Old-cohort sellers are in scope (see the doc comment
//     on qualifyingProperties in lib/seller/types.ts).
//   - The branch below the visit node ("Visits in Pipeline") is a plain count, not a rate —
//     there's no agreed target for it, unlike Buyer's Ever Warm percentage.
// See components/buyer/OverallFunnel.tsx for the ribbon/taper/pace-colour rationale.

const MONO = "'IBM Plex Mono', monospace"
const GREEN = '#16A34A'
const RED = '#DC2626'
const MUTED = '#333333'
const INK = '#000000'
const RIBBON = '#16A34A'

const VBW = 1160
const VBH = 300
const SY = 168
const NODE_W = 168
const NODE_H = 82
const XS = [128, 420, 712, 1004]

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

export default function OverallFunnel({ data, expectedPct }: { data: SellerOverallFunnelData; expectedPct: number }) {
    const spine: Spine[] = [
        { label: 'Unique Leads', actual: data.uniqueLeads.actual, target: data.uniqueLeads.target },
        { label: 'Qualified Leads', actual: data.qualified.actual, target: data.qualified.target },
        { label: 'Unique Seller Visits', actual: data.uniqueSellerVisits.actual, target: data.uniqueSellerVisits.target },
        { label: 'Conversions', actual: data.conversions.actual, target: data.conversions.target },
    ]

    const spineRates = [
        { label: 'LTQL', unit: '%' as const, achieved: data.ltqlPct, target: data.ltqlTarget },
        { label: 'QLTV', unit: '%' as const, achieved: data.qltvPct, target: data.qltvTarget },
        { label: null, unit: '%' as const, achieved: data.convRatePct, target: data.convRateTarget },
    ]

    const maxVal = Math.max(...spine.map((s) => s.actual ?? 0), 1)
    const thick = (v: number | null): number => 6 + Math.sqrt(Math.max(0, v ?? 0) / maxVal) * 40

    // Per-node pace delta: prorated target minus achieved (positive = behind) — same as
    // Buyer's OverallFunnel, so "vs pace" means the same thing on both tabs.
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

    const ratioOf = (n: number, d: number): number | null => (d > 0 ? n / d : null)

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
                                {r.label && (
                                    <text x={mx} y={SY - 40} textAnchor="middle" fontSize={9} fill={MUTED} letterSpacing="0.07em">
                                        {r.label}
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

            {/* Three float boxes, each its own number: Qualified Properties (any Acq_Status,
                every property of this window's Qualified Leads) over Qualified Leads,
                Qualified Property Visits (the three-case-rule count) over Unique Seller
                Visits, and Total Conversions (Channel Partner + Direct) over Conversions —
                the only reading anywhere on this dashboard that adds Channel Partner-sourced
                sellers back in. */}
            <FloatLink x={XS[1]!} topY={92} ratio={ratioOf(data.qualifiedSellerProperties, spine[1]!.actual ?? 0)} />
            <FloatLink x={XS[2]!} topY={92} ratio={ratioOf(data.qualifyingProperties, spine[2]!.actual ?? 0)} />
            {/* Direct's share of the combined Channel Partner + Direct total, as a percentage —
                not a multiplier like the two float links above, since Direct is a PART of this
                total, not a bigger reading over the same base. */}
            <FloatLink
                x={XS[3]!}
                topY={92}
                unit="%"
                ratio={
                    data.totalConversionsWithChannelPartner > 0
                        ? (data.directConversionsTotal / data.totalConversionsWithChannelPartner) * 100
                        : null
                }
            />
            <FloatNode cx={XS[1]!} cy={62} title="Qualified Properties" value={data.qualifiedSellerProperties} sub="any Acq_Status" />
            <FloatNode cx={XS[2]!} cy={62} title="Qualified Property Visits" value={data.qualifyingProperties} sub="Acq_Status qualifying" />
            <FloatNode
                cx={XS[3]!}
                cy={62}
                title="Total Conversions"
                value={data.totalConversionsWithChannelPartner}
                sub="Channel Partner + Direct"
            />

            {/* Visits in Pipeline — a plain count, not a rate, below Unique Seller Visits. */}
            <g>
                <path
                    d={`M ${XS[2]} ${SY + NODE_H / 2} C ${XS[2]} ${SY + 58}, ${XS[2]} ${SY + 58}, ${XS[2]} ${SY + 66}`}
                    stroke={MUTED}
                    strokeWidth={1.3}
                    fill="none"
                    strokeDasharray="3 3"
                />
                <text x={XS[2]!} y={SY + 84} textAnchor="middle" fontSize={12.5} fontWeight={700} fill={INK}>
                    Visits in Pipeline {n(data.pipelineCount)}
                </text>
            </g>

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
                            fill="#FFFFFF"
                            stroke={delta == null ? '#CCCCCC' : status}
                            strokeOpacity={delta == null ? 1 : 0.45}
                            strokeWidth={1.4}
                        />
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
            <rect x={x} y={y} width={w} height={h} rx={11} fill="#F5F5F5" stroke="#CCCCCC" strokeWidth={1} />
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

function FloatLink({
    x,
    topY,
    ratio,
    unit = 'x',
}: {
    x: number
    topY: number
    ratio: number | null
    /** 'x' for a multiplier (the float number is bigger than its base — Qualified
     *  Properties/Visits float above a smaller spine node), '%' for a share of a whole (Direct
     *  is a PART of the Channel Partner + Direct total, not a multiple of it). */
    unit?: '%' | 'x'
}) {
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
            {ratio != null && (
                <>
                    <rect x={x + 6} y={(topY + y2) / 2 - 10} width={58} height={18} rx={9} fill="#FFFFFF" stroke="#CCCCCC" />
                    <text x={x + 35} y={(topY + y2) / 2 + 3} textAnchor="middle" fontSize={11} fontWeight={700} fill={INK}>
                        {pctLabel(ratio, unit)}
                    </text>
                </>
            )}
        </g>
    )
}
