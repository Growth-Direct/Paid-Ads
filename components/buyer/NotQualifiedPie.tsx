'use client'

import { LEGEND_STYLE, legendFormatter } from '@/components/shared/chartLegend'
import type { ReasonPoint } from '@/lib/buyer/types'
import { useEffect, useRef, useState } from 'react'
import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import { colorFor as buyerColorFor } from './palette'

interface Props {
    data: ReasonPoint[]
    onSliceClick: (point: ReasonPoint) => void
    /** Maps a reason to a colour. Defaults to the buyer palette; the seller tab passes its own
     *  so reasons keep seller hues. Non-breaking for buyer callers. */
    colorFor?: (key: string) => string
    /** Shows the FULL reason breakdown (every reason's count and share of the total) in the
     *  tooltip on hover, not just the slice under the cursor — the hovered one is bolded, the
     *  rest muted, so the whole split stays visible without moving the mouse. Seller-only —
     *  Buyer's own tooltip renders exactly as before (default recharts, hovered slice only). The
     *  legend stays plain reason names either way. */
    showPercent?: boolean
    /** A small dotted-arrow annotation breaking `subReasonsParentReason`'s own slice down
     *  further (e.g. "Not Truva approved" broken into WHY, from a separate Zoho multiselect
     *  field) — percentages are of that one reason's own count in `data`, not the pie's grand
     *  total. Seller-only; omitted entirely (no box, no arrow) when `subReasons` is empty. */
    subReasons?: ReasonPoint[]
    subReasonsParentReason?: string
    subReasonsLabel?: string
}

/** The callout box's own content — count/percent rows, no positioning of its own. Positioning
 *  (and the arrow pointing at it) lives in NotQualifiedPie, which needs this box's actual
 *  rendered position to draw a line that really reaches it. */
function SubReasonRows({ label, subReasons, parentTotal }: { label: string; subReasons: ReasonPoint[]; parentTotal: number }) {
    return (
        <>
            <div style={{ fontWeight: 700, color: '#3a3630', fontSize: 9.5, marginBottom: 2 }}>{label}</div>
            {subReasons.map((r) => {
                const pct = parentTotal > 0 ? ((r.count / parentTotal) * 100).toFixed(1) : '0.0'
                return (
                    <div key={r.reason} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                        <span>{r.reason}</span>
                        <span style={{ flexShrink: 0 }}>
                            {r.count} ({pct}%)
                        </span>
                    </div>
                )
            })}
        </>
    )
}

/** Lists every reason with its count and share of the total, bolding whichever one is under the
 *  cursor — so the full split is visible on any hover, not just the hovered slice. */
function FullSplitTooltip({ data, total, activeReason }: { data: ReasonPoint[]; total: number; activeReason?: string }) {
    return (
        <div
            style={{
                background: '#fbf9f4',
                border: '1px solid #e9e4db',
                borderRadius: 8,
                padding: '8px 10px',
                fontSize: 12,
                fontFamily: "'IBM Plex Mono', monospace",
                color: '#3a3630',
                minWidth: 200,
            }}>
            {data.map((p) => {
                const pct = total > 0 ? ((p.count / total) * 100).toFixed(1) : '0.0'
                const active = p.reason === activeReason
                return (
                    <div
                        key={p.reason}
                        style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            gap: 16,
                            fontWeight: active ? 700 : 400,
                            color: active ? '#3a3630' : '#9a948a',
                        }}>
                        <span>{p.reason}</span>
                        <span>
                            {p.count} ({pct}%)
                        </span>
                    </div>
                )
            })}
        </div>
    )
}

export default function NotQualifiedPie({
    data,
    onSliceClick,
    colorFor = buyerColorFor,
    showPercent = false,
    subReasons,
    subReasonsParentReason,
    subReasonsLabel,
}: Props) {
    const total = data.reduce((s, p) => s + p.count, 0)
    const tooltipContent = showPercent
        ? ({ active, payload }: { active?: boolean; payload?: Array<{ payload?: ReasonPoint }> }) =>
              active ? <FullSplitTooltip data={data} total={total} activeReason={payload?.[0]?.payload?.reason} /> : null
        : undefined
    const parentTotal = data.find((p) => p.reason === subReasonsParentReason)?.count ?? 0
    const hasSubReasons = !!subReasons && subReasons.length > 0

    // The callout box is positioned by CSS (top/right, in px), so its actual on-screen spot
    // shifts with the container's width — a fixed-% arrow endpoint drifted away from the box
    // the moment this chart's card got wider. Measured from the real DOM instead: the arrow's
    // end is always the box's own top-left corner, whatever size the container turns out to be.
    const wrapRef = useRef<HTMLDivElement>(null)
    const boxRef = useRef<HTMLDivElement>(null)
    const [arrow, setArrow] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null)

    useEffect(() => {
        if (!hasSubReasons) {
            setArrow(null)
            return
        }
        const wrap = wrapRef.current
        const box = boxRef.current
        if (!wrap || !box) return
        function measure() {
            const wrapRect = wrap!.getBoundingClientRect()
            const boxRect = box!.getBoundingClientRect()
            if (wrapRect.width === 0 || wrapRect.height === 0) return
            setArrow({
                x1: wrapRect.width * 0.42,
                y1: wrapRect.height * 0.4,
                x2: boxRect.left - wrapRect.left - 4,
                y2: boxRect.top - wrapRect.top + 12,
            })
        }
        measure()
        const ro = new ResizeObserver(measure)
        ro.observe(wrap)
        return () => ro.disconnect()
    }, [hasSubReasons, subReasons, subReasonsLabel])

    return (
        <div ref={wrapRef} style={{ position: 'relative', width: '100%', height: '100%' }}>
            <ResponsiveContainer width="100%" height="100%">
                <PieChart margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
                    <Pie
                        data={data}
                        dataKey="count"
                        nameKey="reason"
                        innerRadius="45%"
                        outerRadius="80%"
                        cursor="pointer"
                        onClick={(_, index) => {
                            const point = data[index]
                            if (point) onSliceClick(point)
                        }}>
                        {data.map((p) => (
                            <Cell key={p.reason} fill={colorFor(p.reason)} />
                        ))}
                    </Pie>
                    <Tooltip
                        content={tooltipContent}
                        contentStyle={{
                            background: '#fbf9f4',
                            border: '1px solid #e9e4db',
                            borderRadius: 8,
                            fontSize: 12,
                            fontFamily: "'IBM Plex Mono', monospace",
                        }}
                    />
                    <Legend wrapperStyle={LEGEND_STYLE} formatter={legendFormatter} />
                </PieChart>
            </ResponsiveContainer>
            {hasSubReasons && (
                <>
                    {arrow && (
                        <svg
                            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
                            aria-hidden>
                            <defs>
                                <marker id="subReasonArrowhead" markerWidth={6} markerHeight={6} refX={4} refY={2} orient="auto">
                                    <path d="M0,0 L4,2 L0,4 Z" fill="#9a948a" />
                                </marker>
                            </defs>
                            <line
                                x1={arrow.x1}
                                y1={arrow.y1}
                                x2={arrow.x2}
                                y2={arrow.y2}
                                stroke="#9a948a"
                                strokeWidth={1}
                                strokeDasharray="3 3"
                                markerEnd="url(#subReasonArrowhead)"
                            />
                        </svg>
                    )}
                    <div
                        ref={boxRef}
                        style={{
                            position: 'absolute',
                            top: 4,
                            right: 4,
                            maxWidth: 160,
                            background: '#fbf9f4',
                            border: '1px dashed #c9c2b4',
                            borderRadius: 8,
                            padding: '5px 8px',
                            fontSize: 10,
                            fontFamily: "'IBM Plex Mono', monospace",
                            color: '#6b655c',
                            lineHeight: 1.5,
                            // A footnote, not a control — never eats a click meant for the pie
                            // slice underneath (drill-down still works wherever this sits).
                            pointerEvents: 'none',
                        }}>
                        <SubReasonRows label={subReasonsLabel ?? 'Sub-reasons'} subReasons={subReasons!} parentTotal={parentTotal} />
                    </div>
                </>
            )}
        </div>
    )
}
