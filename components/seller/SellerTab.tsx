'use client'

import ChartCard from '@/components/shared/ChartCard'
import LeadListModal, { type LeadListItem } from '@/components/shared/LeadListModal'
import SectionHeader from '@/components/shared/SectionHeader'
import CostWeekChart from '@/components/buyer/CostWeekChart'
import NotQualifiedPie from '@/components/buyer/NotQualifiedPie'
import TwoWeekTable, { type MetricGroup } from '@/components/buyer/TwoWeekTable'
import WoWStackedBar from '@/components/buyer/WoWStackedBar'
import type { ReasonPoint } from '@/lib/buyer/types'
import type { SellerFactsResponse } from '@/lib/seller/aggregate'
import { deriveReport } from '@/lib/seller/derive'
import { EMPTY_SELLER_FILTERS, type SellerFilters } from '@/lib/seller/filters'
import { buildSellerClusterOptions, buildSellerSourceOptions } from '@/lib/seller/options'
import { type TimeRange, monthRanges, quarterRanges } from '@/lib/buyer/timePresets'
import { MICROMARKET_TO_CLUSTER } from '@/lib/seller/shared'
import { SELLER_CHANNELS, SELLER_PRIMARY_METRICS, type ClusterPipelinePoint, type WeekSeriesPoint } from '@/lib/seller/types'
import { relativeTime } from '@/lib/shared/relativeTime'
import { useEffect, useMemo, useState } from 'react'
import ClusterPipelineBar from './ClusterPipelineBar'
import MicromarketBulletBar from './MicromarketBulletBar'
import NextActionables from './NextActionables'
import { CHANNEL_ORDER, MICROMARKET_ORDER, STATUS_ORDER, colorFor } from './palette'
import OverallFunnel from './OverallFunnel'
import SellerFilterBar from './SellerFilterBar'

function clusterOf(micromarket: string): string {
    return MICROMARKET_TO_CLUSTER.get(micromarket) ?? 'Unknown'
}
import SpendNote from '@/components/shared/SpendNote'

type SaveStatus = 'loading' | 'idle' | 'saving' | 'error'
const MONO = { fontFamily: "'IBM Plex Mono', monospace" } as const

// Groups the Target vs Achieved table's rows into collapsible sections — same "hard to scan"
// fix as the Buyer tab's own table (components/buyer/TwoWeekTable.tsx's `groups` prop). Every
// metric UNITS defines in lib/seller/derive.ts must appear here exactly once.
const SELLER_TWO_WEEK_GROUPS: MetricGroup[] = [
    { label: 'Leads', metrics: ['Total Leads', 'Total Qualified Seller Leads', 'LTQL %', 'Qualified Property Leads'] },
    {
        label: 'Visits',
        metrics: [
            'Unique Seller Total Visits',
            'Unique Seller New Visits',
            'Unique Seller Old Visits',
            'QLTV %',
            'Total Property Visits',
            'New Property Visits',
            'Old Property Visits',
            'Visits in Pipeline',
        ],
    },
    {
        label: 'Conversions & Cost',
        metrics: ['Total Conversions', 'New Conversions', 'Old Conversions', 'Spend', 'CPL', 'CPQL', 'CPV', 'CAC'],
    },
]

function seriesEmpty(pts: WeekSeriesPoint[]): boolean {
    return !pts.some((p) => Object.values(p.counts).some((n) => (n ?? 0) > 0))
}

interface DrillDown {
    title: string
    subtitle?: string
    sellers: LeadListItem[]
}

// The Next 2wk Target column's per-channel/per-micromarket breakdown — changed 2026-09-10, per
// an explicit growth-team request to mirror how the quarterly target grid (lib/seller/targets.ts)
// already works: entered per channel or per micromarket, with clusters and the overall total
// adding up from their parts rather than being separately typed. Two independent 1D breakdowns
// (channel, or micromarket — never a joint grid, never per raw source), reusing today's single
// input box per metric row: what it reads/writes just depends on the current Channel / Cluster-MM
// filter selection now, instead of being one flat number regardless of the filter.

// The 7 real, plannable channels — Unmapped is a catch-all with no row in the quarterly target
// grid either, so it's excluded here too, including from the "sum of all channels" Overall total.
const NEXT_TARGET_CHANNELS = SELLER_CHANNELS.filter((c) => c !== 'Unmapped')

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
 *  micromarkets in `filters.micromarkets` (FilterControls.tsx's NestedList, toggleParent), so
 *  this needs no separate cluster-resolution step — a whole-cluster pick and an arbitrary
 *  multi-micromarket pick both just land in the `mm-sum` branch below. */
function resolveNextTargetScope(filters: SellerFilters): NextTargetScope {
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
    // Neither filter active — the true "All" view. Overall is the sum of every real channel,
    // per the growth team's own framing ("overall to add all channels"); micromarkets only sum
    // up to their own cluster, never to a second, possibly-disagreeing Overall figure.
    return { kind: 'channel-sum', channels: NEXT_TARGET_CHANNELS }
}

/** Sums `draft[keyFor(metric, item)]` over `items`, per metric in `metrics` — `null` (blank) the
 *  moment any one of them has no saved value yet. Applies the growth team's own rule for
 *  cluster totals ("blank until every micromarket in it is filled in") uniformly to every summed
 *  scope, including the top-level channel-sum Overall. */
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
                    ? 'Next 2wk Target shown is the sum of all 7 channels — pick one Channel to edit its own number.'
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

export default function SellerTab({
    response,
    periods,
    onPeriods,
    loading,
}: {
    response: SellerFactsResponse
    /** Selected quarters, months or one custom range. Empty means the reporting quarter. */
    periods: TimeRange[]
    onPeriods: (p: TimeRange[]) => void
    loading: boolean
}) {
    const [drillDown, setDrillDown] = useState<DrillDown | null>(null)
    const [filters, setFilters] = useState<SellerFilters>(EMPTY_SELLER_FILTERS)

    // Target vs Achieved's "Next 2wk Target" column — a shared, persisted override the growth
    // team types in themselves, keyed per channel or per micromarket (changed 2026-09-10 — see
    // resolveNextTargetScope/nextTargetView above and lib/seller/nextTargets.ts's doc comment for
    // the key format; the map itself is still a generic Record<string, number|null>, so the
    // storage layer needed no change). Same fetch-then-explicit-Save shape as NextActionables
    // (lib/seller/nextTargets.ts, app/api/seller/next-targets/route.ts): a draft that only
    // writes back on Save, so nobody's mid-edit number overwrites what a teammate just saved.
    const [nextTargetsDraft, setNextTargetsDraft] = useState<Record<string, number | null>>({})
    const [nextTargetsSaved, setNextTargetsSaved] = useState<Record<string, number | null>>({})
    const [nextTargetsUpdatedAt, setNextTargetsUpdatedAt] = useState<string | null>(null)
    const [nextTargetsStatus, setNextTargetsStatus] = useState<SaveStatus>('loading')

    useEffect(() => {
        let cancelled = false
        fetch('/api/seller/next-targets')
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
            const res = await fetch('/api/seller/next-targets', {
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
    const clusterOptions = useMemo(() => buildSellerClusterOptions(), [])
    const sourceOptions = useMemo(() => buildSellerSourceOptions(response.facts), [response.facts])

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

    function openSellerIds(title: string, subtitle: string | undefined, ids: string[]) {
        const sellers = ids.map((id) => data.sellersById[id]).filter((s): s is LeadListItem => !!s)
        setDrillDown({ title, subtitle, sellers })
    }

    function onWeekSegment(point: WeekSeriesPoint, key: string, label: string) {
        openSellerIds(`${label}: ${key}`, `Week of ${point.weekLabel}`, point.leadIds[key] ?? [])
    }

    function onReasonSlice(point: ReasonPoint) {
        openSellerIds(`Not Qualified: ${point.reason}`, undefined, point.leadIds)
    }

    function onPipelineSegment(point: ClusterPipelinePoint, micromarket: string) {
        openSellerIds(`Visits in Pipeline: ${micromarket}`, `Cluster: ${point.cluster}`, point.leadIds[micromarket] ?? [])
    }

    // Compares the FULL draft vs. saved maps (every compound key, not just the 20 bare metric
    // names) — a pending edit made under a different Channel/Cluster-MM filter than the one
    // currently shown must still enable Save.
    const nextTargetsDirty = !recordsEqual(nextTargetsDraft, nextTargetsSaved)

    const nextTargetMetrics = useMemo(() => data.targetVsAchieved.map((r) => r.metric), [data.targetVsAchieved])
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
            <SellerFilterBar
                filters={filters}
                onChange={setFilters}
                clusterOptions={clusterOptions}
                sourceOptions={sourceOptions}
                quarters={quarters}
                months={months}
                periods={periods}
                onPeriods={onPeriods}
                defaultLabel={response.quarterLabel}
                loading={loading}
            />

            <SectionHeader title="Overview" />

            <ChartCard title="Overall Funnel" height="auto">
                <OverallFunnel data={data.overallFunnel} expectedPct={data.expectedPctOfTarget} />
            </ChartCard>

            <SectionHeader title="Target vs Achieved" />

            <ChartCard
                title="Target vs Achieved"
                subtitle="Last 2 weeks are always the most recent complete Monday–Sunday pair; QTD follows the selected time filter; Next 2wk Target is typed in by the team and shared with everyone"
                height="auto">
                <TwoWeekTable
                    data={data.targetVsAchieved}
                    primaryMetrics={SELLER_PRIMARY_METRICS}
                    editableNextW2Target={nextTargetDisplay.editable}
                    nextW2TargetOverrides={nextTargetDisplay.overrides}
                    onNextW2TargetChange={handleNextTargetChange}
                    groups={SELLER_TWO_WEEK_GROUPS}
                />
                <div style={{ fontSize: 11.5, color: '#333333', marginTop: 6, ...MONO }}>{nextTargetDisplay.caption}</div>
                <SpendNote ingest={data.spendIngest} sheetName="Seller" excludedUnallocated={data.spendExcludedUnallocated} />
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

            <ChartCard
                title="WoW Leads by Channel"
                subtitle="Bucketed by the week the seller came in"
                height={360}
                empty={seriesEmpty(data.leadsByChannel)}>
                <WoWStackedBar
                    data={data.leadsByChannel}
                    seriesOrder={CHANNEL_ORDER}
                    colorFor={colorFor}
                    pairWeeks
                    showSharePercent
                    allowPercentToggle
                    onSegmentClick={(p, k) => onWeekSegment(p, k, 'Leads by Channel')}
                />
            </ChartCard>

            <ChartCard title="WoW CPL" subtitle="Weekly Spend ÷ that week's Total Leads" height={280} empty={data.cplByWeek.every((p) => p.value == null)}>
                <CostWeekChart data={data.cplByWeek} label="CPL" />
            </ChartCard>

            <ChartCard
                title="WoW Qualified Seller Leads by Channel"
                subtitle="Bucketed by the week the seller came in"
                height={360}
                empty={seriesEmpty(data.qualifiedLeadsByChannel)}>
                <WoWStackedBar
                    data={data.qualifiedLeadsByChannel}
                    seriesOrder={CHANNEL_ORDER}
                    colorFor={colorFor}
                    pairWeeks
                    showSharePercent
                    allowPercentToggle
                    onSegmentClick={(p, k) => onWeekSegment(p, k, 'Qualified Seller Leads by Channel')}
                />
            </ChartCard>

            <ChartCard title="WoW CPQL" subtitle="Weekly Spend ÷ that week's Total Qualified Seller Leads" height={280} empty={data.cpqlByWeek.every((p) => p.value == null)}>
                <CostWeekChart data={data.cpqlByWeek} label="CPQL" />
            </ChartCard>

            <ChartCard
                title="WoW Lead Status by Call Status"
                subtitle="Shaded by lifecycle — blues still to be worked, greens qualified & progressing, reds not qualified or inactive"
                height={360}
                empty={seriesEmpty(data.leadsByStatus)}>
                <WoWStackedBar
                    data={data.leadsByStatus}
                    seriesOrder={STATUS_ORDER}
                    colorFor={colorFor}
                    pairWeeks
                    showSharePercent
                    allowPercentToggle
                    onSegmentClick={(p, k) => onWeekSegment(p, k, 'Lead Status by Call Status')}
                />
            </ChartCard>

            <ChartCard title="Not Qualified Reasons" height={340} empty={data.notQualifiedReasons.length === 0}>
                <NotQualifiedPie
                    data={data.notQualifiedReasons}
                    onSliceClick={onReasonSlice}
                    colorFor={colorFor}
                    showPercent
                    subReasons={data.notTruvaApprovedSubReasons}
                    subReasonsParentReason="Not Truva approved"
                    subReasonsLabel="Reason for Not Truva Qualified"
                />
            </ChartCard>

            <ChartCard
                title="Gross Visits (by Created Week)"
                subtitle="Every qualifying property, not deduped by seller — bucketed by the SELLER's created week instead of the qualifying visit's own attribution date"
                height={360}
                empty={seriesEmpty(data.propertyVisitsByChannelCreatedWeek)}>
                <WoWStackedBar
                    data={data.propertyVisitsByChannelCreatedWeek}
                    seriesOrder={CHANNEL_ORDER}
                    colorFor={colorFor}
                    pairWeeks
                    showSharePercent
                    allowPercentToggle
                    onSegmentClick={(p, k) => onWeekSegment(p, k, 'Gross Visits (by Created Week)')}
                />
            </ChartCard>

            <ChartCard
                title="WoW Property Visits by Channel"
                subtitle="Every qualifying property, not deduped by seller. Bucketed by the visit's own attribution date, irrespective of when the seller was created."
                height={360}
                empty={seriesEmpty(data.propertyVisitsByChannel)}>
                <WoWStackedBar
                    data={data.propertyVisitsByChannel}
                    seriesOrder={CHANNEL_ORDER}
                    colorFor={colorFor}
                    pairWeeks
                    showSharePercent
                    allowPercentToggle
                    onSegmentClick={(p, k) => onWeekSegment(p, k, 'Property Visits by Channel')}
                />
            </ChartCard>

            <ChartCard
                title="Unique Visits (by Created Week)"
                subtitle="One seller counts once per week, however many qualifying properties it has — bucketed by the SELLER's created week instead of the qualifying visit's own attribution date"
                height={360}
                empty={seriesEmpty(data.sellerVisitsByChannelCreatedWeek)}>
                <WoWStackedBar
                    data={data.sellerVisitsByChannelCreatedWeek}
                    seriesOrder={CHANNEL_ORDER}
                    colorFor={colorFor}
                    pairWeeks
                    showSharePercent
                    allowPercentToggle
                    onSegmentClick={(p, k) => onWeekSegment(p, k, 'Unique Visits (by Created Week)')}
                />
            </ChartCard>

            <ChartCard title="WoW CPV" subtitle="Weekly Spend ÷ that week's count from Unique Visits (by Created Week)" height={280} empty={data.cpvByWeek.every((p) => p.value == null)}>
                <CostWeekChart data={data.cpvByWeek} label="CPV" />
            </ChartCard>

            <ChartCard
                title="WoW Seller Visits by Channel"
                subtitle="One seller counts once per week, however many qualifying properties it has. Bucketed by the visit's own attribution date, irrespective of when the seller was created."
                height={360}
                empty={seriesEmpty(data.sellerVisitsByChannel)}>
                <WoWStackedBar
                    data={data.sellerVisitsByChannel}
                    seriesOrder={CHANNEL_ORDER}
                    colorFor={colorFor}
                    pairWeeks
                    showSharePercent
                    allowPercentToggle
                    onSegmentClick={(p, k) => onWeekSegment(p, k, 'Seller Visits by Channel')}
                />
            </ChartCard>

            <ChartCard
                title="Visits in Pipeline by Cluster"
                subtitle="A live snapshot — the time filter does not apply here"
                height={320}
                empty={data.pipelineByCluster.length === 0}>
                <ClusterPipelineBar data={data.pipelineByCluster} onSegmentClick={onPipelineSegment} />
            </ChartCard>

            <SectionHeader title="Micromarket Analysis" />

            <ChartCard
                title="Overall Quarter Qualified Seller Leads"
                subtitle="By micromarket — the vertical line is each micromarket's own full quarter target"
                height={460}
                empty={data.qualifiedLeadsByMicromarketQuarter.length === 0}>
                <MicromarketBulletBar data={data.qualifiedLeadsByMicromarketQuarter} />
            </ChartCard>

            <ChartCard
                title="Overall Quarter Qualified Seller Visits"
                subtitle="By micromarket — the vertical line is each micromarket's own full quarter target"
                height={460}
                empty={data.qualifiedVisitsByMicromarketQuarter.length === 0}>
                <MicromarketBulletBar data={data.qualifiedVisitsByMicromarketQuarter} />
            </ChartCard>

            <ChartCard
                title="WoW Qualified Seller Leads by Micromarket"
                subtitle="Bucketed by the week the seller came in"
                height={360}
                empty={seriesEmpty(data.qualifiedLeadsByMicromarket)}>
                <WoWStackedBar
                    data={data.qualifiedLeadsByMicromarket}
                    seriesOrder={MICROMARKET_ORDER}
                    colorFor={colorFor}
                    pairWeeks
                    clusterOf={clusterOf}
                    allowPercentToggle
                    onSegmentClick={(p, k) => onWeekSegment(p, k, 'Qualified Seller Leads by Micromarket')}
                />
            </ChartCard>

            <ChartCard
                title="WoW Seller Visits by Micromarket"
                subtitle="One seller counts once per week, however many qualifying properties it has"
                height={360}
                empty={seriesEmpty(data.sellerVisitsByMicromarket)}>
                <WoWStackedBar
                    data={data.sellerVisitsByMicromarket}
                    seriesOrder={MICROMARKET_ORDER}
                    colorFor={colorFor}
                    pairWeeks
                    clusterOf={clusterOf}
                    allowPercentToggle
                    onSegmentClick={(p, k) => onWeekSegment(p, k, 'Seller Visits by Micromarket')}
                />
            </ChartCard>

            {/* Not part of the growth team's requested flow — kept in its own trailing spot,
                same treatment as Buyer's unnamed Attribution charts. */}
            <ChartCard
                title="WoW Qualified Properties by Channel"
                subtitle="Every property of a qualified seller, any acquisition status — bucketed by the property's own created date"
                height={360}
                empty={seriesEmpty(data.qualifiedPropertiesByChannel)}>
                <WoWStackedBar
                    data={data.qualifiedPropertiesByChannel}
                    seriesOrder={CHANNEL_ORDER}
                    colorFor={colorFor}
                    pairWeeks
                    showSharePercent
                    allowPercentToggle
                    onSegmentClick={(p, k) => onWeekSegment(p, k, 'Qualified Properties by Channel')}
                />
            </ChartCard>

            {drillDown && (
                <LeadListModal
                    title={drillDown.title}
                    subtitle={drillDown.subtitle}
                    leads={drillDown.sellers}
                    zohoModule="Sellers"
                    onClose={() => setDrillDown(null)}
                />
            )}
        </div>
    )
}
