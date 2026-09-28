'use client'

import type { FederationProgress, SocietyWithPriority } from '@/lib/procurement/types'

// The table both grains share. They differ in what identifies a row and what the caveat column
// says, not in how a percentage is drawn, so one component takes both and the tab decides which
// rows to hand it.

export type Grain = 'federation' | 'society'

/**
 * Above this, the denominator is not believable. Co-owners genuinely push a society past 100% —
 * two or three names on one flat — but 161,700% (Raheja Residency: 1,617 procured records against
 * the single unit truiq holds) is not a procurement result, it is a missing unit list. Printing it
 * as a percentage invites someone to read a truiq data gap as an achievement.
 */
const DENOMINATOR_SUSPECT_PCT = 300

/** True when a row's units cannot support the procured count it is being divided into. */
export function denominatorSuspect(pct: number | null, unitsProcured: number): boolean {
    if (pct === null) return unitsProcured > 0
    return pct > DENOMINATOR_SUSPECT_PCT
}

/** A percentage bar. Over 100 is real — co-owners give a unit more than one procured record. */
function PctCell({ pct, unitsProcured }: { pct: number | null; unitsProcured: number }) {
    if (denominatorSuspect(pct, unitsProcured)) {
        return (
            <span
                title={
                    (pct === null
                        ? `${unitsProcured.toLocaleString()} procured owners, but truiq holds no units for this row.`
                        : `${unitsProcured.toLocaleString()} procured owners against only ${Math.round(
                              (unitsProcured / pct) * 100
                          ).toLocaleString()} units — the ratio would read ${pct.toFixed(0)}%.`) +
                    `\n\nNo percentage is shown because the denominator is missing from truiq, not because nothing ` +
                    `was procured. This is a gap in truiq's unit mapping, not a procurement result.` +
                    `\n\nThese owners are still counted in the totals above — only this row's ratio is withheld.`
                }
                style={{
                    fontSize: 11,
                    fontFamily: "'IBM Plex Mono', monospace",
                    letterSpacing: '0.06em',
                    color: '#a8553f',
                    background: '#f9eee9',
                    border: '1px solid #eed9d0',
                    borderRadius: 4,
                    padding: '2px 6px',
                    whiteSpace: 'nowrap',
                }}>
                UNITS MISSING FROM TRUIQ
            </span>
        )
    }
    if (pct === null) {
        // Not 0 and not 100: a society with no mapped units has no denominator, and drawing
        // either would be an answer to a question truiq cannot currently answer.
        return <span style={{ color: '#bdb6aa', fontSize: 12 }}>no units</span>
    }
    const clamped = Math.min(pct, 100)
    const over = pct > 100
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ flex: 1, height: 6, background: '#efeae1', borderRadius: 3, overflow: 'hidden', minWidth: 60 }}>
                <div
                    style={{
                        width: `${clamped}%`,
                        height: '100%',
                        background: over ? '#c7953e' : pct >= 80 ? '#5c8a5e' : pct >= 40 ? '#8a9a5b' : '#c0b9ab',
                    }}
                />
            </div>
            <span
                style={{
                    fontVariantNumeric: 'tabular-nums',
                    fontSize: 12,
                    fontWeight: 600,
                    color: over ? '#9c7430' : '#3a3833',
                    width: 52,
                    textAlign: 'right',
                }}>
                {pct.toFixed(1)}%
            </span>
        </div>
    )
}

const TH: React.CSSProperties = {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 10,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    color: '#9a948a',
    fontWeight: 500,
    textAlign: 'left',
    padding: '0 12px 8px',
    whiteSpace: 'nowrap',
}
const TD: React.CSSProperties = {
    padding: '10px 12px',
    fontSize: 13,
    color: '#3a3833',
    borderTop: '1px solid #efeae1',
    verticalAlign: 'middle',
}
const NUM: React.CSSProperties = { ...TD, fontVariantNumeric: 'tabular-nums', textAlign: 'right', whiteSpace: 'nowrap' }

/** TQ standings that are not a plain YES, shown so a denominator is never read as settled. */
function TqNote({
    standings,
    mixed,
    totalUnits,
    qualifyingUnits,
}: {
    standings: string[]
    mixed: boolean
    totalUnits: number
    qualifyingUnits: number
}) {
    if (!mixed) return null
    const excluded = totalUnits - qualifyingUnits
    return (
        <span
            title={
                `Some buildings here are Truva-Qualified and some are not (${standings.join(', ')}).` +
                `\n\nThe percentage divides by the ${qualifyingUnits.toLocaleString()} qualified units only — ` +
                `the other ${excluded.toLocaleString()} are left out of the denominator.` +
                `\n\nBut every procured owner in the federation still counts on top, including any living in ` +
                `those ${excluded.toLocaleString()} units. A Zoho record that names only the federation cannot be ` +
                `traced to a building, so it cannot be excluded. This row therefore reads higher than the truth.`
            }
            style={{
                marginLeft: 8,
                fontSize: 10,
                fontFamily: "'IBM Plex Mono', monospace",
                letterSpacing: '0.06em',
                color: '#9c7430',
                background: '#f7f0e0',
                border: '1px solid #e8dcc2',
                borderRadius: 4,
                padding: '1px 5px',
                whiteSpace: 'nowrap',
            }}>
            MIXED TQ
        </span>
    )
}

export function FederationTable({ rows }: { rows: FederationProgress[] }) {
    return (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
                <tr>
                    <th style={TH}>Federation</th>
                    <th style={TH}>Micromarket</th>
                    <th style={{ ...TH, textAlign: 'right' }}>Societies</th>
                    <th style={{ ...TH, textAlign: 'right' }}>Procured</th>
                    <th style={{ ...TH, textAlign: 'right' }}>TQ units</th>
                    <th style={{ ...TH, minWidth: 160 }}>Procurement</th>
                </tr>
            </thead>
            <tbody>
                {rows.map((f) => (
                    <tr key={f.federationId}>
                        <td style={TD}>
                            {f.federationName ?? '—'}
                            <TqNote
                                standings={f.truvaQualifiedStandings}
                                mixed={f.truvaQualifiedMixed}
                                totalUnits={f.totalUnits}
                                qualifyingUnits={f.unitsInQualifyingSocieties}
                            />
                        </td>
                        <td style={{ ...TD, color: '#8a857b' }}>{f.truvaMicroMarketName ?? '—'}</td>
                        <td style={NUM}>{f.societies}</td>
                        <td style={NUM}>{f.unitsProcured.toLocaleString()}</td>
                        <td style={NUM}>
                            {f.unitsInQualifyingSocieties.toLocaleString()}
                            {f.truvaQualifiedMixed && f.totalUnits !== f.unitsInQualifyingSocieties && (
                                <span
                                    title={`${f.totalUnits.toLocaleString()} units under the federation in total; ${(
                                        f.totalUnits - f.unitsInQualifyingSocieties
                                    ).toLocaleString()} are in societies that are not Truva-Qualified and are excluded`}
                                    style={{ color: '#bdb6aa', fontWeight: 400 }}>
                                    {' '}
                                    / {f.totalUnits.toLocaleString()}
                                </span>
                            )}
                        </td>
                        <td style={{ ...TD, minWidth: 160 }}>
                            <PctCell pct={f.procurementPct} unitsProcured={f.unitsProcured} />
                        </td>
                    </tr>
                ))}
            </tbody>
        </table>
    )
}

export function SocietyTable({ rows }: { rows: SocietyWithPriority[] }) {
    return (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
                <tr>
                    <th style={TH}>Society</th>
                    <th style={TH}>Federation</th>
                    <th style={TH}>Micromarket</th>
                    <th style={TH}>Priority</th>
                    <th style={{ ...TH, textAlign: 'right' }}>Procured</th>
                    <th style={{ ...TH, textAlign: 'right' }}>Units</th>
                    <th style={{ ...TH, minWidth: 160 }}>Procurement</th>
                </tr>
            </thead>
            <tbody>
                {rows.map((s) => (
                    <tr key={s.societyId}>
                        <td style={TD}>{s.societyName}</td>
                        <td style={{ ...TD, color: '#8a857b' }}>{s.federationName ?? '—'}</td>
                        <td style={{ ...TD, color: '#8a857b' }}>{s.truvaMicroMarketName ?? '—'}</td>
                        <td style={{ ...TD, color: s.priority ? '#3a3833' : '#bdb6aa' }}>
                            {s.priority ?? '—'}
                            {s.priorityInconsistent && (
                                <span title="Units under this society disagreed; the most frequent value was taken" style={{ color: '#9c7430' }}>
                                    {' '}
                                    *
                                </span>
                            )}
                        </td>
                        <td style={NUM}>{s.unitsProcured.toLocaleString()}</td>
                        <td style={NUM}>{s.totalUnits.toLocaleString()}</td>
                        <td style={{ ...TD, minWidth: 160 }}>
                            <PctCell pct={s.procurementPct} unitsProcured={s.unitsProcured} />
                        </td>
                    </tr>
                ))}
            </tbody>
        </table>
    )
}
