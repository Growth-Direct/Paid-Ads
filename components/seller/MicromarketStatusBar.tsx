'use client'

import { LEGEND_STYLE, legendFormatter } from '@/components/shared/chartLegend'
import { Dropdown, MONO, Row } from '@/components/shared/FilterControls'
import type { Scope } from '@/lib/seller/filters'
import type { ClusterPipelinePoint, CohortSplitPipeline } from '@/lib/seller/types'
import { useState } from 'react'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ScopeFilterDropdown } from './ScopeFilterDropdown'

// A vertical stacked bar chart, micromarket on the x-axis, segments stacked by an arbitrary
// status list — shared by Pre-Visit Pipeline, Acq Pipeline and Properties with Stalled
// Conversions (all three: "count of properties by Acq_Status, one bar per micromarket,
// filterable to just the statuses that matter for that chart"). Reuses ClusterPipelinePoint
// (its `cluster` field holds the MICROMARKET name for these callers) rather than adding a
// near-identical type just for the axis label.
//
// Rebuilt 2026-09-24, per an explicit growth-team request, with two more chart-local controls
// alongside the status filter: a Window/Till Date toggle (Window = "attribute basis lead
// creation time", Till Date = "forever") and a New/Old visit scope filter (default Overall).
// `data`/`tillDateData` each carry BOTH cohorts (CohortSplitPipeline) so this component can
// merge whichever the two toggles currently select without a refetch. See
// lib/seller/types.ts's CohortSplitPipeline doc comment for why Window's Old half is always
// empty, and lib/seller/derive.ts's `windowSplit` for the full server-side reasoning.
//
// The status-visibility filter is always on here (unlike WoWStackedBar's opt-in
// `allowStatusFilter`) — every caller of this component needs it, since each chart's whole
// point is letting the reader narrow to a subset of its own status list. Built from the same
// Dropdown/Row/footer pieces WoWStackedBar's own StatusFilterDropdown uses, so it looks and
// behaves identically; not importing it directly since that one is typed around
// WeekSeriesPoint's week-pairing machinery this component has no use for.

interface Props {
    /** Window mode's reading (New only — see CohortSplitPipeline's doc comment). */
    data: CohortSplitPipeline
    /** Till Date mode's reading (New + Old both populated). */
    tillDateData: CohortSplitPipeline
    /** Status display order; a status not listed sorts after, alphabetically. */
    categoryOrder?: string[]
    colorFor: (key: string) => string
    onSegmentClick: (point: ClusterPipelinePoint, category: string) => void
}

/** Sums a CohortSplitPipeline's New/Old halves (per the selected scope) into one flat
 *  ClusterPipelinePoint[], merged by micromarket — the shape this component's chart rendering
 *  already knows how to draw. */
function mergeCohorts(split: CohortSplitPipeline, scope: Scope[]): ClusterPipelinePoint[] {
    const map = new Map<string, ClusterPipelinePoint>()
    const add = (points: ClusterPipelinePoint[]) => {
        for (const p of points) {
            const existing = map.get(p.cluster) ?? { cluster: p.cluster, counts: {}, leadIds: {} }
            for (const [k, v] of Object.entries(p.counts)) existing.counts[k] = (existing.counts[k] ?? 0) + (v ?? 0)
            for (const [k, ids] of Object.entries(p.leadIds)) existing.leadIds[k] = [...(existing.leadIds[k] ?? []), ...(ids ?? [])]
            map.set(p.cluster, existing)
        }
    }
    if (scope.includes('New')) add(split.new)
    if (scope.includes('Old')) add(split.old)
    return [...map.values()]
}

const TOGGLE_MONO = "'IBM Plex Mono', monospace"

/** Same small pill-button-group styling as components/buyer/WoWStackedBar.tsx's own
 *  ToggleGroup — not imported directly since that one lives alongside WoW-chart-specific types
 *  this component has no use for. */
function ToggleGroup<T extends string>({
    options,
    value,
    onChange,
}: {
    options: { value: T; label: string }[]
    value: T
    onChange: (v: T) => void
}) {
    return (
        <div style={{ display: 'flex', border: '1px solid #e6e0d5', borderRadius: 6, overflow: 'hidden' }}>
            {options.map((opt) => (
                <button
                    key={opt.value}
                    onClick={() => onChange(opt.value)}
                    style={{
                        padding: '3px 10px',
                        fontSize: 10.5,
                        fontFamily: TOGGLE_MONO,
                        border: 'none',
                        cursor: 'pointer',
                        background: value === opt.value ? '#3a7d5d' : 'transparent',
                        color: value === opt.value ? '#fbf9f4' : '#9a948a',
                    }}>
                    {opt.label}
                </button>
            ))}
        </div>
    )
}
type DateMode = 'window' | 'tillDate'
const DATE_MODE_OPTIONS: { value: DateMode; label: string }[] = [
    { value: 'window', label: 'Window' },
    { value: 'tillDate', label: 'Till Date' },
]

const STATUS_FOOTER_BTN: React.CSSProperties = {
    flex: 1,
    padding: '5px 8px',
    borderRadius: 6,
    border: '1px solid #e0dad0',
    background: 'transparent',
    color: '#6b655c',
    fontFamily: MONO,
    fontSize: 10.5,
    cursor: 'pointer',
}

function StatusFilterDropdown({
    keys,
    hidden,
    onToggle,
    onSetHidden,
}: {
    keys: string[]
    hidden: Set<string>
    onToggle: (key: string) => void
    onSetHidden: (next: Set<string>) => void
}) {
    const shown = keys.length - hidden.size
    return (
        <Dropdown
            label="Statuses"
            summary={hidden.size === 0 ? 'All' : `${shown}/${keys.length}`}
            active={hidden.size > 0}
            width={260}
            footer={
                <div style={{ display: 'flex', gap: 6 }}>
                    <button style={STATUS_FOOTER_BTN} onClick={() => onSetHidden(new Set())}>
                        Select all
                    </button>
                    <button style={STATUS_FOOTER_BTN} onClick={() => onSetHidden(new Set(keys))}>
                        Deselect all
                    </button>
                </div>
            }>
            {keys.map((k) => (
                <Row key={k} label={k} checked={!hidden.has(k)} onToggle={() => onToggle(k)} />
            ))}
        </Dropdown>
    )
}

/** Renders each bar's grand total just above its topmost stacked segment — attached only to
 *  the LAST visible `<Bar>` so its own `y` is already the top of the whole bar. Mirrors
 *  WoWStackedBar's own makeTotalLabel exactly. */
function makeTotalLabel(totals: number[]) {
    return (props: { x?: number; y?: number; width?: number; index?: number }) => {
        const { x, y, width, index } = props
        if (x == null || y == null || width == null || index == null) return <></>
        const total = totals[index]
        if (!total) return <></>
        return (
            <text x={x + width / 2} y={y - 6} textAnchor="middle" fontSize={10} fontWeight={700} fill="#3a3630" fontFamily={MONO}>
                {total.toLocaleString('en-IN')}
            </text>
        )
    }
}

interface RechartsTooltipProps {
    active?: boolean
    payload?: Array<{ dataKey?: string | number; name?: string | number; value?: number; color?: string }>
}

/** One tooltip entry per status in the hovered micromarket's bar, each with its own count and
 *  share of that bar's (visible) total — mirrors ClusterPipelineBar's own ShareTooltip. */
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
                <div
                    key={String(e.dataKey)}
                    style={{ display: 'flex', justifyContent: 'space-between', gap: 14, color: e.color ?? '#3a3630' }}>
                    <span>{e.name}</span>
                    <span>
                        {e.value} ({total > 0 ? (((e.value ?? 0) / total) * 100).toFixed(1) : '0.0'}%)
                    </span>
                </div>
            ))}
        </div>
    )
}

export default function MicromarketStatusBar({ data, tillDateData, categoryOrder, colorFor, onSegmentClick }: Props) {
    const [hidden, setHidden] = useState<Set<string>>(new Set())
    const [dateMode, setDateMode] = useState<DateMode>('window')
    const [scope, setScope] = useState<Scope[]>(['New', 'Old'])
    const activeSplit = dateMode === 'tillDate' ? tillDateData : data
    const activeData = mergeCohorts(activeSplit, scope)
    const allKeys = [...new Set(activeData.flatMap((p) => Object.keys(p.counts)))]
    const orderedKeys = categoryOrder
        ? [...categoryOrder.filter((k) => allKeys.includes(k)), ...allKeys.filter((k) => !categoryOrder.includes(k)).sort()]
        : [...allKeys].sort()
    const visibleKeys = orderedKeys.filter((k) => !hidden.has(k))

    const chartData = activeData.map((p) => ({
        micromarket: p.cluster,
        ...Object.fromEntries(visibleKeys.map((k) => [k, p.counts[k] ?? 0])),
    }))
    const totals = activeData.map((p) => visibleKeys.reduce((s, k) => s + (p.counts[k] ?? 0), 0))
    const tooltipContent = ({ active, payload }: RechartsTooltipProps) => (active ? <ShareTooltip payload={payload} /> : null)

    const toggle = (k: string) =>
        setHidden((h) => {
            const next = new Set(h)
            if (next.has(k)) next.delete(k)
            else next.add(k)
            return next
        })

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 8, flexShrink: 0, flexWrap: 'wrap' }}>
                <ToggleGroup options={DATE_MODE_OPTIONS} value={dateMode} onChange={setDateMode} />
                <ScopeFilterDropdown label="Visits" scope={scope} onChange={setScope} />
                <StatusFilterDropdown keys={orderedKeys} hidden={hidden} onToggle={toggle} onSetHidden={setHidden} />
            </div>
            <div style={{ flex: 1, minHeight: 0 }}>
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} margin={{ top: 20, right: 4, bottom: 4, left: 0 }} barSize={36}>
                        <CartesianGrid vertical={false} stroke="#efe9e0" strokeDasharray="0" />
                        <XAxis
                            dataKey="micromarket"
                            tick={{ fontFamily: MONO, fontSize: 10, fill: '#6b655c' }}
                            axisLine={false}
                            tickLine={false}
                        />
                        <YAxis
                            allowDecimals={false}
                            width={40}
                            tick={{ fontFamily: MONO, fontSize: 10, fill: '#9a948a' }}
                            axisLine={false}
                            tickLine={false}
                        />
                        <Tooltip content={tooltipContent} cursor={{ fill: 'rgba(0,0,0,0.04)' }} />
                        <Legend wrapperStyle={LEGEND_STYLE} formatter={legendFormatter} />
                        {visibleKeys.map((k, i) => (
                            <Bar
                                key={k}
                                dataKey={k}
                                stackId="a"
                                fill={colorFor(k)}
                                name={k}
                                cursor="pointer"
                                label={i === visibleKeys.length - 1 ? makeTotalLabel(totals) : undefined}
                                onClick={(_, index) => {
                                    const point = activeData[index as number]
                                    if (point) onSegmentClick(point, k)
                                }}
                            />
                        ))}
                    </BarChart>
                </ResponsiveContainer>
            </div>
        </div>
    )
}
