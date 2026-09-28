'use client'

import type { TwoWeekRow } from '@/lib/buyer/types'
import { Fragment, useState } from 'react'

function inr(n: number): string {
    return '₹' + Math.round(n).toLocaleString('en-IN')
}
function inrShort(n: number): string {
    if (n >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`
    if (n >= 1e5) return `₹${(n / 1e5).toFixed(2)} L`
    return inr(n)
}

function fmt(value: number | null, unit: TwoWeekRow['unit']): string {
    if (value == null) return '—'
    switch (unit) {
        case '%':
            return `${Math.round(value)}%`
        case 'currency':
            return inrShort(value)
        case 'x':
            return `${value.toFixed(2)}x`
        default:
            return Math.round(value).toLocaleString()
    }
}

/** Lag is pre-signed (positive = behind, negative = ahead) — show the shortfall as a
 *  plain positive number with a red minus, the surplus as a green plus. */
function fmtLag(value: number | null, unit: TwoWeekRow['unit']): string {
    if (value == null) return '—'
    const behind = value > 0
    const shown = fmt(Math.abs(value), unit)
    return behind ? `−${shown}` : `+${shown}`
}

// Same sign convention used throughout this table (positive lag = behind = red) — this is
// the dark-neutral fallback for the bold "achieved" figure, not a caption.
function achievedColor(lag: number | null): string {
    if (lag == null) return '#000000'
    return lag > 0 ? '#DC2626' : '#16A34A'
}

// A filled pill instead of plain colored text for the Lag cells — per the growth team's own
// ask, plain text color was too easy to miss scanning a long table. Same red=behind/
// green=ahead/gray=no-target convention as achievedColor above, just with a background fill
// so the behind/ahead read jumps out without reading the number itself.
function lagPillStyle(lag: number | null): React.CSSProperties {
    if (lag == null) return { background: '#F5F5F5', color: '#333333' }
    return lag > 0 ? { background: '#FEE2E2', color: '#DC2626' } : { background: '#DCFCE7', color: '#16A34A' }
}
function LagPill({ value, unit }: { value: number | null; unit: TwoWeekRow['unit'] }) {
    return (
        <span
            style={{
                display: 'inline-block',
                padding: '2px 8px',
                borderRadius: 999,
                fontWeight: 600,
                fontVariantNumeric: 'tabular-nums',
                ...lagPillStyle(value),
            }}>
            {fmtLag(value, unit)}
        </span>
    )
}

const th: React.CSSProperties = { textAlign: 'right', padding: '4px 8px 8px' }
const td: React.CSSProperties = { padding: '6px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }

// Freezes the header row while the page scrolls past a tall table. The nav bar
// (components/shared/Nav.tsx) is itself `position: sticky; top: 0; zIndex: 50` at ~61px tall
// (16px+16px padding around a 28px logo, +1px border) — this sticks just below it, well under
// its z-index, with an opaque background so body rows don't show through as they scroll
// underneath. There's no inner scroll container on this table (ChartCard has no
// overflow/maxHeight), so this is page-scroll stickiness, not a boxed scrolling table — sticky is
// set on each <th> individually rather than on <thead>/<tr>, the more reliable cross-browser
// pattern for sticky table headers.
const STICKY_TOP = 61
const stickyTh: React.CSSProperties = { position: 'sticky', top: STICKY_TOP, zIndex: 10, background: '#FFFFFF' }

// Highlights just the "Last 2wk Target"/"Last 2wk Achieved" columns — explicitly NOT the Lag
// column next to them, per the growth team's own ask (the diff should stay plain, unhighlighted).
const HIGHLIGHT_BG = '#E6F0FF'

// Scheme 2 hierarchy: the headline volumes read as parents (bold, flush-left, a firmer
// rule above them); the ratios and cost-per metrics that derive from them, and the
// Old/New breakdowns, read as children (indented, muted). No row colour — the weight and
// indent alone give the table a parent → child rhythm you can scan in one pass.
const PRIMARY = new Set([
    'Spend',
    'Total Leads (LSH)',
    'Total Unique Leads',
    'Qualified Leads',
    'Total Unique Visits',
    'Total Overall Visits',
    'Total Conversions',
])

export interface MetricGroup {
    label: string
    metrics: string[]
}

const GROUP_HEADER_BG = '#F5F5F5'

export default function TwoWeekTable({
    data,
    primaryMetrics = PRIMARY,
    groups,
}: {
    data: TwoWeekRow[]
    /** Which metric names render bold/flush-left (the rest render indented/muted). Defaults to
     *  the Buyer set; Seller passes its own since the two tables' metric names don't overlap. */
    primaryMetrics?: Set<string>
    /** Added 2026-09-26, per the growth team's own "hard to scan, needs grouping" feedback.
     *  Splits the flat metric list into collapsible sections (default expanded) instead of
     *  one long wall of rows — presentation only, no data change. Omitted (Budget Pacing's
     *  own use of this table) renders exactly as before, one flat list. Any row in `data`
     *  whose metric isn't named in any group still renders, under a trailing "Other" section,
     *  so a group list that falls out of sync with the metric set never silently drops a row. */
    groups?: MetricGroup[]
}) {
    const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
    const toggle = (label: string) =>
        setCollapsed((prev) => {
            const next = new Set(prev)
            if (next.has(label)) next.delete(label)
            else next.add(label)
            return next
        })

    function renderRow(row: TwoWeekRow) {
        const primary = primaryMetrics.has(row.metric)
        return (
            <tr key={row.metric} style={{ borderTop: `1px solid ${primary ? '#CCCCCC' : '#F5F5F5'}` }}>
                <td
                    style={{
                        padding: `6px 8px 6px ${primary ? 0 : 18}px`,
                        fontWeight: primary ? 600 : 400,
                        color: primary ? '#000000' : '#333333',
                    }}>
                    {row.metric}
                </td>
                <td style={{ ...td, color: '#333333' }}>{fmt(row.qTarget, row.unit)}</td>
                <td style={{ ...td, fontWeight: 600, color: achievedColor(row.qLag) }}>{fmt(row.qAchieved, row.unit)}</td>
                <td style={{ ...td, fontWeight: 600 }}>
                    <LagPill value={row.qLag} unit={row.unit} />
                </td>
                <td style={{ ...td, color: '#333333' }}>{fmt(row.qTargetFull ?? null, row.unit)}</td>
                <td style={{ ...td, color: '#333333' }}>{fmt(row.qPctCompleted ?? null, '%')}</td>
                <td style={{ ...td, color: '#333333', background: HIGHLIGHT_BG }}>{fmt(row.w2Target, row.unit)}</td>
                <td style={{ ...td, fontWeight: 600, color: achievedColor(row.w2Lag), background: HIGHLIGHT_BG }}>
                    {fmt(row.w2Achieved, row.unit)}
                </td>
                <td style={{ ...td, fontWeight: 600 }}>
                    <LagPill value={row.w2Lag} unit={row.unit} />
                </td>
                <td style={{ ...td, padding: '6px 0 6px 8px', color: '#333333' }}>{fmt(row.weeklyPaceNeeded, row.unit)}</td>
            </tr>
        )
    }

    function renderGroupHeader(label: string, count: number) {
        const isCollapsed = collapsed.has(label)
        return (
            <tr key={`group:${label}`} style={{ background: GROUP_HEADER_BG }}>
                <td colSpan={10} style={{ padding: 0 }}>
                    <button
                        onClick={() => toggle(label)}
                        style={{
                            width: '100%',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                            padding: '6px 8px',
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            fontFamily: "'IBM Plex Mono', monospace",
                            fontSize: 10.5,
                            fontWeight: 700,
                            color: '#333333',
                            textTransform: 'uppercase',
                            letterSpacing: '0.04em',
                        }}>
                        <span style={{ display: 'inline-block', width: 10 }}>{isCollapsed ? '▸' : '▾'}</span>
                        {label}
                        <span style={{ fontWeight: 400, color: '#666666' }}>({count})</span>
                    </button>
                </td>
            </tr>
        )
    }

    const rowsByMetric = new Map(data.map((r) => [r.metric, r]))
    let body: React.ReactNode
    if (groups && groups.length > 0) {
        const grouped = new Set(groups.flatMap((g) => g.metrics))
        const leftover = data.filter((r) => !grouped.has(r.metric))
        body = (
            <>
                {groups.map((g) => {
                    const rows = g.metrics.map((m) => rowsByMetric.get(m)).filter((r): r is TwoWeekRow => !!r)
                    if (rows.length === 0) return null
                    const isCollapsed = collapsed.has(g.label)
                    return (
                        <Fragment key={g.label}>
                            {renderGroupHeader(g.label, rows.length)}
                            {!isCollapsed && rows.map(renderRow)}
                        </Fragment>
                    )
                })}
                {leftover.length > 0 && (
                    <Fragment key="Other">
                        {renderGroupHeader('Other', leftover.length)}
                        {!collapsed.has('Other') && leftover.map(renderRow)}
                    </Fragment>
                )}
            </>
        )
    } else {
        body = data.map(renderRow)
    }

    return (
        <div style={{ fontSize: 12.5 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                    <tr
                        style={{
                            color: '#333333',
                            fontFamily: "'IBM Plex Mono', monospace",
                            fontSize: 10.5,
                            textTransform: 'uppercase',
                        }}>
                        <th style={{ textAlign: 'left', padding: '4px 8px 8px 0', ...stickyTh }}>Metric</th>
                        <th style={{ ...th, ...stickyTh }}>QTD Target</th>
                        <th style={{ ...th, ...stickyTh }}>QTD Achieved</th>
                        <th style={{ ...th, ...stickyTh }}>QTD Lag</th>
                        <th style={{ ...th, ...stickyTh }}>QTR Target</th>
                        <th style={{ ...th, ...stickyTh }}>% Completed</th>
                        <th style={{ ...th, ...stickyTh, background: HIGHLIGHT_BG }}>Last 2wk Target</th>
                        <th style={{ ...th, ...stickyTh, background: HIGHLIGHT_BG }}>Last 2wk Achieved</th>
                        <th style={{ ...th, ...stickyTh }}>Last 2wk Lag</th>
                        <th style={{ ...th, ...stickyTh, padding: '4px 0 8px 8px' }}>Weekly Pace Needed</th>
                    </tr>
                </thead>
                <tbody>{body}</tbody>
            </table>
        </div>
    )
}
