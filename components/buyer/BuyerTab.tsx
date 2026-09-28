'use client'

import ChartCard from '@/components/shared/ChartCard'
import LeadListModal, { type ExtraInfo, type LeadListItem } from '@/components/shared/LeadListModal'
import SectionHeader from '@/components/shared/SectionHeader'
import { ACTIONABLE_CHANNELS } from '@/lib/buyer/actionables'
import type { BuyerFactsResponse } from '@/lib/buyer/aggregate'
import { deriveReport } from '@/lib/buyer/derive'
import { EMPTY_FILTERS, type BuyerFilters, hasDimensionFilter } from '@/lib/buyer/filters'
import {
    buildAdOptions,
    buildAdSetOptions,
    buildCampaignOptions,
    buildClusterOptions,
    buildPropertyOptions,
    buildSourceOptions,
} from '@/lib/buyer/options'
import { type TimeRange, monthRanges, quarterRanges } from '@/lib/buyer/timePresets'
import { SOURCE_ORDER, type MicromarketPoint, type ReasonPoint, type WeekSeriesPoint } from '@/lib/buyer/types'
import { relativeTime } from '@/lib/shared/relativeTime'
import { useEffect, useMemo, useState } from 'react'
import CostWeekChart from './CostWeekChart'
import FilterBar from './FilterBar'
import FrtChart from './FrtChart'
import HouseWarmBar from './HouseWarmBar'
import NextActionables from './NextActionables'
import NotQualifiedPie from './NotQualifiedPie'
import OverallFunnel from './OverallFunnel'
import { STATUS_ORDER } from './palette'
import SpendNote from '@/components/shared/SpendNote'
import TwoWeekTable, { type MetricGroup } from './TwoWeekTable'
import VisitPipelineBar from './VisitPipelineBar'
import WoWStackedBar from './WoWStackedBar'

// Groups the Target vs Achieved table's rows into collapsible sections — per the growth
// team's own "hard to scan a long flat table" feedback (TwoWeekTable.tsx's `groups` prop).
// Every metric UNITS defines in derive.ts must appear here exactly once; TwoWeekTable falls
// back to a trailing "Other" group for anything left out, so a drift here is visible rather
// than silently dropping a row.
const BUYER_TWO_WEEK_GROUPS: MetricGroup[] = [
    { label: 'Acquisition', metrics: ['Spend', 'Total Leads (LSH)', 'Total Unique Leads', 'CPL'] },
    { label: 'Qualification', metrics: ['LTQL %', 'Qualified Leads', 'CPQL'] },
    {
        label: 'Visits',
        metrics: ['QL-V %', 'Total Unique Visits', 'Total Overall Visits', 'Visit Duplication Rate', 'Old Visits', 'New Visits', 'CPV'],
    },
    { label: 'Warm & Conversions', metrics: ['Ever Warm %', 'Total Conversions', 'Old Conversions', 'New Conversions', 'CAC'] },
    { label: 'Other', metrics: ['Direct % of Bids'] },
]

// Fixed colors for the two single-series LSH charts, matching the exact series keys
// derive.ts bumps them under — not in the buyer palette's channel/status maps, so
// WoWStackedBar's default colorFor would fall back to a generic series color otherwise.
function lshCountColorFor(): string {
    return '#0067FF'
}
function lshQualifiedColorFor(): string {
    return '#16A34A'
}

const MONO = { fontFamily: "'IBM Plex Mono', monospace" } as const
type SaveStatus = 'loading' | 'idle' | 'saving' | 'error'

// "WoW Bids Ever Warm" series — not real channels/sources, so the shared source-hue palette
// doesn't apply. Green reads as the positive/warm outcome, matching the rest of this dashboard's
// semantic color use; the other series is a muted neutral rather than red, since not going warm
// yet isn't a bad outcome, just an earlier stage.
const EVER_WARM_ORDER = ['Ever Warm', 'Not Warm']
function everWarmColorFor(key: string): string {
    return key === 'Ever Warm' ? '#16A34A' : '#9CA3AF'
}

// Same reasoning as the Ever Warm pair above: Direct takes the accent green, Channel Partner a
// muted neutral rather than red — a CP visit is a different route to a buyer, not a failure.
const BID_SOURCE_ORDER = ['Direct', 'Channel Partner']
function bidSourceColorFor(key: string): string {
    return key === 'Direct' ? '#16A34A' : '#9CA3AF'
}

function seriesEmpty(pts: WeekSeriesPoint[]): boolean {
    return !pts.some((p) => Object.values(p.counts).some((n) => (n ?? 0) > 0))
}

interface DrillDown {
    title: string
    subtitle?: string
    leads: LeadListItem[]
    extraInfo?: ExtraInfo
}

// The Next 2wk Target column's per-channel/per-micromarket breakdown — mirrors
// components/seller/SellerTab.tsx's identical helpers exactly (see that file's comments for the
// full rationale): entered per channel or per micromarket, with clusters and the overall total
// adding up from their parts rather than being separately typed. Two independent 1D breakdowns
// (channel, or micromarket — never a joint grid, never per raw source), reusing one input box
// per metric row: what it reads/writes just depends on the current Channel / Cluster-MM filter
// selection now, instead of being one flat number regardless of the filter.

// The 6 real, plannable Buyer channels — Unmapped has no row in the quarterly target grid
// either, so it's excluded here too, including from the "sum of all channels" Overall total.
const NEXT_TARGET_CHANNELS = ACTIONABLE_CHANNELS

function channelTargetKey(metric: string, channel: string): string {
    return `${metric}::channel::${channel}`
}
function mmTargetKey(metric: string, micromarket: string): string {
    return `${metric}::mm::${micromarket}`
}

type NextTargetScope =
    | { kind: 'channel-leaf'; channel: string }
    | { kind: 'mm-leaf'; micromarket: string }
    | { kind: 'channel-sum'; channels: readonly string[] }
    | { kind: 'mm-sum'; micromarkets: string[] }
    | { kind: 'ambiguous' }

/** What the single Next 2wk Target input currently means, given the active Channel and
 *  Cluster/MM filters. Ticking a cluster in the filter picker already resolves to its
 *  micromarkets in `filters.micromarkets`, so this needs no separate cluster-resolution step —
 *  a whole-cluster pick and an arbitrary multi-micromarket pick both just land in the `mm-sum`
 *  branch below. */
function resolveNextTargetScope(filters: BuyerFilters): NextTargetScope {
    const channelActive = filters.channels.length > 0
    const mmActive = filters.micromarkets.length > 0
    if (channelActive && mmActive) return { kind: 'ambiguous' }
    if (channelActive) {
        return filters.channels.length === 1
            ? { kind: 'channel-leaf', channel: filters.channels[0]! }
            : { kind: 'channel-sum', channels: filters.channels }
    }
    if (mmActive) {
        return filters.micromarkets.length === 1
            ? { kind: 'mm-leaf', micromarket: filters.micromarkets[0]! }
            : { kind: 'mm-sum', micromarkets: filters.micromarkets }
    }
    // Neither filter active — the true "All" view. Overall is the sum of every real channel;
    // micromarkets only sum up to their own cluster, never to a second, possibly-disagreeing
    // Overall figure.
    return { kind: 'channel-sum', channels: NEXT_TARGET_CHANNELS }
}

/** Sums `draft[keyFor(metric, item)]` over `items`, per metric in `metrics` — `null` (blank) the
 *  moment any one of them has no saved value yet. Applies the same rule for cluster totals
 *  ("blank until every micromarket in it is filled in") uniformly to every summed scope,
 *  including the top-level channel-sum Overall. */
function sumScope(
    draft: Record<string, number | null>,
    metrics: readonly string[],
    items: readonly string[],
    keyFor: (metric: string, item: string) => string
): Record<string, number | null> {
    const out: Record<string, number | null> = {}
    for (const metric of metrics) {
        let total = 0
        let complete = items.length > 0
        for (const item of items) {
            const v = draft[keyFor(metric, item)]
            if (v == null) {
                complete = false
                break
            }
            total += v
        }
        out[metric] = complete ? total : null
    }
    return out
}

/** The Next 2wk Target column's actual editable/read-only state for the current filter scope,
 *  and the metric -> value map TwoWeekTable should read from: a leaf's own draft value when
 *  editable, else a computed sum (or null) for the read-only branch. Computed from the live
 *  draft, not the saved blob, so a just-typed number is reflected in a sum immediately, with no
 *  Save round-trip needed first. */
function nextTargetView(
    scope: NextTargetScope,
    draft: Record<string, number | null>,
    metrics: readonly string[]
): { editable: boolean; overrides: Record<string, number | null>; caption: string } {
    switch (scope.kind) {
        case 'channel-leaf': {
            const overrides: Record<string, number | null> = {}
            for (const metric of metrics) overrides[metric] = draft[channelTargetKey(metric, scope.channel)] ?? null
            return { editable: true, overrides, caption: `Editing Next 2wk Target for: ${scope.channel}` }
        }
        case 'mm-leaf': {
            const overrides: Record<string, number | null> = {}
            for (const metric of metrics) overrides[metric] = draft[mmTargetKey(metric, scope.micromarket)] ?? null
            return { editable: true, overrides, caption: `Editing Next 2wk Target for: ${scope.micromarket}` }
        }
        case 'channel-sum': {
            const overrides = sumScope(draft, metrics, scope.channels, channelTargetKey)
            const caption =
                scope.channels.length === NEXT_TARGET_CHANNELS.length
                    ? `Next 2wk Target shown is the sum of all ${NEXT_TARGET_CHANNELS.length} channels — pick one Channel to edit its own number.`
                    : `Showing the sum of ${scope.channels.length} selected channels — pick exactly one Channel to edit its own number.`
            return { editable: false, overrides, caption }
        }
        case 'mm-sum': {
            const overrides = sumScope(draft, metrics, scope.micromarkets, mmTargetKey)
            return {
                editable: false,
                overrides,
                caption: `Showing the sum of ${scope.micromarkets.length} selected micromarkets — pick exactly one Micromarket to edit its own number.`,
            }
        }
        case 'ambiguous': {
            const overrides: Record<string, number | null> = {}
            for (const metric of metrics) overrides[metric] = null
            return {
                editable: false,
                overrides,
                caption: 'Pick either a Channel or a Micromarket (not both) to edit a Next 2wk Target.',
            }
        }
    }
}

/** True unless some key's value differs, over the union of both maps' keys — not a plain
 *  `JSON.stringify` compare, which would be sensitive to key insertion order on plain objects
 *  built via spread. */
function recordsEqual(a: Record<string, number | null>, b: Record<string, number | null>): boolean {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
        if ((a[k] ?? null) !== (b[k] ?? null)) return false
    }
    return true
}

export default function BuyerTab({
    response,
    periods,
    onPeriods,
    loading,
}: {
    response: BuyerFactsResponse
    /** Selected quarters, months or one custom range. Empty means the reporting quarter. */
    periods: TimeRange[]
    onPeriods: (p: TimeRange[]) => void
    loading: boolean
}) {
    const [drillDown, setDrillDown] = useState<DrillDown | null>(null)
    const [filters, setFilters] = useState<BuyerFilters>(EMPTY_FILTERS)

    // Target vs Actuals' "Next 2wk Target" column — a shared, persisted override the growth team
    // types in themselves, keyed per channel or per micromarket (see resolveNextTargetScope /
    // nextTargetView above and lib/buyer/nextTargets.ts's doc comment for the key format). Same
    // fetch-then-explicit-Save shape as NextActionables: a draft that only writes back on Save, so
    // nobody's mid-edit number overwrites what a teammate just saved.
    const [nextTargetsDraft, setNextTargetsDraft] = useState<Record<string, number | null>>({})
    const [nextTargetsSaved, setNextTargetsSaved] = useState<Record<string, number | null>>({})
    const [nextTargetsUpdatedAt, setNextTargetsUpdatedAt] = useState<string | null>(null)
    const [nextTargetsStatus, setNextTargetsStatus] = useState<SaveStatus>('loading')

    useEffect(() => {
        let cancelled = false
        fetch('/api/buyer/next-targets')
            .then((r) => r.json())
            .then((d: { byMetric?: Record<string, number | null>; updatedAt?: string | null }) => {
                if (cancelled) return
                setNextTargetsDraft(d.byMetric ?? {})
                setNextTargetsSaved(d.byMetric ?? {})
                setNextTargetsUpdatedAt(d.updatedAt ?? null)
                setNextTargetsStatus('idle')
            })
            .catch(() => {
                if (!cancelled) setNextTargetsStatus('error')
            })
        return () => {
            cancelled = true
        }
    }, [])

    async function saveNextTargets() {
        setNextTargetsStatus('saving')
        try {
            const res = await fetch('/api/buyer/next-targets', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ byMetric: nextTargetsDraft }),
            })
            if (!res.ok) throw new Error('save failed')
            const d: { byMetric?: Record<string, number | null>; updatedAt?: string | null } = await res.json()
            setNextTargetsSaved(d.byMetric ?? nextTargetsDraft)
            setNextTargetsUpdatedAt(d.updatedAt ?? null)
            setNextTargetsStatus('idle')
        } catch {
            setNextTargetsStatus('error')
        }
    }

    const quarters = useMemo(() => quarterRanges(new Date()), [])
    const months = useMemo(() => monthRanges(new Date()), [])
    const clusterOptions = useMemo(() => buildClusterOptions(), [])
    const sourceOptions = useMemo(() => buildSourceOptions(response.facts), [response.facts])
    const campaignOptions = useMemo(() => buildCampaignOptions(response.facts), [response.facts])
    const adSetOptions = useMemo(() => buildAdSetOptions(response.facts), [response.facts])
    const adOptions = useMemo(() => buildAdOptions(response.facts), [response.facts])
    const propertyOptions = useMemo(() => buildPropertyOptions(response.facts), [response.facts])

    const data = useMemo(
        () =>
            deriveReport(response.facts, {
                quarterStart: new Date(response.quarterStart),
                quarterEnd: new Date(response.quarterEnd),
                now: new Date(),
                filters: { ...filters, periods: periods.map((p) => ({ start: p.start!, end: p.end! })) },
            }),
        [response, filters, periods]
    )

    const dimFiltered = hasDimensionFilter(filters)
    // Selecting the reporting quarter explicitly is the same view as the default (no period),
    // so the "time filter does not apply" notes must not appear for it — only for a genuinely
    // narrower or different window.
    const rqStart = new Date(response.quarterStart).getTime()
    const rqEnd = new Date(response.quarterEnd).getTime()
    const isReportingQuarter =
        periods.length === 0 ||
        (periods.length === 1 &&
            new Date(periods[0]!.start!).getTime() === rqStart &&
            new Date(periods[0]!.end!).getTime() === rqEnd)
    const timeFiltered = !isReportingQuarter

    function openLeadIds(title: string, subtitle: string | undefined, ids: string[], extraInfo?: ExtraInfo) {
        const leads = ids.map((id) => data.leadsById[id]).filter((l): l is LeadListItem => !!l)
        setDrillDown({ title, subtitle, leads, extraInfo })
    }

    function onWeekSegment(point: WeekSeriesPoint, key: string, label: string) {
        openLeadIds(`${label}: ${key}`, `Week of ${point.weekLabel}`, point.leadIds[key] ?? [])
    }

    // Campaign/AdSet/Ad/Property/Micromarket breakdown charts (2026-09-23): same drill-down
    // as onWeekSegment, plus the Non-Unique Count / Lead Status extra info for that same cut
    // — EXTRA CONTEXT from Lead_Source_History, not part of the funnel. See
    // lib/buyer/types.ts's AttributionExtra and metric-definitions.md.
    function onAttributionSegment(
        point: WeekSeriesPoint,
        key: string,
        label: string,
        dimension: keyof typeof data.lshExtraByDimension
    ) {
        openLeadIds(`${label}: ${key}`, `Week of ${point.weekLabel}`, point.leadIds[key] ?? [], data.lshExtraByDimension[dimension][key])
    }

    function onReasonSlice(point: ReasonPoint) {
        openLeadIds(`Not Qualified: ${point.reason}`, undefined, point.leadIds)
    }

    function onPipelineSegment(point: MicromarketPoint, status: string) {
        openLeadIds(`${point.micromarket}: ${status}`, 'Current visit pipeline', point.leadIds[status] ?? [])
    }

    // Compares the FULL draft vs. saved maps (every compound key, not just the bare metric
    // names) — a pending edit made under a different Channel/Cluster-MM filter than the one
    // currently shown must still enable Save.
    const nextTargetsDirty = !recordsEqual(nextTargetsDraft, nextTargetsSaved)

    const nextTargetMetrics = useMemo(() => data.twoWeekTable.map((r) => r.metric), [data.twoWeekTable])
    const nextTargetScope = useMemo(() => resolveNextTargetScope(filters), [filters])
    const nextTargetDisplay = useMemo(
        () => nextTargetView(nextTargetScope, nextTargetsDraft, nextTargetMetrics),
        [nextTargetScope, nextTargetsDraft, nextTargetMetrics]
    )

    function handleNextTargetChange(metric: string, value: number | null) {
        if (nextTargetScope.kind === 'channel-leaf') {
            setNextTargetsDraft((prev) => ({ ...prev, [channelTargetKey(metric, nextTargetScope.channel)]: value }))
        } else if (nextTargetScope.kind === 'mm-leaf') {
            setNextTargetsDraft((prev) => ({ ...prev, [mmTargetKey(metric, nextTargetScope.micromarket)]: value }))
        }
        // Every other scope is read-only — TwoWeekTable never calls onChange when
        // editableNextW2Target is false, so there's nothing to write in that case.
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            <FilterBar
                filters={filters}
                onChange={setFilters}
                clusterOptions={clusterOptions}
                sourceOptions={sourceOptions}
                campaignOptions={campaignOptions}
                adSetOptions={adSetOptions}
                adOptions={adOptions}
                propertyOptions={propertyOptions}
                quarters={quarters}
                months={months}
                periods={periods}
                onPeriods={onPeriods}
                defaultLabel={response.quarterLabel}
                loading={loading}
            />

            <SectionHeader title="Overview" />

            <ChartCard
                title="Overall Funnel"
                height="auto">
                <OverallFunnel data={data.overallFunnel} expectedPct={data.expectedPctOfTarget} />
            </ChartCard>

            <SectionHeader title="Target vs Actuals" />

            <ChartCard
                title="Last 2-Week Target vs Achieved"
                subtitle={
                    timeFiltered
                        ? 'Always the last 2 complete weeks vs the full quarter — the time filter does not apply here'
                        : dimFiltered
                          ? 'Targets are prorated from the selected cells of the channel × micromarket grid'
                          : 'Last 2 complete Monday–Sunday IST weeks, vs the same quarter-to-date totals above. Next 2wk Target is typed in by the team and shared with everyone.'
                }
                height="auto">
                <TwoWeekTable
                    data={data.twoWeekTable}
                    editableNextW2Target={nextTargetDisplay.editable}
                    nextW2TargetOverrides={nextTargetDisplay.overrides}
                    onNextW2TargetChange={handleNextTargetChange}
                    groups={BUYER_TWO_WEEK_GROUPS}
                />
                <div style={{ fontSize: 11.5, color: '#333333', marginTop: 6, ...MONO }}>{nextTargetDisplay.caption}</div>
                <SpendNote ingest={data.spendIngest} sheetName="Buyer side spends" />
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 14 }}>
                    <button
                        onClick={saveNextTargets}
                        disabled={nextTargetsStatus === 'saving' || nextTargetsStatus === 'loading' || !nextTargetsDirty}
                        style={{
                            padding: '6px 16px',
                            fontSize: 12.5,
                            fontWeight: 600,
                            color: nextTargetsDirty ? '#FFFFFF' : '#333333',
                            background: nextTargetsDirty ? '#0067FF' : '#F5F5F5',
                            border: 'none',
                            borderRadius: 6,
                            cursor: nextTargetsDirty && nextTargetsStatus !== 'saving' ? 'pointer' : 'default',
                            ...MONO,
                        }}>
                        {nextTargetsStatus === 'saving' ? 'Saving…' : 'Save Next 2wk Targets'}
                    </button>
                    <span style={{ fontSize: 11.5, color: nextTargetsStatus === 'error' ? '#DC2626' : '#333333', ...MONO }}>
                        {nextTargetsStatus === 'error'
                            ? 'Could not save — try again'
                            : nextTargetsDirty
                              ? 'Unsaved changes'
                              : nextTargetsUpdatedAt
                                ? `Saved ${relativeTime(nextTargetsUpdatedAt)}`
                                : 'Not saved yet'}
                    </span>
                </div>
            </ChartCard>

            <ChartCard title="Next Actionables" height="auto">
                <NextActionables />
            </ChartCard>

            <ChartCard title="WoW Leads (LSH)" subtitle="Every Lead_Source_History touch, by week — not deduped by lead" height={280} empty={seriesEmpty(data.lshCountByWeek)}>
                <WoWStackedBar data={data.lshCountByWeek} colorFor={lshCountColorFor} onSegmentClick={(p, k) => onWeekSegment(p, k, 'Leads (LSH)')} pairWeeks allowBiWeeklyToggle pairFromFirstFullWeek />
            </ChartCard>

            <ChartCard title="WoW Qualified Leads (LSH)" subtitle="Same touches, restricted to a Qualified-family status at the time of that touch" height={280} empty={seriesEmpty(data.lshQualifiedByWeek)}>
                <WoWStackedBar data={data.lshQualifiedByWeek} colorFor={lshQualifiedColorFor} onSegmentClick={(p, k) => onWeekSegment(p, k, 'Qualified Leads (LSH)')} pairWeeks allowBiWeeklyToggle pairFromFirstFullWeek />
            </ChartCard>

            <ChartCard
                title="WoW Leads by Source"
                subtitle="Shaded by channel — greens are Paid Ads, reds 3P, blues Organic"
                height={360}
                empty={seriesEmpty(data.leadsBySource)}>
                <WoWStackedBar
                    data={data.leadsBySource}
                    seriesOrder={SOURCE_ORDER}
                    onSegmentClick={(p, k) => onWeekSegment(p, k, 'Leads by Source')}
                    allowPercentToggle
                    pairWeeks
                    allowBiWeeklyToggle
                    pairFromFirstFullWeek
                />
            </ChartCard>

            <ChartCard title="WoW CPL" subtitle="Weekly Spend ÷ that week's Total Unique Leads" height={280} empty={data.cplByWeek.every((p) => p.value == null)}>
                <CostWeekChart data={data.cplByWeek} label="CPL" />
            </ChartCard>

            <ChartCard title="WoW Qualified Leads by Source" height={360} empty={seriesEmpty(data.qualifiedBySource)}>
                <WoWStackedBar
                    data={data.qualifiedBySource}
                    seriesOrder={SOURCE_ORDER}
                    onSegmentClick={(p, k) => onWeekSegment(p, k, 'Qualified Leads by Source')}
                    allowPercentToggle
                    pairWeeks
                    allowBiWeeklyToggle
                    pairFromFirstFullWeek
                />
            </ChartCard>

            <ChartCard title="WoW CPQL" subtitle="Weekly Spend ÷ that week's Qualified Leads" height={280} empty={data.cpqlByWeek.every((p) => p.value == null)}>
                <CostWeekChart data={data.cpqlByWeek} label="CPQL" />
            </ChartCard>

            <ChartCard
                title="WoW Leads by Status"
                subtitle="Shaded by lifecycle — blues still to be worked, greens qualified & progressing, reds not qualified or inactive"
                height={320}
                empty={seriesEmpty(data.leadsByStatus)}>
                <WoWStackedBar
                    data={data.leadsByStatus}
                    seriesOrder={STATUS_ORDER}
                    onSegmentClick={(p, k) => onWeekSegment(p, k, 'Leads by Status')}
                    allowPercentToggle
                    pairWeeks
                    allowBiWeeklyToggle
                    pairFromFirstFullWeek
                />
            </ChartCard>

            <ChartCard title="Not Qualified Reasons" height={320} empty={data.notQualifiedReasons.length === 0}>
                <NotQualifiedPie data={data.notQualifiedReasons} onSliceClick={onReasonSlice} showPercent />
            </ChartCard>

            <ChartCard
                title="WoW Gross Visits (by Lead Created Week)"
                subtitle="Same dedupe as the chart below (person + property, not person alone), bucketed by the LEAD's created week instead of the visit's own week"
                height={320}
                empty={seriesEmpty(data.uniqueGrossVisitsByLeadCreatedWeek)}>
                <WoWStackedBar
                    data={data.uniqueGrossVisitsByLeadCreatedWeek}
                    seriesOrder={SOURCE_ORDER}
                    onSegmentClick={(p, k) => onWeekSegment(p, k, 'Gross Visits (by Lead Created Week)')}
                    allowPercentToggle
                    pairWeeks
                    allowBiWeeklyToggle
                    pairFromFirstFullWeek
                />
            </ChartCard>

            <ChartCard
                title="WoW Unique Gross Visits by Source"
                subtitle="Dedupes on person + property, not person alone — the same buyer visiting a different flat counts again. Bucketed by the visit's own week, irrespective of when the lead was created."
                height={320}
                empty={seriesEmpty(data.uniqueGrossVisitsBySource)}>
                <WoWStackedBar
                    data={data.uniqueGrossVisitsBySource}
                    seriesOrder={SOURCE_ORDER}
                    onSegmentClick={(p, k) => onWeekSegment(p, k, 'Unique Gross Visits by Source')}
                    allowPercentToggle
                    pairWeeks
                    allowBiWeeklyToggle
                    pairFromFirstFullWeek
                />
            </ChartCard>

            <ChartCard
                title="WoW Unique Visits (by Lead Created Week)"
                subtitle="Same dedupe as the chart below (one lead counts once per week), bucketed by the LEAD's created week instead of the visit's own week"
                height={320}
                empty={seriesEmpty(data.uniqueVisitsByLeadCreatedWeek)}>
                <WoWStackedBar
                    data={data.uniqueVisitsByLeadCreatedWeek}
                    seriesOrder={SOURCE_ORDER}
                    onSegmentClick={(p, k) => onWeekSegment(p, k, 'Unique Visits (by Lead Created Week)')}
                    allowPercentToggle
                    pairWeeks
                    allowBiWeeklyToggle
                    pairFromFirstFullWeek
                />
            </ChartCard>

            <ChartCard title="WoW CPV" subtitle="Weekly Spend ÷ that week's count from Unique Visits (by Lead Created Week)" height={280} empty={data.cpvByWeek.every((p) => p.value == null)}>
                <CostWeekChart data={data.cpvByWeek} label="CPV" />
            </ChartCard>

            <ChartCard
                title="Unique Visits WoW by Source"
                subtitle="One lead counts once per week, however many properties it visited. Bucketed by the visit's own week, irrespective of when the lead was created."
                height={360}
                empty={seriesEmpty(data.uniqueVisitsBySource)}>
                <WoWStackedBar
                    data={data.uniqueVisitsBySource}
                    seriesOrder={SOURCE_ORDER}
                    onSegmentClick={(p, k) => onWeekSegment(p, k, 'Unique Visits by Source')}
                    allowPercentToggle
                    pairWeeks
                    allowBiWeeklyToggle
                    pairFromFirstFullWeek
                />
            </ChartCard>

            <ChartCard
                title="WoW Visits: Direct vs Channel Partner"
                subtitle="Counts every visit event, Channel Partner included — the only visit chart here that does. Won't match the visit charts above (they exclude CP and count one per person), shows the whole company whatever the filters say, and isn't clickable: a CP visit has no lead record to open."
                height={320}
                empty={seriesEmpty(data.visitsByBidSource)}>
                <WoWStackedBar
                    data={data.visitsByBidSource}
                    seriesOrder={BID_SOURCE_ORDER}
                    colorFor={bidSourceColorFor}
                    onSegmentClick={() => {}}
                    allowPercentToggle
                    pairWeeks
                    allowBiWeeklyToggle
                    pairFromFirstFullWeek
                />
            </ChartCard>

            <ChartCard
                title="Visit Pipeline by Micromarket"
                subtitle={timeFiltered ? 'A live snapshot — the time filter does not apply here' : undefined}
                height={320}
                empty={data.visitPipeline.length === 0}>
                <VisitPipelineBar data={data.visitPipeline} onSegmentClick={onPipelineSegment} />
            </ChartCard>

            <ChartCard
                title="WoW Bids Ever Warm"
                subtitle="By visit week — does not reconcile against the Ever Warm % row above, which windows its numerator and denominator differently"
                height={320}
                empty={seriesEmpty(data.everWarmByWeek)}>
                <WoWStackedBar
                    data={data.everWarmByWeek}
                    seriesOrder={EVER_WARM_ORDER}
                    colorFor={everWarmColorFor}
                    onSegmentClick={(p, k) => onWeekSegment(p, k, 'Bids Ever Warm')}
                    allowPercentToggle
                    pairWeeks
                    allowBiWeeklyToggle
                    pairFromFirstFullWeek
                />
            </ChartCard>

            <ChartCard
                title="First Response Time"
                subtitle="Working-hours leads only (created 9AM–7PM IST) — Response Time minus Created Time. Target 15 minutes."
                height={320}
                empty={data.frtByWeek.every((w) => w.count === 0)}>
                <FrtChart data={data.frtByWeek} />
            </ChartCard>

            <SectionHeader title="Micromarket" />

            <ChartCard title="WoW Leads by Micromarket" height={320} empty={seriesEmpty(data.leadsByMicromarket)}>
                <WoWStackedBar
                    data={data.leadsByMicromarket}
                    onSegmentClick={(p, k) => onAttributionSegment(p, k, 'Leads by Micromarket', 'micromarket')}
                    allowPercentToggle
                    pairWeeks
                    allowBiWeeklyToggle
                    pairFromFirstFullWeek
                />
            </ChartCard>

            <ChartCard title="WoW Qualified Leads by Micromarket" height={320} empty={seriesEmpty(data.qualifiedByMicromarket)}>
                <WoWStackedBar
                    data={data.qualifiedByMicromarket}
                    onSegmentClick={(p, k) => onAttributionSegment(p, k, 'Qualified Leads by Micromarket', 'micromarket')}
                    allowPercentToggle
                    pairWeeks
                    allowBiWeeklyToggle
                    pairFromFirstFullWeek
                />
            </ChartCard>

            <ChartCard title="WoW Qualified Leads by Cluster" height={320} empty={seriesEmpty(data.qualifiedByCluster)}>
                <WoWStackedBar
                    data={data.qualifiedByCluster}
                    onSegmentClick={(p, k) => onWeekSegment(p, k, 'Qualified Leads by Cluster')}
                    allowPercentToggle
                    pairWeeks
                    allowBiWeeklyToggle
                    pairFromFirstFullWeek
                />
            </ChartCard>

            <ChartCard title="Total Visits WoW by Micromarket" height={320} empty={seriesEmpty(data.totalVisitsByMicromarket)}>
                <WoWStackedBar
                    data={data.totalVisitsByMicromarket}
                    onSegmentClick={(p, k) => onWeekSegment(p, k, 'Total Visits by Micromarket')}
                    allowPercentToggle
                    pairWeeks
                    allowBiWeeklyToggle
                    pairFromFirstFullWeek
                />
            </ChartCard>

            <ChartCard title="Visited Leads per Live House, by Ever Warm" height={380} empty={data.visitedByEverWarm.length === 0}>
                <HouseWarmBar data={data.visitedByEverWarm} />
            </ChartCard>

            <SectionHeader title="Attribution (from Lead Source History)" />

            <ChartCard title="WoW Leads by Campaign" height={320} empty={seriesEmpty(data.leadsByCampaign)}>
                <WoWStackedBar
                    data={data.leadsByCampaign}
                    onSegmentClick={(p, k) => onAttributionSegment(p, k, 'Leads by Campaign', 'campaign')}
                    allowPercentToggle
                    pairWeeks
                    allowBiWeeklyToggle
                    pairFromFirstFullWeek
                />
            </ChartCard>

            <ChartCard title="WoW Qualified Leads by Campaign" height={320} empty={seriesEmpty(data.qualifiedByCampaign)}>
                <WoWStackedBar
                    data={data.qualifiedByCampaign}
                    onSegmentClick={(p, k) => onAttributionSegment(p, k, 'Qualified Leads by Campaign', 'campaign')}
                    allowPercentToggle
                    pairWeeks
                    allowBiWeeklyToggle
                    pairFromFirstFullWeek
                />
            </ChartCard>

            <ChartCard title="WoW Leads by Ad Set" height={320} empty={seriesEmpty(data.leadsByAdSet)}>
                <WoWStackedBar
                    data={data.leadsByAdSet}
                    onSegmentClick={(p, k) => onAttributionSegment(p, k, 'Leads by Ad Set', 'adSet')}
                    allowPercentToggle
                    pairWeeks
                    allowBiWeeklyToggle
                    pairFromFirstFullWeek
                />
            </ChartCard>

            <ChartCard title="WoW Qualified Leads by Ad Set" height={320} empty={seriesEmpty(data.qualifiedByAdSet)}>
                <WoWStackedBar
                    data={data.qualifiedByAdSet}
                    onSegmentClick={(p, k) => onAttributionSegment(p, k, 'Qualified Leads by Ad Set', 'adSet')}
                    allowPercentToggle
                    pairWeeks
                    allowBiWeeklyToggle
                    pairFromFirstFullWeek
                />
            </ChartCard>

            <ChartCard title="WoW Leads by Ad" height={320} empty={seriesEmpty(data.leadsByAd)}>
                <WoWStackedBar
                    data={data.leadsByAd}
                    onSegmentClick={(p, k) => onAttributionSegment(p, k, 'Leads by Ad', 'ad')}
                    allowPercentToggle
                    pairWeeks
                    allowBiWeeklyToggle
                    pairFromFirstFullWeek
                />
            </ChartCard>

            <ChartCard title="WoW Qualified Leads by Ad" height={320} empty={seriesEmpty(data.qualifiedByAd)}>
                <WoWStackedBar
                    data={data.qualifiedByAd}
                    onSegmentClick={(p, k) => onAttributionSegment(p, k, 'Qualified Leads by Ad', 'ad')}
                    allowPercentToggle
                    pairWeeks
                    allowBiWeeklyToggle
                    pairFromFirstFullWeek
                />
            </ChartCard>

            <ChartCard
                title="WoW Leads by Property"
                subtitle="The property a lead was enquiring about at that touch, not a single definitive property for the lead — before a bid exists, a lead can be interested in more than one"
                height={320}
                empty={seriesEmpty(data.leadsByProperty)}>
                <WoWStackedBar
                    data={data.leadsByProperty}
                    onSegmentClick={(p, k) => onAttributionSegment(p, k, 'Leads by Property', 'property')}
                    allowPercentToggle
                    pairWeeks
                    allowBiWeeklyToggle
                    pairFromFirstFullWeek
                />
            </ChartCard>

            <ChartCard title="WoW Qualified Leads by Property" height={320} empty={seriesEmpty(data.qualifiedByProperty)}>
                <WoWStackedBar
                    data={data.qualifiedByProperty}
                    onSegmentClick={(p, k) => onAttributionSegment(p, k, 'Qualified Leads by Property', 'property')}
                    allowPercentToggle
                    pairWeeks
                    allowBiWeeklyToggle
                    pairFromFirstFullWeek
                />
            </ChartCard>

            {drillDown && (
                <LeadListModal
                    title={drillDown.title}
                    subtitle={drillDown.subtitle}
                    leads={drillDown.leads}
                    extraInfo={drillDown.extraInfo}
                    onClose={() => setDrillDown(null)}
                />
            )}
        </div>
    )
}
