'use client'

import { weekGroups } from '@/lib/buyer/weekGroups'
import type { WeekSeriesPoint } from '@/lib/buyer/types'
import { useState } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { LEGEND_STYLE, legendFormatter } from '@/components/shared/chartLegend'
import { Dropdown, MONO, Row } from '@/components/shared/FilterControls'
import { colorFor as buyerColorFor } from './palette'

type StackMode = 'count' | 'percent'
type Granularity = 'weekly' | 'biweekly'

interface Props {
    data: WeekSeriesPoint[]
    onSegmentClick: (point: WeekSeriesPoint, seriesKey: string) => void
    /** Canonical series order, e.g. SOURCE_ORDER. Keys not in it sort after, alphabetically.
     *  Without one the stack order follows whichever key each week happened to see first. */
    seriesOrder?: string[]
    /** Maps a series key to a colour. Defaults to the buyer palette; the seller tab passes
     *  its own so channels/statuses keep their seller hues. Non-breaking for buyer callers. */
    colorFor?: (key: string) => string
    /** Groups adjacent weeks into fortnight pairs — two side-by-side stacked clusters under
     *  one x-axis tick instead of one bar per week (a trailing odd week gets its own solo
     *  group). Seller-only: the reporting cadence there is fortnightly. Buyer callers don't
     *  pass this, so Buyer's charts render exactly as before. */
    pairWeeks?: boolean
    /** Tooltip additionally shows each series' share of its own week's total, not just the
     *  absolute count — e.g. "Meta: 42 (31.6%)". Seller-only, same reasoning as pairWeeks. */
    showSharePercent?: boolean
    /** Renders a small Count/% toggle above the chart; '%' re-scales every bar to its own
     *  week's 100%, so segment HEIGHT reads as share of that week rather than volume — the
     *  grand-total label and the tooltip keep showing the real count regardless of which view
     *  is active. Seller-only, same reasoning as pairWeeks/showSharePercent. */
    allowPercentToggle?: boolean
    /** Renders a Weekly/Bi-Weekly toggle above the chart; 'Bi-Weekly' sums each pair of adjacent
     *  weeks' counts (and concatenates their leadIds) into one combined fortnight bar BEFORE any
     *  other rendering happens — unlike `pairWeeks`, which only visually clusters two weeks'
     *  bars together without changing their values. When both this and `pairWeeks` are on, a
     *  merged bi-weekly point still renders one bar per fortnight (the values-actually-summed
     *  view wins) rather than trying to visually pair two already-merged fortnights together. */
    allowBiWeeklyToggle?: boolean
    /** Renders a small "Statuses" checklist above the chart, letting the reader hide specific
     *  series from the stack — local to this one chart instance, defaulting to every status
     *  shown (identical to today's behavior). Hiding a status removes it from the stack, the
     *  legend, both tooltips, and the grand-total/percent-of-total math for the remaining ones —
     *  it never touches what was fetched or any other chart/filter on the page. */
    allowStatusFilter?: boolean
    /** Changes how weeks club into fortnights: a partial week (the stub a mid-week quarter
     *  start leaves, and the running week at the end) stands alone, and the full weeks between
     *  them pair up — so every fortnight begins on the first FULL week and the grouping stays
     *  put as the quarter fills in. Affects both `pairWeeks` and the Bi-Weekly merge. Opt-in:
     *  Buyer passes it, Seller's 8 charts do not and group exactly as before. */
    pairFromFirstFullWeek?: boolean
    /** Maps a series key to its cluster (e.g. a micromarket to its cluster). When present the
     *  tooltip switches entirely to ClusterDeltaTooltip — a cluster subtotal over its
     *  micromarkets, each with its own count and week-over-week % change — instead of
     *  ShareTooltip, regardless of showSharePercent. Micromarket-Analysis-only. */
    clusterOf?: (key: string) => string
}

const TOGGLE_MONO = "'IBM Plex Mono', monospace"

// One small button-group renderer shared by both toggles (Count/% and Weekly/Bi-Weekly) — same
// pill styling, generic over the option values so nothing is duplicated between them.
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
const STACK_MODE_OPTIONS: { value: StackMode; label: string }[] = [
    { value: 'count', label: 'Count' },
    { value: 'percent', label: '%' },
]
const GRANULARITY_OPTIONS: { value: Granularity; label: string }[] = [
    { value: 'weekly', label: 'Weekly' },
    { value: 'biweekly', label: 'Bi-Weekly' },
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

/** The "Statuses" checklist for `allowStatusFilter` — built from the same Dropdown/Row pair
 *  the Time/Cluster/Source filters use (components/shared/FilterControls.tsx), so it looks and
 *  behaves like every other filter in the app. `keys` is always the FULL series list (so an
 *  already-hidden status stays listed to be re-checked), `hidden` only which are unchecked. The
 *  footer's Select all/Deselect all replace `hidden` outright rather than looping `onToggle` —
 *  one state update instead of `keys.length` of them. */
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
            width={220}
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

/** The slice of recharts' Tooltip content props this component actually reads — avoids
 *  pulling in recharts' full generic TooltipProps type for one narrow use. */
interface RechartsTooltipProps {
    active?: boolean
    payload?: Array<{ dataKey?: string | number; name?: string; value?: number; color?: string; payload?: Record<string, unknown> }>
}

/** One SVG pattern per series colour: the colour as a solid ground with pale diagonal stripes
 *  laid over it, so a hatched bar still reads as its own series.
 *
 *  Why hatch at all: buildBuckets admits a bucket as soon as its START is in the past, so the
 *  current week always shows holding only the days elapsed — 2 of 7 on a Tuesday. Rendered
 *  plain it reads as a collapse, and the Seller tab stacks six of these charts, so it reads as
 *  six collapses. Hiding the bar would be worse, because the current week is the one people
 *  most want to see. Keep it, and mark it.
 *
 *  The patterns live in a zero-size sibling <svg> rather than inside the chart: recharts
 *  filters children it does not recognise, so a <defs> passed to <BarChart> is silently
 *  dropped. An id reference resolves document-wide, so a sibling works and a child does not. */
// ResponsiveContainer measures its parent, so the pattern defs sit inside an explicitly
// full-size wrapper rather than as a bare fragment sibling — that keeps the container's parent
// a single sized box regardless of what the card around it does.
const CHART_WRAP: React.CSSProperties = {
    position: 'relative',
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
}
// Wraps ResponsiveContainer specifically (not the whole CHART_WRAP) so a chart with the toggle
// row (Count/%, Weekly/Bi-Weekly, or both) keeps that row's own natural height instead of being
// squeezed by flex — only this sibling shrinks to fill whatever height the toggles left behind.
const CHART_AREA: React.CSSProperties = { flex: 1, minHeight: 0 }

function patternIdFor(color: string): string {
    return `wowpartial-${color.replace(/[^a-zA-Z0-9]/g, '')}`
}

function PartialHatchDefs({ colors }: { colors: string[] }) {
    return (
        <svg width={0} height={0} style={{ position: 'absolute' }} aria-hidden>
            <defs>
                {colors.map((c) => (
                    <pattern
                        key={c}
                        id={patternIdFor(c)}
                        width={6}
                        height={6}
                        patternTransform="rotate(45)"
                        patternUnits="userSpaceOnUse">
                        <rect width={6} height={6} fill={c} />
                        <line x1={0} y1={0} x2={0} y2={6} stroke="#fbf9f4" strokeWidth={2.4} strokeOpacity={0.9} />
                    </pattern>
                ))}
            </defs>
        </svg>
    )
}

/** Fill for one bar segment: the flat series colour, or its hatched variant when that row's
 *  bucket is still in progress. Applied per data point via recharts' <Cell>, which is the
 *  supported way to vary one bar's fill without replacing the whole bar renderer. */
function fillFor(color: string, incomplete: boolean): string {
    return incomplete ? `url(#${patternIdFor(color)})` : color
}

/** Renders the stack's grand total just above its topmost segment. Attached only to the LAST
 *  `<Bar>` in a stack (which recharts renders on top), so its own `y` prop is already the top
 *  of the whole stack — the displayed number itself comes from a precomputed `totals` lookup
 *  by row index, not from that bar's own segment value. */
/** The stack's grand total, above its topmost segment — reads the RAW count regardless of
 *  which view is active (a precomputed `totals` lookup by row index, never this bar's own
 *  rendered value, which in percent view would be a share not a count). Attached only to the
 *  LAST `<Bar>` in a stack, which recharts renders on top, so its own `y` is already the top of
 *  the whole stack. */
function makeTotalLabel(totals: number[]) {
    return (props: { x?: number; y?: number; width?: number; index?: number }) => {
        const { x, y, width, index } = props
        if (x == null || y == null || width == null || index == null) return <></>
        const total = totals[index]
        if (!total) return <></>
        return (
            <text
                x={x + width / 2}
                y={y - 6}
                textAnchor="middle"
                fontSize={10}
                fontWeight={700}
                fill="#3a3630"
                fontFamily="'IBM Plex Mono', monospace">
                {total.toLocaleString('en-IN')}
            </text>
        )
    }
}

/** Every segment's own share, centred inside it — only in percent-toggle view (in count view
 *  this returns null and the bar renders unlabelled, as before). `share` is looked up by the
 *  caller from OUR OWN chartData row rather than trusted from recharts' `value` prop, which for
 *  a stacked bar's label is the segment's CUMULATIVE top (base + own share), not its own share
 *  — using it directly rendered an ascending sequence up each stack instead of each segment's
 *  real percentage. Skipped below ~6% share or a ~12px-tall segment: the text would no longer
 *  fit inside its own sliver and would spill into its neighbours instead of reading as that
 *  segment's label. */
function SegmentPercentLabel(props: { x?: number; y?: number; width?: number; height?: number; share: number | undefined }) {
    const { x, y, width, height, share } = props
    if (x == null || y == null || width == null || height == null || share == null) return null
    if (share < 6 || height < 12) return null
    return (
        <text
            x={x + width / 2}
            y={y + height / 2}
            dy={4}
            textAnchor="middle"
            fontSize={9.5}
            fontWeight={700}
            fill="#fbf9f4"
            fontFamily="'IBM Plex Mono', monospace">
            {Math.round(share)}%
        </text>
    )
}

/** Combines SegmentPercentLabel (only when `percent`) with makeTotalLabel's grand-total (only
 *  on the topmost series) into the single label recharts' `label` prop accepts per `<Bar>`.
 *  `shareForRow` looks the segment's own value up from the SAME chartData row this component
 *  built (by row index), sidestepping whatever `value`/`payload` shape recharts does or doesn't
 *  hand a stacked bar's label. */
function makeBarLabel(percent: boolean, isTopSeries: boolean, totals: number[], shareForRow: (rowIndex: number) => number | undefined) {
    const totalLabel = isTopSeries ? makeTotalLabel(totals) : null
    return (props: { x?: number; y?: number; width?: number; height?: number; index?: number }) => (
        <>
            {percent && <SegmentPercentLabel x={props.x} y={props.y} width={props.width} height={props.height} share={props.index != null ? shareForRow(props.index) : undefined} />}
            {totalLabel?.(props)}
        </>
    )
}

const MONTHS =['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** The Sunday-end date of a Monday-start week, from its ISO calendar-date key (e.g.
 *  '2026-07-06') — pure calendar arithmetic, no timezone conversion needed since the key is
 *  already an IST calendar day. */
function weekEndLabel(weekStartKey: string): string {
    const [y, m, d] = weekStartKey.split('-').map(Number)
    const end = new Date(Date.UTC(y!, m! - 1, d! + 6))
    return `${end.getUTCDate()} ${MONTHS[end.getUTCMonth()]}`
}

/** A week's own Monday–Sunday range, e.g. "6–12 Jul" (or "29 Jun – 5 Jul" when it crosses a
 *  month boundary, spelling out both months rather than compacting). Weeks are always
 *  Monday-start — see CLAUDE.md. */
function weekRangeLabel(p: WeekSeriesPoint): string {
    const endLabel = weekEndLabel(p.weekStart)
    const [startDay, startMonth] = p.weekLabel.split(' ')
    const endMonth = endLabel.split(' ')[1]
    const range = startMonth === endMonth ? `${startDay}–${endLabel}` : `${p.weekLabel} – ${endLabel}`
    // Named on the axis as well as hatched in the fill: the hatch is easy to miss on a short
    // bar, and a reader comparing tick labels should not have to infer it from today's date.
    return p.incomplete ? `${range} (partial)` : range
}

/** Sums each pair of adjacent points into one 14-day point for the Weekly/Bi-Weekly toggle:
 *  counts add per series key, leadIds concatenate per key (so drill-down shows the union of both
 *  weeks' leads), `incomplete` is true if EITHER week is. The combined range ("7 Sep – 20 Sep")
 *  is baked directly into the returned point's `weekLabel` — the caller uses it as-is for the
 *  x-axis instead of calling weekRangeLabel/weekEndLabel, which hardcode a 7-day span and would
 *  mislabel a genuinely 14-day point. A trailing odd point (odd-length input) is NOT merged —
 *  it still gets its own proper week-range label, same convention pairWeeks' own grouping uses
 *  for a solo trailing week. */
function mergeAdjacentWeeks(pts: WeekSeriesPoint[], fromFirstFullWeek: boolean): WeekSeriesPoint[] {
    return weekGroups(pts, fromFirstFullWeek).map((group) => {
        const a = group[0]!
        const b = group[1]
        if (!b) return { ...a, weekLabel: weekRangeLabel(a) }
        const counts: Partial<Record<string, number>> = { ...a.counts }
        for (const [k, v] of Object.entries(b.counts)) counts[k] = (counts[k] ?? 0) + (v ?? 0)
        const leadIds: Partial<Record<string, string[]>> = {}
        for (const k of new Set([...Object.keys(a.leadIds), ...Object.keys(b.leadIds)])) {
            leadIds[k] = [...(a.leadIds[k] ?? []), ...(b.leadIds[k] ?? [])]
        }
        const [ay, am, ad] = a.weekStart.split('-').map(Number)
        const endDate = new Date(Date.UTC(ay!, am! - 1, ad! + 13))
        const endLabel = `${endDate.getUTCDate()} ${MONTHS[endDate.getUTCMonth()]}`
        const incomplete = a.incomplete === true || b.incomplete === true
        const range = `${a.weekLabel} – ${endLabel}`
        return {
            weekStart: a.weekStart,
            weekLabel: incomplete ? `${range} (partial)` : range,
            counts,
            leadIds,
            incomplete,
            partialStart: a.partialStart === true,
        }
    })
}

/** Renders a fortnight's two week-ranges stacked on two lines under one x-axis tick — a
 *  single joined line ("6–12 Jul & 13–19 Jul") ran out of room and overlapped the next tick,
 *  so each week gets its own row instead. Indexed by category position, mirroring
 *  makeTotalLabel's pattern of closing over a precomputed array. */
function makeGroupTick(rows: Array<{ top: string; bottom: string }>) {
    return (props: { x?: number; y?: number; index?: number }) => {
        const { x, y, index } = props
        if (x == null || y == null || index == null) return <></>
        const row = rows[index]
        if (!row) return <></>
        return (
            <text x={x} y={y + 9} textAnchor="middle" fontSize={9} fill="#9a948a" fontFamily="'IBM Plex Mono', monospace">
                <tspan x={x} dy={0}>
                    {row.top}
                </tspan>
                <tspan x={x} dy={11}>
                    {row.bottom}
                </tspan>
            </text>
        )
    }
}

/** One tooltip entry per series, grouped by week (one group normally, two in paired mode —
 *  each keeps its OWN total as the percentage base, never a combined fortnight total). Reads
 *  the `w{n}_` dataKey prefix paired mode adds; falls back to a single ungrouped group when
 *  it's absent.
 *
 *  Always shows the REAL count and its share, never whatever's currently on the y-axis: in
 *  percent-toggle mode the rendered bar value is already a 0-100 share, so a `raw_<series>` (or
 *  `w{n}_raw_<series>`) field carrying the true count rides along in the row and is preferred
 *  over `entry.value` whenever present. */
function ShareTooltip({ payload }: Pick<RechartsTooltipProps, 'payload'>) {
    if (!payload?.length) return null
    const groups = new Map<string, { label: string; items: Array<{ name: string; value: number; color: string }> }>()
    for (const entry of payload) {
        const dk = String(entry.dataKey ?? '')
        const m = /^w(\d)_(.+)$/.exec(dk)
        const groupKey = m ? m[1]! : '0'
        const seriesName = m ? m[2]! : (entry.name ?? dk)
        const row = entry.payload ?? {}
        const label = (m ? row[`w${groupKey}_label`] : row.range) as string | undefined
        const rawKey = m ? `w${groupKey}_raw_${seriesName}` : `raw_${seriesName}`
        const rawValue = typeof row[rawKey] === 'number' ? (row[rawKey] as number) : (entry.value ?? 0)
        const g = groups.get(groupKey) ?? { label: label ?? '', items: [] }
        g.items.push({ name: seriesName, value: rawValue, color: entry.color ?? '#3a3630' })
        groups.set(groupKey, g)
    }
    return (
        <div
            style={{
                background: '#fbf9f4',
                border: '1px solid #e9e4db',
                borderRadius: 8,
                fontSize: 12,
                fontFamily: "'IBM Plex Mono', monospace",
                padding: '8px 10px',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
            }}>
            {[...groups.entries()]
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([groupKey, g]) => {
                    const total = g.items.reduce((s, it) => s + it.value, 0)
                    return (
                        <div key={groupKey}>
                            {g.label && <div style={{ fontWeight: 700, marginBottom: 2, color: '#3a3630' }}>{g.label}</div>}
                            {g.items.map((it) => (
                                <div key={it.name} style={{ display: 'flex', justifyContent: 'space-between', gap: 14, color: it.color }}>
                                    <span>{it.name}</span>
                                    <span>
                                        {it.value} ({total > 0 ? ((it.value / total) * 100).toFixed(1) : '0.0'}%)
                                    </span>
                                </div>
                            ))}
                        </div>
                    )
                })}
        </div>
    )
}

/** "+12.3%" / "−8.0%" / "new" (previous week had 0 but this one doesn't) / '' (no previous
 *  week to compare, or previous week was also 0). Colour carries the direction. */
function DeltaSpan({ curr, prev }: { curr: number; prev: number | undefined }) {
    if (prev === undefined) return null
    if (prev === 0) return curr > 0 ? <span style={{ color: '#9a948a' }}> (new)</span> : null
    const pct = ((curr - prev) / prev) * 100
    const color = pct > 0 ? '#3a7d5d' : pct < 0 ? '#c7533e' : '#9a948a'
    const sign = pct > 0 ? '+' : ''
    return (
        <span style={{ color }}>
            {' '}
            ({sign}
            {pct.toFixed(1)}%)
        </span>
    )
}

/** Micromarket Analysis' tooltip: for the hovered week, groups the present micromarkets by
 *  their cluster (via `clusterOf`), showing a bold cluster subtotal (with its own WoW % change)
 *  above its micromarkets (each with their own count and WoW % change vs the SAME series in the
 *  previous week's data point). Replaces ShareTooltip entirely when `clusterOf` is given — the
 *  two tooltips answer different questions and were never meant to combine. */
function ClusterDeltaTooltip({
    payload,
    data,
    weekIndexByStart,
    clusterOf,
}: Pick<RechartsTooltipProps, 'payload'> & {
    data: WeekSeriesPoint[]
    weekIndexByStart: Map<string, number>
    clusterOf: (key: string) => string
}) {
    if (!payload?.length) return null
    const groups = new Map<
        string,
        { label: string; weekStart?: string; items: Array<{ name: string; raw: number; color: string }> }
    >()
    for (const entry of payload) {
        const dk = String(entry.dataKey ?? '')
        const m = /^w(\d)_(.+)$/.exec(dk)
        const groupKey = m ? m[1]! : '0'
        const seriesName = m ? m[2]! : (entry.name ?? dk)
        const row = entry.payload ?? {}
        const label = (m ? row[`w${groupKey}_label`] : row.range) as string | undefined
        const weekStart = (m ? row[`w${groupKey}_weekStart`] : row.weekStart) as string | undefined
        const rawKey = m ? `w${groupKey}_raw_${seriesName}` : `raw_${seriesName}`
        const rawValue = typeof row[rawKey] === 'number' ? (row[rawKey] as number) : (entry.value ?? 0)
        const g = groups.get(groupKey) ?? { label: label ?? '', weekStart, items: [] }
        g.items.push({ name: seriesName, raw: rawValue, color: entry.color ?? '#3a3630' })
        groups.set(groupKey, g)
    }
    return (
        <div
            style={{
                background: '#fbf9f4',
                border: '1px solid #e9e4db',
                borderRadius: 8,
                fontSize: 12,
                fontFamily: "'IBM Plex Mono', monospace",
                padding: '8px 10px',
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
            }}>
            {[...groups.entries()]
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([groupKey, g]) => {
                    const idx = g.weekStart ? weekIndexByStart.get(g.weekStart) : undefined
                    const prevPoint = idx !== undefined && idx > 0 ? data[idx - 1] : undefined
                    const byCluster = new Map<string, Array<{ name: string; raw: number; color: string }>>()
                    for (const it of g.items) {
                        const cluster = clusterOf(it.name)
                        const arr = byCluster.get(cluster) ?? []
                        arr.push(it)
                        byCluster.set(cluster, arr)
                    }
                    return (
                        <div key={groupKey} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {g.label && <div style={{ fontWeight: 700, color: '#3a3630' }}>{g.label}</div>}
                            {[...byCluster.entries()].map(([cluster, items]) => {
                                const clusterTotal = items.reduce((s, it) => s + it.raw, 0)
                                const prevClusterTotal = prevPoint
                                    ? items.reduce((s, it) => s + (prevPoint.counts[it.name] ?? 0), 0)
                                    : undefined
                                return (
                                    <div key={cluster}>
                                        <div
                                            style={{
                                                display: 'flex',
                                                justifyContent: 'space-between',
                                                gap: 14,
                                                fontWeight: 700,
                                                color: '#3a3630',
                                            }}>
                                            <span>{cluster}</span>
                                            <span>
                                                {clusterTotal}
                                                <DeltaSpan curr={clusterTotal} prev={prevClusterTotal} />
                                            </span>
                                        </div>
                                        {items.map((it) => {
                                            const prevRaw = prevPoint ? (prevPoint.counts[it.name] ?? 0) : undefined
                                            return (
                                                <div
                                                    key={it.name}
                                                    style={{
                                                        display: 'flex',
                                                        justifyContent: 'space-between',
                                                        gap: 14,
                                                        paddingLeft: 12,
                                                        color: it.color,
                                                    }}>
                                                    <span>{it.name}</span>
                                                    <span>
                                                        {it.raw}
                                                        <DeltaSpan curr={it.raw} prev={prevRaw} />
                                                    </span>
                                                </div>
                                            )
                                        })}
                                    </div>
                                )
                            })}
                        </div>
                    )
                })}
        </div>
    )
}

export default function WoWStackedBar({
    data: rawData,
    onSegmentClick,
    seriesOrder,
    colorFor = buyerColorFor,
    pairWeeks = false,
    pairFromFirstFullWeek = false,
    showSharePercent = false,
    allowPercentToggle = false,
    allowBiWeeklyToggle = false,
    allowStatusFilter = false,
    clusterOf,
}: Props) {
    const [mode, setMode] = useState<StackMode>('count')
    const [granularity, setGranularity] = useState<Granularity>('weekly')
    const [hiddenKeys, setHiddenKeys] = useState<Set<string>>(new Set())
    const percent = allowPercentToggle && mode === 'percent'
    const biWeekly = allowBiWeeklyToggle && granularity === 'biweekly'
    // Merging happens BEFORE anything below reads `data` — every downstream computation (series
    // keys present, tooltips, both the paired and unpaired render branches) then automatically
    // operates on the merged series with no further changes needed anywhere else in the file.
    const data = biWeekly ? mergeAdjacentWeeks(rawData, pairFromFirstFullWeek) : rawData

    const present = [...new Set(data.flatMap((p) => Object.keys(p.counts)))]
    const rank = (k: string) => {
        const i = seriesOrder?.indexOf(k) ?? -1
        return i === -1 ? Number.MAX_SAFE_INTEGER : i
    }
    const seriesKeys = present.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
    // Everything below plots/sums activeKeys, never the full seriesKeys — when nothing is
    // hidden (hiddenKeys stays empty unless allowStatusFilter's picker is used) the two are
    // identical, so every other caller of this component is unaffected.
    const activeKeys = seriesKeys.filter((k) => !hiddenKeys.has(k))
    function totalOfVisible(p: WeekSeriesPoint): number {
        return activeKeys.reduce((s, k) => s + (p.counts[k] ?? 0), 0)
    }
    const toggleHidden = (key: string) =>
        setHiddenKeys((prev) => {
            const next = new Set(prev)
            if (next.has(key)) next.delete(key)
            else next.add(key)
            return next
        })
    const weekIndexByStart = new Map(data.map((p, i) => [p.weekStart, i]))
    const tooltipContent = clusterOf
        ? ({ active, payload }: RechartsTooltipProps) =>
              active ? (
                  <ClusterDeltaTooltip payload={payload} data={data} weekIndexByStart={weekIndexByStart} clusterOf={clusterOf} />
              ) : null
        : showSharePercent
          ? ({ active, payload }: RechartsTooltipProps) => (active ? <ShareTooltip payload={payload} /> : null)
          : undefined

    const axisTick = { fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, fill: '#9a948a' }
    // One hatch pattern per colour actually in use on this chart, not the whole palette.
    const hatchColors = [...new Set(activeKeys.map((k) => colorFor(k)))]
    const statusFilter = allowStatusFilter ? (
        <StatusFilterDropdown keys={seriesKeys} hidden={hiddenKeys} onToggle={toggleHidden} onSetHidden={setHiddenKeys} />
    ) : null
    const toggleRow =
        statusFilter || allowPercentToggle || allowBiWeeklyToggle ? (
            <div style={{ display: 'flex', justifyContent: statusFilter ? 'space-between' : 'flex-end', gap: 8, marginBottom: 6 }}>
                {statusFilter}
                {(allowBiWeeklyToggle || allowPercentToggle) && (
                    <div style={{ display: 'flex', gap: 8 }}>
                        {allowBiWeeklyToggle && <ToggleGroup options={GRANULARITY_OPTIONS} value={granularity} onChange={setGranularity} />}
                        {allowPercentToggle && <ToggleGroup options={STACK_MODE_OPTIONS} value={mode} onChange={setMode} />}
                    </div>
                )}
            </div>
        ) : null
    // Percent view re-scales every series to its own week's share; the raw count still rides
    // along under raw_<key> (ShareTooltip and the totals label read that, never the rescaled
    // value) so switching views never changes what a hover or the grand-total label reports.
    function seriesValue(raw: number, total: number): number {
        return percent && total > 0 ? (raw / total) * 100 : raw
    }
    const yAxisProps = percent
        ? { domain: [0, 100] as [number, number], tickFormatter: (v: number) => `${Math.round(v)}%` }
        : { allowDecimals: false }

    // The axis gutter has to fit the widest tick it will actually draw. At a fixed 32px a
    // five-digit tick loses its leading digit — 12000 renders as "2000", which does not look
    // broken, it looks like a smaller number. Derived from the tallest bar so charts with small
    // counts keep the tight gutter they have always had.
    const tallestBar = Math.max(0, ...data.map(totalOfVisible))
    const yAxisWidth = percent ? 32 : Math.max(32, 10 + String(Math.round(tallestBar)).length * 7)

    // Bi-weekly always renders one bar per (already-merged) point via this branch, regardless of
    // `pairWeeks` — see allowBiWeeklyToggle's doc comment for why the two don't compose.
    if (!pairWeeks || biWeekly) {
        const chartData = data.map((p) => {
            const total = totalOfVisible(p)
            const row: Record<string, unknown> = {
                weekLabel: p.weekLabel,
                weekStart: p.weekStart,
                // biWeekly's merged points already carry a ready-to-use range in weekLabel —
                // weekRangeLabel/weekEndLabel hardcode a 7-day span and would mislabel them.
                range: biWeekly ? p.weekLabel : weekRangeLabel(p),
                incomplete: p.incomplete === true,
            }
            for (const k of seriesKeys) {
                const raw = p.counts[k] ?? 0
                row[k] = seriesValue(raw, total)
                row[`raw_${k}`] = raw
            }
            return row
        })
        const totals = data.map(totalOfVisible)
        return (
            <div style={CHART_WRAP}>
                {toggleRow}
                <PartialHatchDefs colors={hatchColors} />
                <div style={CHART_AREA}>
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} margin={{ top: 18, right: 4, bottom: 4, left: 0 }} barSize={22}>
                    <CartesianGrid vertical={false} stroke="#efe9e0" strokeDasharray="0" />
                    <XAxis dataKey="range" tick={axisTick} axisLine={false} tickLine={false} />
                    <YAxis width={yAxisWidth} tick={axisTick} axisLine={false} tickLine={false} {...yAxisProps} />
                    <Tooltip
                        content={tooltipContent}
                        contentStyle={{
                            background: '#fbf9f4',
                            border: '1px solid #e9e4db',
                            borderRadius: 8,
                            fontSize: 12,
                            fontFamily: "'IBM Plex Mono', monospace",
                        }}
                        cursor={{ fill: 'rgba(0,0,0,0.04)' }}
                    />
                    <Legend wrapperStyle={LEGEND_STYLE} formatter={legendFormatter} />
                    {activeKeys.map((key, i) => (
                        <Bar
                            key={key}
                            dataKey={key}
                            stackId="a"
                            fill={colorFor(key)}
                            name={key}
                            cursor="pointer"
                            label={makeBarLabel(percent, i === activeKeys.length - 1, totals, (ri) => chartData[ri]?.[key] as number | undefined)}
                            onClick={(_, index) => {
                                const point = data[index as number]
                                if (point) onSegmentClick(point, key)
                            }}>
                            {data.map((p, ri) => (
                                <Cell key={ri} fill={fillFor(colorFor(key), p.incomplete === true)} />
                            ))}
                        </Bar>
                    ))}
                </BarChart>
                </ResponsiveContainer>
                </div>
            </div>
        )
    }

    // Paired mode: group adjacent weeks into fortnights. Each group becomes one x-axis
    // category with TWO side-by-side stacked clusters (stackId "w0"/"w1") — the standard
    // recharts pattern for grouped-and-stacked bars. onSegmentClick still resolves to the
    // original WeekSeriesPoint for whichever week's bar was clicked.
    const groups = weekGroups(data, pairFromFirstFullWeek)

    const chartData = groups.map((pair) => {
        const row: Record<string, unknown> = {
            groupLabel:
                pair.length === 2
                    ? `${weekRangeLabel(pair[0]!)} & ${weekRangeLabel(pair[1]!)}`
                    : weekRangeLabel(pair[0]!),
        }
        pair.forEach((p, wi) => {
            row[`w${wi}_label`] = weekRangeLabel(p)
            row[`w${wi}_incomplete`] = p.incomplete === true
            row[`w${wi}_weekStart`] = p.weekStart
            const total = totalOfVisible(p)
            for (const k of seriesKeys) {
                const raw = p.counts[k] ?? 0
                row[`w${wi}_${k}`] = seriesValue(raw, total)
                row[`w${wi}_raw_${k}`] = raw
            }
        })
        return row
    })

    const groupTotals: Record<number, number[]> = {
        0: groups.map((pair) => (pair[0] ? totalOfVisible(pair[0]!) : 0)),
        1: groups.map((pair) => (pair[1] ? totalOfVisible(pair[1]!) : 0)),
    }
    const groupTickRows = groups.map((pair) => ({
        top: weekRangeLabel(pair[0]!),
        bottom: pair[1] ? weekRangeLabel(pair[1]!) : '',
    }))

    return (
        <div style={CHART_WRAP}>
            {toggleRow}
            <PartialHatchDefs colors={hatchColors} />
            <div style={CHART_AREA}>
            <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 18, right: 4, bottom: 4, left: 0 }} barSize={16} barGap={2} barCategoryGap="30%">
                <CartesianGrid vertical={false} stroke="#efe9e0" strokeDasharray="0" />
                <XAxis
                    dataKey="groupLabel"
                    tick={makeGroupTick(groupTickRows)}
                    height={32}
                    interval={0}
                    axisLine={false}
                    tickLine={false}
                />
                <YAxis width={yAxisWidth} tick={axisTick} axisLine={false} tickLine={false} {...yAxisProps} />
                <Tooltip
                    content={tooltipContent}
                    contentStyle={{
                        background: '#fbf9f4',
                        border: '1px solid #e9e4db',
                        borderRadius: 8,
                        fontSize: 12,
                        fontFamily: "'IBM Plex Mono', monospace",
                    }}
                    cursor={{ fill: 'rgba(0,0,0,0.04)' }}
                />
                <Legend wrapperStyle={LEGEND_STYLE} formatter={legendFormatter} />
                {[0, 1].flatMap((wi) =>
                    activeKeys.map((key, i) => (
                        <Bar
                            key={`w${wi}_${key}`}
                            dataKey={`w${wi}_${key}`}
                            stackId={`w${wi}`}
                            fill={colorFor(key)}
                            name={key}
                            legendType={wi === 0 ? 'square' : 'none'}
                            cursor="pointer"
                            label={makeBarLabel(
                                percent,
                                i === activeKeys.length - 1,
                                groupTotals[wi]!,
                                (ri) => chartData[ri]?.[`w${wi}_${key}`] as number | undefined
                            )}
                            onClick={(_, index) => {
                                const point = groups[index as number]?.[wi]
                                if (point) onSegmentClick(point, key)
                            }}>
                            {groups.map((pair, ri) => (
                                <Cell key={ri} fill={fillFor(colorFor(key), pair[wi]?.incomplete === true)} />
                            ))}
                        </Bar>
                    ))
                )}
                </BarChart>
            </ResponsiveContainer>
            </div>
        </div>
    )
}
