'use client'

import SectionHeader from '@/components/shared/SectionHeader'
import { StatRow, StatTile } from '@/components/shared/StatTile'
import type { ProcurementReport } from '@/lib/procurement/types'
import { useMemo, useState } from 'react'
import ProcurementFilters, { type TqScope } from './ProcurementFilters'
import { denominatorSuspect, FederationTable, SocietyTable, type Grain } from './ProcurementTable'
import WeeklyTrend, { latestMovement } from './WeeklyTrend'

// Homeowner-data procurement, as a share of the units truiq holds.
//
// **Federation leads, and that is a judgement, not a layout preference.** Zoho's `Society_Name`
// almost always names what truiq calls a federation — `Kalpataru Aura` is one Zoho name and five
// truiq societies — so the federation ratio is computed over a numerator and denominator that
// describe the same thing. The society ratio reads lower mostly because records that only ever
// identified a federation cannot be placed in a society, not because less was procured. The
// dropdown switches grain; it opens on federation.

interface Props {
    report: ProcurementReport
    loading?: boolean
    tqScope: TqScope
    onTqScope: (s: TqScope) => void
}

const MUTED = '#8a857b'

/** Human copy for the warnings growth and this side emit, so the strip is not raw slugs. */
const WARNING_COPY: Record<string, string> = {
    airtable_not_configured: 'Airtable is not configured, so no society has a priority. The numbers are unaffected.',
    airtable_unavailable: 'Airtable could not be reached, so priority is missing. The numbers are unaffected.',
    airtable_empty:
        'Airtable returned no rows — check AIRTABLE_TQ_TABLE names the right table. Priority is missing; the numbers are unaffected.',
    airtable_fields_unmatched:
        'Airtable returned rows, but none had both a Society and a Priority value — check the column names in that table. Priority is missing; the numbers are unaffected.',
    airtable_no_society_match:
        'Airtable’s rows look fine, but none of its society names matches a society in truiq — it may be listing federations rather than buildings. Priority is missing; the numbers are unaffected.',
    ambiguous_society_names: 'Some Zoho society names match more than one truiq society and were left unplaced.',
    match_coverage_below_60pct:
        'Under 60% of procured records could be placed. Treat every percentage below as a floor, not a measurement.',
}

function pctText(n: number | null): string {
    return n === null ? '—' : `${n.toFixed(1)}%`
}

export default function ProcurementTab({ report, loading, tqScope, onTqScope }: Props) {
    const [grain, setGrain] = useState<Grain>('federation')
    const [query, setQuery] = useState('')
    const [micromarket, setMicromarket] = useState('')

    const federations = report.federations ?? []
    const coverage = grain === 'federation' ? report.matchCoverage.federation : report.matchCoverage.society

    const micromarkets = useMemo(() => {
        const set = new Set<string>()
        for (const f of federations) if (f.truvaMicroMarketName) set.add(f.truvaMicroMarketName)
        for (const s of report.societies) if (s.truvaMicroMarketName) set.add(s.truvaMicroMarketName)
        return [...set].sort()
    }, [federations, report.societies])

    const federationRows = useMemo(() => {
        const q = query.trim().toLowerCase()
        return federations
            .filter((f) => !micromarket || f.truvaMicroMarketName === micromarket)
            .filter(
                (f) =>
                    !q ||
                    (f.federationName ?? '').toLowerCase().includes(q) ||
                    (f.truvaMicroMarketName ?? '').toLowerCase().includes(q)
            )
            .sort((a, b) => b.unitsInQualifyingSocieties - a.unitsInQualifyingSocieties)
    }, [federations, query, micromarket])

    const societyRows = useMemo(() => {
        const q = query.trim().toLowerCase()
        return report.societies
            .filter((s) => !micromarket || s.truvaMicroMarketName === micromarket)
            .filter(
                (s) =>
                    !q ||
                    s.societyName.toLowerCase().includes(q) ||
                    (s.federationName ?? '').toLowerCase().includes(q) ||
                    (s.truvaMicroMarketName ?? '').toLowerCase().includes(q)
            )
            .sort((a, b) => b.totalUnits - a.totalUnits)
    }, [report.societies, query, micromarket])

    // Rows whose procured count cannot be divided by the units truiq holds. Counted at the grain
    // on show, because a federation can look sane while one society beneath it has no unit list.
    const suspect = useMemo(() => {
        const rows: { procured: number }[] =
            grain === 'federation'
                ? federations
                      .filter((f) => denominatorSuspect(f.procurementPct, f.unitsProcured))
                      .map((f) => ({ procured: f.unitsProcured }))
                : report.societies
                      .filter((s) => denominatorSuspect(s.procurementPct, s.unitsProcured))
                      .map((s) => ({ procured: s.unitsProcured }))
        return { count: rows.length, procured: rows.reduce((n, r) => n + r.procured, 0) }
    }, [grain, federations, report.societies])

    // A filter narrows the population, so the headline is recomputed over the visible rows —
    // otherwise a Powai view would carry Mumbai-wide totals above a Powai table. `query` is
    // excluded on purpose: typing in a search box should not silently redefine the metric.
    const narrowed = micromarket !== ''
    const summary = useMemo(() => {
        if (!narrowed) {
            return grain === 'federation' ? (report.federationSummary ?? report.summary) : report.summary
        }
        const rows =
            grain === 'federation'
                ? federations
                      .filter((f) => !micromarket || f.truvaMicroMarketName === micromarket)
                      .map((f) => ({
                          units: f.unitsInQualifyingSocieties,
                          procured: f.unitsProcured,
                          pct: f.procurementPct,
                          societies: f.societies,
                      }))
                : report.societies
                      .filter((s) => !micromarket || s.truvaMicroMarketName === micromarket)
                      .map((s) => ({ units: s.totalUnits, procured: s.unitsProcured, pct: s.procurementPct, societies: 1 }))
        const totalUnits = rows.reduce((n, r) => n + r.units, 0)
        const unitsProcured = rows.reduce((n, r) => n + r.procured, 0)
        return {
            totalSocieties: rows.reduce((n, r) => n + r.societies, 0),
            totalUnits,
            unitsProcured,
            procurementPct: totalUnits > 0 ? Math.round((unitsProcured / totalUnits) * 10000) / 100 : null,
            societiesAt100Pct: rows.filter((r) => r.pct !== null && r.pct >= 100).length,
        }
    }, [narrowed, grain, federations, report.societies, report.federationSummary, report.summary, micromarket])

    const movement = latestMovement(report.weekly ?? [])
    const hasNotes = narrowed || report.warnings.length > 0
    const shown = grain === 'federation' ? federationRows.length : societyRows.length
    const total = grain === 'federation' ? federations.length : report.societies.length
    const noFederations = grain === 'federation' && federations.length === 0

    return (
        <div style={{ opacity: loading ? 0.6 : 1, transition: 'opacity 0.15s' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 18 }}>
                <div style={{ flex: 1 }}>
                    <SectionHeader title="Data procurement" />
                </div>
            </div>

            <div style={{ marginBottom: 18 }}>
                <ProcurementFilters
                    grain={grain}
                    onGrain={setGrain}
                    micromarket={micromarket}
                    onMicromarket={setMicromarket}
                    micromarkets={micromarkets}
                    tqScope={tqScope}
                    onTqScope={onTqScope}
                />
            </div>

            {/* Four tiles, in the order they are read: how many things, how many are done, how
                much has been procured, and the ratio. All four describe the FILTERED population —
                pick a micromarket and every one of them, and the chart below, narrows with it.
                Coverage is not a tile: it qualifies every number here rather than sitting beside
                them as a peer, so it lives in the strip underneath. */}
            <StatRow>
                <StatTile
                    label={grain === 'federation' ? 'Federations' : 'Societies'}
                    value={summary.totalSocieties.toLocaleString()}
                    sub={micromarket || undefined}
                />
                <StatTile
                    label="At 100%"
                    value={summary.societiesAt100Pct.toLocaleString()}
                    sub={`of ${summary.totalSocieties.toLocaleString()}`}
                />
                <StatTile
                    label="Units procured"
                    value={summary.unitsProcured.toLocaleString()}
                    sub={`of ${summary.totalUnits.toLocaleString()}${tqScope === 'tq' ? ' TQ' : ''}`}
                />
                <StatTile
                    label="Procurement"
                    value={pctText(summary.procurementPct)}
                    hint={
                        `${coverage.matched.toLocaleString()} of ${report.matchCoverage.procuredPool.toLocaleString()} ` +
                        `procured records (${pctText(coverage.pct)}) could be placed at this grain. ` +
                        `Unplaced records can only hold this figure down, never raise it.`
                    }
                />
            </StatRow>

            {report.weekly && report.weekly.length > 0 && (
                <WeeklyTrend
                    weekly={report.weekly}
                    micromarket={micromarket || undefined}
                    deltaPct={movement.deltaPct}
                    newlyProcured={movement.newlyProcured}
                />
            )}

            {/* What is left here is only what a reader has to act on: a narrowed view, and things
                that are actually wrong. The standing explanations — coverage, UNITS MISSING,
                MIXED TQ — moved onto the tile and the badges they describe, where they are read
                in context instead of as a wall of caveats nobody finishes. */}
            <div
                style={{
                    background: '#fbf9f4',
                    border: '1px solid #e9e4db',
                    borderRadius: 12,
                    padding: '12px 16px',
                    fontSize: 12,
                    color: MUTED,
                    lineHeight: 1.7,
                    marginBottom: 20,
                    display: hasNotes ? 'block' : 'none',
                }}>
                {narrowed && (
                    <div style={{ color: '#3a3833' }}>
                        Showing <strong>{micromarket}</strong> — the four figures above and the chart are recomputed
                        over just these rows, not the whole set.
                    </div>
                )}
                {report.warnings.length > 0 && (
                    <div style={{ marginTop: 8 }}>
                        {report.warnings.map((w) => (
                            <div key={w} style={{ color: '#9c7430' }}>
                                {WARNING_COPY[w] ?? w}
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {report.byPriority.length > 1 && (
                <div style={{ marginBottom: 20 }}>
                    <SectionHeader title="By priority" />
                    <StatRow>
                        {report.byPriority.map((b) => (
                            <StatTile
                                key={b.priority}
                                label={b.priority}
                                value={pctText(b.procurementPct)}
                                sub={`${b.societiesTotal} societies`}
                            />
                        ))}
                    </StatRow>
                </div>
            )}

            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
                <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={grain === 'federation' ? 'Filter federations…' : 'Filter societies…'}
                    style={{
                        background: '#fff',
                        border: '1px solid #e2ddd7',
                        borderRadius: 8,
                        padding: '7px 12px',
                        fontSize: 13,
                        fontFamily: 'inherit',
                        color: '#23211e',
                        width: 280,
                    }}
                />
                <span style={{ fontSize: 12, color: MUTED }}>
                    {shown === total ? `${total} rows` : `${shown} of ${total} rows`}
                </span>
            </div>

            <div style={{ border: '1px solid #e9e4db', borderRadius: 14, padding: '16px 8px 8px', background: '#fff' }}>
                {noFederations ? (
                    <div style={{ padding: 24, fontSize: 13, color: MUTED }}>
                        growth returned no federation rows — it was asked to skip them
                        (<code>includeFederations=false</code>). Switch to “By society”, or drop that parameter.
                    </div>
                ) : grain === 'federation' ? (
                    <FederationTable rows={federationRows} />
                ) : (
                    <SocietyTable rows={societyRows} />
                )}
            </div>

            <div style={{ marginTop: 16, fontSize: 12, color: MUTED, lineHeight: 1.7 }}>
                {report.dataQuality.unmatchedProcuredRecords.toLocaleString()} procured records could not be placed in
                any society; {report.dataQuality.recordsWithoutSociety.toLocaleString()} carry no society name at all.
                {report.dataQuality.ambiguousSocietyNames.length > 0 &&
                    ` ${report.dataQuality.ambiguousSocietyNames.length} names were ambiguous.`}{' '}
                A percentage above 100 is not an error — co-owners give one unit more than one procured record.
            </div>
        </div>
    )
}
