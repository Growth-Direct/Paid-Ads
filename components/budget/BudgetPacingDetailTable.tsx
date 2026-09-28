'use client'

import type { BudgetPacingDetailRow } from '@/lib/buyer/budgetPacing'

function inr(n: number): string {
    return '₹' + Math.round(n).toLocaleString('en-IN')
}
function inrShort(n: number): string {
    const abs = Math.abs(n)
    if (abs >= 1e7) return `${n < 0 ? '−' : ''}₹${(abs / 1e7).toFixed(2)} Cr`
    if (abs >= 1e5) return `${n < 0 ? '−' : ''}₹${(abs / 1e5).toFixed(2)} L`
    return n < 0 ? `−${inr(abs)}` : inr(abs)
}
function fmtCurrency(n: number | null): string {
    return n == null ? '—' : inrShort(n)
}
function fmtPct(n: number | null): string {
    return n == null ? '—' : `${n}%`
}
function fmtDays(n: number | null): string {
    return n == null ? '—' : `${n.toFixed(1)}d`
}

/** Lag is pre-signed (positive = under plan, negative = over) — shortfall as a plain
 *  positive number, surplus with a plus sign. Mirrors TwoWeekTable's own fmtLag. */
function fmtLag(n: number | null): string {
    if (n == null) return '—'
    const behind = n > 0
    const shown = inrShort(Math.abs(n))
    return behind ? `−${shown}` : `+${shown}`
}
function lagPillStyle(n: number | null): React.CSSProperties {
    if (n == null) return { background: '#F5F5F5', color: '#333333' }
    return n > 0 ? { background: '#FEE2E2', color: '#DC2626' } : { background: '#DCFCE7', color: '#16A34A' }
}
function LagPill({ value }: { value: number | null }) {
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
            {fmtLag(value)}
        </span>
    )
}

const th: React.CSSProperties = { textAlign: 'right', padding: '4px 8px 8px' }
const td: React.CSSProperties = { padding: '6px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }

const KIND_BG: Record<BudgetPacingDetailRow['kind'], string> = {
    leaf: 'transparent',
    subtotal: '#F5F5F5',
    grandTotal: '#E6F0FF',
}

/** Renders the growth team's own requested Budget Pacing column set (2026-09-26): Quarter
 *  Budget, Should-have-spent QTD, Spent till Yesterday, Lag, % of Budget Spent, Budget Left,
 *  Daily Expected (to finish), Daily Actual Yesterday, Daily Actual 7d avg, Runway. Every
 *  figure comes straight off BudgetPacingDetailRow — this component only formats. */
export default function BudgetPacingDetailTable({
    data,
    rowLabelHeader,
}: {
    data: BudgetPacingDetailRow[]
    rowLabelHeader: string
}) {
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
                        <th style={{ textAlign: 'left', padding: '4px 8px 8px 0' }}>{rowLabelHeader}</th>
                        <th style={th}>Quarter Budget</th>
                        <th style={th}>Should-Have Spent QTD</th>
                        <th style={th}>Spent Till Yesterday</th>
                        <th style={th}>Lag (Plan − Actual)</th>
                        <th style={th}>% of Budget Spent</th>
                        <th style={th}>Budget Left</th>
                        <th style={th}>Daily Expected (to Finish)</th>
                        <th style={th}>Daily Actual Yesterday</th>
                        <th style={th}>Daily Actual — 7d Avg</th>
                        <th style={{ ...th, padding: '4px 0 8px 8px' }}>Runway (Days at 7d Pace)</th>
                    </tr>
                </thead>
                <tbody>
                    {data.map((row) => {
                        const bold = row.kind !== 'leaf'
                        return (
                            <tr
                                key={row.label}
                                style={{
                                    borderTop: `1px solid ${row.kind === 'grandTotal' ? '#0067FF' : '#CCCCCC'}`,
                                    background: KIND_BG[row.kind],
                                }}>
                                <td
                                    style={{
                                        padding: `6px 8px 6px ${bold ? 0 : 18}px`,
                                        fontWeight: bold ? 700 : 400,
                                        color: '#000000',
                                    }}>
                                    {row.label}
                                </td>
                                <td style={{ ...td, color: '#333333' }}>{fmtCurrency(row.quarterBudget)}</td>
                                <td style={{ ...td, color: '#333333' }}>{fmtCurrency(row.shouldHaveSpentQtd)}</td>
                                <td style={{ ...td, fontWeight: bold ? 700 : 600, color: '#000000' }}>
                                    {fmtCurrency(row.spentTillYesterday)}
                                </td>
                                <td style={{ ...td, fontWeight: 600 }}>
                                    <LagPill value={row.lag} />
                                </td>
                                <td style={{ ...td, color: '#333333' }}>{fmtPct(row.pctOfBudgetSpent)}</td>
                                <td style={{ ...td, color: '#333333' }}>{fmtCurrency(row.budgetLeft)}</td>
                                <td style={{ ...td, color: '#333333' }}>{fmtCurrency(row.dailyExpectedToFinish)}</td>
                                <td style={{ ...td, color: '#333333' }}>{fmtCurrency(row.dailyActualYesterday)}</td>
                                <td style={{ ...td, color: '#333333' }}>{fmtCurrency(row.dailyActual7dAvg)}</td>
                                <td style={{ ...td, padding: '6px 0 6px 8px', color: '#333333' }}>{fmtDays(row.runwayDays)}</td>
                            </tr>
                        )
                    })}
                </tbody>
            </table>
        </div>
    )
}
