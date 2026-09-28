'use client'

import type { TwoWeekRow } from '@/lib/buyer/types'

function inr(n: number): string {
    return '₹' + Math.round(n).toLocaleString('en-IN')
}
function inrShort(n: number): string {
    if (n >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`
    if (n >= 1e5) return `₹${(n / 1e5).toFixed(2)} L`
    return inr(n)
}

/** `pctDecimals` lets one metric row (currently just "% Spends of GMV", at 2 decimal places)
 *  show decimal precision instead of the whole-number rounding every other percentage row
 *  uses — GMV vastly exceeds Spend in this business, so a whole-number round always reads "0%"
 *  even though the real value is a genuine, non-zero fraction of a percent. */
function fmt(value: number | null, unit: TwoWeekRow['unit'], pctDecimals = 0): string {
    if (value == null) return '—'
    switch (unit) {
        case '%':
            return `${value.toFixed(pctDecimals)}%`
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
function fmtLag(value: number | null, unit: TwoWeekRow['unit'], pctDecimals = 0): string {
    if (value == null) return '—'
    const behind = value > 0
    const shown = fmt(Math.abs(value), unit, pctDecimals)
    return behind ? `−${shown}` : `+${shown}`
}

function lagColor(lag: number | null): string {
    if (lag == null) return '#9a948a'
    return lag > 0 ? '#c7533e' : '#3a7d5d'
}
// Same sign convention as lagColor (positive lag = behind = red), but a dark neutral
// fallback rather than muted gray — this is the bold "achieved" figure, not a caption.
function achievedColor(lag: number | null): string {
    if (lag == null) return '#3a3630'
    return lag > 0 ? '#c7533e' : '#3a7d5d'
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
const stickyTh: React.CSSProperties = { position: 'sticky', top: STICKY_TOP, zIndex: 10, background: '#fbf9f4' }

// Highlights just the "Last 2wk Target"/"Last 2wk Achieved" columns — explicitly NOT the Lag
// column next to them, per the growth team's own ask (the diff should stay plain, unhighlighted).
const HIGHLIGHT_BG = '#f4efe0'

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

/** A right-aligned number input standing in for the plain "Next 2wk Target" text — same column,
 *  same position, just typable. Empty clears the override (falls back to the computed default
 *  next render). */
function EditableTargetCell({
    value,
    onChange,
}: {
    value: number | null
    onChange: (value: number | null) => void
}) {
    return (
        <input
            type="number"
            value={value ?? ''}
            onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
            style={{
                width: '100%',
                boxSizing: 'border-box',
                textAlign: 'right',
                fontVariantNumeric: 'tabular-nums',
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 12.5,
                color: '#3a3630',
                background: '#fff',
                border: '1px solid #e9e4db',
                borderRadius: 4,
                padding: '3px 6px',
            }}
        />
    )
}

export default function TwoWeekTable({
    data,
    primaryMetrics = PRIMARY,
    editableNextW2Target = false,
    nextW2TargetOverrides,
    onNextW2TargetChange,
    showProRataNextTarget = false,
}: {
    data: TwoWeekRow[]
    /** Which metric names render bold/flush-left (the rest render indented/muted). Defaults to
     *  the Buyer set; Seller passes its own since the two tables' metric names don't overlap. */
    primaryMetrics?: Set<string>
    /** Turns the Next 2wk Target column into a typable number input per row, keyed by
     *  row.metric — the growth team's own projection, overriding the computed flat-rate default.
     *  Seller-only opt-in; Buyer's own table renders the column exactly as before (plain,
     *  computed text) when this is left false. */
    editableNextW2Target?: boolean
    /** Keyed by row.metric, but the caller decides what that key MEANS — Seller sometimes keys
     *  it to one specific channel/micromarket's own saved number (when `editableNextW2Target`),
     *  sometimes to a computed sum or `null` for the current Channel/Cluster-MM filter scope
     *  (when not editable, read in the plain-text branch too) — see SellerTab.tsx's
     *  resolveNextTargetScope. `undefined` (key absent) always falls back to the computed
     *  `row.nextW2Target`; `null` is a real, deliberate blank. */
    nextW2TargetOverrides?: Record<string, number | null>
    onNextW2TargetChange?: (metric: string, value: number | null) => void
    /** Adds a read-only "Next 2wk Target (Pro-rata)" column after Next 2wk Target, showing
     *  row.nextW2TargetProRata — a deficit-based catch-up figure, purely informational and
     *  never editable. Seller-only opt-in; Buyer doesn't pass this so its table is unchanged. */
    showProRataNextTarget?: boolean
}) {
    return (
        <div style={{ fontSize: 12.5 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                    <tr
                        style={{
                            color: '#9a948a',
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
                        <th style={{ ...th, ...stickyTh, padding: showProRataNextTarget ? '4px 8px 8px' : '4px 0 8px 8px' }}>
                            Next 2wk Target
                        </th>
                        {showProRataNextTarget && (
                            <th style={{ ...th, ...stickyTh, padding: '4px 0 8px 8px' }}>Next 2wk Target (Pro-rata)</th>
                        )}
                    </tr>
                </thead>
                <tbody>
                    {data.map((row) => {
                        const primary = primaryMetrics.has(row.metric)
                        const pctDecimals = row.metric === '% Spends of GMV' ? 2 : 0
                        return (
                        <tr key={row.metric} style={{ borderTop: `1px solid ${primary ? '#e4ded4' : '#f4efe7'}` }}>
                            <td
                                style={{
                                    padding: `6px 8px 6px ${primary ? 0 : 18}px`,
                                    fontWeight: primary ? 600 : 400,
                                    color: primary ? '#3a3630' : '#9a948a',
                                }}>
                                {row.metric}
                            </td>
                            <td style={{ ...td, color: '#9a948a' }}>{fmt(row.qTarget, row.unit, pctDecimals)}</td>
                            <td style={{ ...td, fontWeight: 600, color: achievedColor(row.qLag) }}>
                                {fmt(row.qAchieved, row.unit, pctDecimals)}
                            </td>
                            <td style={{ ...td, fontWeight: 600, color: lagColor(row.qLag) }}>{fmtLag(row.qLag, row.unit, pctDecimals)}</td>
                            <td style={{ ...td, color: '#9a948a' }}>{fmt(row.qTargetFull ?? null, row.unit, pctDecimals)}</td>
                            <td style={{ ...td, color: '#9a948a' }}>{fmt(row.qPctCompleted ?? null, '%', pctDecimals)}</td>
                            <td style={{ ...td, color: '#9a948a', background: HIGHLIGHT_BG }}>{fmt(row.w2Target, row.unit, pctDecimals)}</td>
                            <td style={{ ...td, fontWeight: 600, color: achievedColor(row.w2Lag), background: HIGHLIGHT_BG }}>
                                {fmt(row.w2Achieved, row.unit, pctDecimals)}
                            </td>
                            <td style={{ ...td, fontWeight: 600, color: lagColor(row.w2Lag) }}>{fmtLag(row.w2Lag, row.unit, pctDecimals)}</td>
                            <td
                                style={{
                                    ...td,
                                    padding: showProRataNextTarget ? '6px 8px' : '6px 0 6px 8px',
                                    color: '#9a948a',
                                }}>
                                {editableNextW2Target ? (
                                    <EditableTargetCell
                                        value={(() => {
                                            const override = nextW2TargetOverrides?.[row.metric]
                                            if (override !== undefined) return override
                                            return row.nextW2Target != null ? Math.round(row.nextW2Target) : null
                                        })()}
                                        onChange={(value) => onNextW2TargetChange?.(row.metric, value)}
                                    />
                                ) : (
                                    // Even in read-only mode, an override map (if supplied) wins over the
                                    // computed default — Seller uses this to show a computed sum (or a
                                    // blank) for the current Channel/Cluster-MM scope, not the flat
                                    // pro-rata default. Buyer never passes this map, so this is a no-op
                                    // for it: undefined falls straight through to today's behavior.
                                    fmt(
                                        (() => {
                                            const override = nextW2TargetOverrides?.[row.metric]
                                            return override !== undefined ? override : row.nextW2Target
                                        })(),
                                        row.unit,
                                        pctDecimals
                                    )
                                )}
                            </td>
                            {showProRataNextTarget && (
                                <td style={{ ...td, padding: '6px 0 6px 8px', color: '#9a948a' }}>
                                    {fmt(row.nextW2TargetProRata ?? null, row.unit, pctDecimals)}
                                </td>
                            )}
                        </tr>
                        )
                    })}
                </tbody>
            </table>
        </div>
    )
}
