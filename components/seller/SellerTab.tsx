'use client'

import ChartCard from '@/components/shared/ChartCard'
import LeadListModal, { type LeadListItem } from '@/components/shared/LeadListModal'
import SectionHeader from '@/components/shared/SectionHeader'
import FrtChart from '@/components/buyer/FrtChart'
import NotQualifiedPie from '@/components/buyer/NotQualifiedPie'
import TwoWeekTable from '@/components/buyer/TwoWeekTable'
import WoWStackedBar from '@/components/buyer/WoWStackedBar'
import type { ReasonPoint } from '@/lib/buyer/types'
import type { SellerFactsResponse } from '@/lib/seller/aggregate'
import { deriveReport } from '@/lib/seller/derive'
import { EMPTY_SELLER_FILTERS, type SellerFilters } from '@/lib/seller/filters'
import { buildSellerClusterOptions, buildSellerSourceOptions } from '@/lib/seller/options'
import { VALID_CLUSTERS } from '@/lib/buyer/shared'
import { type TimeRange, monthRanges, quarterRanges } from '@/lib/buyer/timePresets'
import {
    SELLER_CHANNELS,
    SELLER_PRIMARY_METRICS,
    type ClusterPipelinePoint,
    type CohortSplitPipeline,
    type WeekSeriesPoint,
} from '@/lib/seller/types'
import { relativeTime } from '@/lib/shared/relativeTime'
import { useEffect, useMemo, useState } from 'react'
import MicromarketStatusBar from './MicromarketStatusBar'
import NextActionables from './NextActionables'
import { MICROMARKET_ORDER, STATUS_ORDER, colorFor } from './palette'
import OverallFunnel from './OverallFunnel'
import OverallFunnelProperty from './OverallFunnelProperty'
import PostVisitTatBar from './PostVisitTatBar'
import SellerFilterBar from './SellerFilterBar'

import SpendNote from '@/components/shared/SpendNote'

type SaveStatus = 'loading' | 'idle' | 'saving' | 'error'
const MONO = { fontFamily: "'IBM Plex Mono', monospace" } as const

function seriesEmpty(pts: WeekSeriesPoint[]): boolean {
    return !pts.some((p) => Object.values(p.counts).some((n) => (n ?? 0) > 0))
}

/** Checked against the Till Date reading (the superset of Window's) — if that's empty, Window's
 *  own New-only slice is necessarily empty too. */
function isPipelineEmpty(split: CohortSplitPipeline): boolean {
    return split.new.length === 0 && split.old.length === 0
}

interface DrillDown {
    title: string
    subtitle?: string
    sellers: LeadListItem[]
}

// The Next 2wk Target column — a single Channel × Cluster grid (7 channels × 4 clusters = 28
// cells per metric). Changed 2026-09-10 to be entered per channel or per micromarket instead of
// one flat number; changed again 2026-09-23, per an explicit growth-team request, to unify both
// into this one grid — Channel alone sums across every cluster, Cluster alone sums across every
// channel, both narrowed to one each edits that single cell directly, and the true "Overall"
// (neither picked) sums the WHOLE grid. This replaces the two separate per-channel-only and
// per-micromarket-only breakdowns this column used before — those are no longer read or written
// here (any values already saved under the old `metric::channel::<x>` / `metric::mm::<x>` keys
// just aren't shown by this column anymore; the raw data isn't deleted, only unused). Reuses
// today's single input box per metric row: what it reads/writes depends on the current Channel /
// Cluster-MM filter selection.
//
// An arbitrary micromarket subset that doesn't add up to a whole Cluster has no cell in the grid
// to resolve to, and neither does a raw source picked without its parent Channel (e.g. ticking
// "Meta" without ticking "Paid Ads") — both show a real `0`, not a blocked/blank state (changed
// 2026-09-23, per an explicit growth-team request: "if someone selects just 1 micromarket, or a
// sub channel, show 0").

// The 7 real, plannable channels — Unmapped is a catch-all with no row in the quarterly target
// grid either, so it's excluded here too, including from the "sum of all channels" Overall total.
const NEXT_TARGET_CHANNELS = SELLER_CHANNELS.filter((c) => c !== 'Unmapped')
// The 4 real, plannable clusters (lib/buyer/shared.ts's VALID_CLUSTERS) — "Unknown" is a
// fallback bucket for unrecognised micromarkets, not a real cluster with its own target-grid
// row, so it's excluded here too, same reasoning as Unmapped above.
const NEXT_TARGET_CLUSTERS = [...VALID_CLUSTERS]

function channelClusterTargetKey(metric: string, channel: string, cluster: string): string {
    return `${metric}::channel::${channel}::cluster::${cluster}`
}

type NextTargetScope =
    | { kind: 'leaf'; channel: string; cluster: string }
    | { kind: 'sum'; channels: readonly string[]; clusters: readonly string[] }
    | { kind: 'zero' }

/** What the single Next 2wk Target input currently means, given the active Channel and
 *  Cluster/MM filters — always a slice of the same Channel × Cluster grid.
 *
 *  `filters.clusters` (a whole cluster ticked via its OWN checkbox) is a separate array from
 *  `filters.micromarkets` (FilterControls.tsx's NestedList never infers a parent from its
 *  children — see its own doc comment), so it's the reliable signal for "the user picked whole
 *  cluster(s)". An arbitrary micromarket subset (filters.clusters empty, filters.micromarkets
 *  not) has no cell to resolve to, so it goes to `zero`. Same for `filters.channels` vs
 *  `filters.sources`: a raw source ticked without its parent Channel has no cell either. No
 *  filter picked on a dimension means "every value on that dimension" — that's what makes the
 *  true "Overall" (neither Channel nor Cluster picked) the sum of the whole grid. */
function resolveNextTargetScope(filters: SellerFilters): NextTargetScope {
    if (filters.micromarkets.length > 0 && filters.clusters.length === 0) return { kind: 'zero' }
    if (filters.sources.length > 0 && filters.channels.length === 0) return { kind: 'zero' }
    const channels = filters.channels.length > 0 ? filters.channels : NEXT_TARGET_CHANNELS
    const clusters = filters.clusters.length > 0 ? filters.clusters : NEXT_TARGET_CLUSTERS
    return channels.length === 1 && clusters.length === 1
        ? { kind: 'leaf', channel: channels[0]!, cluster: clusters[0]! }
        : { kind: 'sum', channels, clusters }
}

/** Sums `draft[channelClusterTargetKey(metric, ch, cl)]` over the CROSS PRODUCT of channels ×
 *  clusters, per metric — changed 2026-09-23, per an explicit growth-team request, from "blank
 *  until every cell is filled in" to a live running total: an empty cell counts as zero, and the
 *  sum is always a real, present-time-calculated number (0 when nothing's been typed in yet at
 *  all), never a dash. Applies uniformly, from a single narrowed channel/cluster sum all the way
 *  up to the full-grid "Overall" — add a value to any cell and every total it feeds updates
 *  immediately. */
function sumScope(
    draft: Record<string, number | null>,
    metrics: readonly string[],
    channels: readonly string[],
    clusters: readonly string[]
): Record<string, number | null> {
    const out: Record<string, number | null> = {}
    for (const metric of metrics) {
        let total = 0
        for (const ch of channels) {
            for (const cl of clusters) {
                total += draft[channelClusterTargetKey(metric, ch, cl)] ?? 0
            }
        }
        out[metric] = total
    }
    return out
}

/** The Next 2wk Target column's actual editable/read-only state for the current filter scope,
 *  and the metric -> value map TwoWeekTable should read from: the one cell's own draft value
 *  when editable, else a computed sum (or null) for the read-only branch. Computed from the live
 *  draft, not the saved blob, so a just-typed number is reflected in a sum immediately, with no
 *  Save round-trip needed first. */
function nextTargetView(
    scope: NextTargetScope,
    draft: Record<string, number | null>,
    metrics: readonly string[]
): { editable: boolean; overrides: Record<string, number | null>; caption: string } {
    switch (scope.kind) {
        case 'leaf': {
            const overrides: Record<string, number | null> = {}
            for (const metric of metrics) overrides[metric] = draft[channelClusterTargetKey(metric, scope.channel, scope.cluster)] ?? null
            return { editable: true, overrides, caption: `Editing Next 2wk Target for: ${scope.channel} × ${scope.cluster}` }
        }
        case 'sum': {
            const overrides = sumScope(draft, metrics, scope.channels, scope.clusters)
            const allChannels = scope.channels.length === NEXT_TARGET_CHANNELS.length
            const allClusters = scope.clusters.length === NEXT_TARGET_CLUSTERS.length
            const channelPart = allChannels
                ? `all ${NEXT_TARGET_CHANNELS.length} channels`
                : scope.channels.length === 1
                  ? scope.channels[0]
                  : `${scope.channels.length} channels`
            const clusterPart = allClusters
                ? `all ${NEXT_TARGET_CLUSTERS.length} clusters`
                : scope.clusters.length === 1
                  ? scope.clusters[0]
                  : `${scope.clusters.length} clusters`
            const caption =
                allChannels && allClusters
                    ? `Next 2wk Target shown is the sum of ${channelPart} × ${clusterPart} — pick exactly one Channel and one Cluster to edit its own number.`
                    : `Showing the sum of ${channelPart} × ${clusterPart} — pick exactly one Channel and one Cluster to edit its own number.`
            return { editable: false, overrides, caption }
        }
        case 'zero': {
            const overrides: Record<string, number | null> = {}
            for (const metric of metrics) overrides[metric] = 0
            return {
                editable: false,
                overrides,
                caption:
                    'An individual Micromarket or a sub-channel Source has no target cell of its own — pick a whole Cluster and/or a whole Channel instead.',
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
    const clusterOptions = useMemo(() => buildSellerClusterOptions(response.facts), [response.facts])
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

    function onMicromarketStatusSegment(label: string, point: ClusterPipelinePoint, status: string) {
        openSellerIds(`${label}: ${status}`, `Micromarket: ${point.cluster}`, point.leadIds[status] ?? [])
    }

    function onPostVisitTatBar(stage: string, leadIds: string[]) {
        openSellerIds(`Post Visit TAT: ${stage}`, undefined, leadIds)
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
        if (nextTargetScope.kind === 'leaf') {
            setNextTargetsDraft((prev) => ({
                ...prev,
                [channelClusterTargetKey(metric, nextTargetScope.channel, nextTargetScope.cluster)]: value,
            }))
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

            <ChartCard title="Overall Funnel (Unique Seller)" height="auto">
                <OverallFunnel data={data.overallFunnel} expectedPct={data.expectedPctOfTarget} />
            </ChartCard>

            <ChartCard title="Overall Funnel (Unique Property)" height="auto">
                <OverallFunnelProperty data={data.overallFunnelProperty} expectedPct={data.expectedPctOfTarget} />
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
                    allowPercentToggle
                    allowBiWeeklyToggle
                    pairFromFirstFullWeek
                    allowStatusFilter
                    onSegmentClick={(p, k) => onWeekSegment(p, k, 'Lead Status by Call Status')}
                />
            </ChartCard>

            <SectionHeader title="Target vs Achieved" />

            <ChartCard
                title="Target vs Achieved"
                subtitle="Last 2 weeks are always the most recent complete Monday–Sunday pair; QTD follows the selected time filter; Next 2wk Target is typed in by the team and shared with everyone; Next 2wk Target (Pro-rata) is computed automatically — whatever's left of the quarter target, spread over the weeks remaining — and is informational only"
                height="auto">
                <TwoWeekTable
                    data={data.targetVsAchieved}
                    primaryMetrics={SELLER_PRIMARY_METRICS}
                    editableNextW2Target={nextTargetDisplay.editable}
                    nextW2TargetOverrides={nextTargetDisplay.overrides}
                    onNextW2TargetChange={handleNextTargetChange}
                    showProRataNextTarget
                />
                <div style={{ fontSize: 11.5, color: '#9a948a', marginTop: 6, ...MONO }}>{nextTargetDisplay.caption}</div>
                <SpendNote ingest={data.spendIngest} sheetName="Seller side spends" excludedUnallocated={data.spendExcludedUnallocated} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 14 }}>
                    <button
                        onClick={saveNextTargets}
                        disabled={nextTargetsStatus === 'saving' || nextTargetsStatus === 'loading' || !nextTargetsDirty}
                        style={{
                            padding: '6px 16px',
                            fontSize: 12.5,
                            fontWeight: 600,
                            color: nextTargetsDirty ? '#fbf9f4' : '#9a948a',
                            background: nextTargetsDirty ? '#3a7d5d' : '#efe9e0',
                            border: 'none',
                            borderRadius: 6,
                            cursor: nextTargetsDirty && nextTargetsStatus !== 'saving' ? 'pointer' : 'default',
                            ...MONO,
                        }}>
                        {nextTargetsStatus === 'saving' ? 'Saving…' : 'Save Next 2wk Targets'}
                    </button>
                    <span style={{ fontSize: 11.5, color: nextTargetsStatus === 'error' ? '#c7533e' : '#9a948a', ...MONO }}>
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

            <SectionHeader title="Pre-sales" />

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
                title="WoW Property Visits"
                subtitle="Every qualifying property, not deduped by seller — strict Visit_Date attribution"
                height={360}
                empty={seriesEmpty(data.propertyVisitsByCohort)}>
                <WoWStackedBar
                    data={data.propertyVisitsByCohort}
                    seriesOrder={['New', 'Old']}
                    colorFor={colorFor}
                    allowPercentToggle
                    allowBiWeeklyToggle
                    pairFromFirstFullWeek
                    onSegmentClick={(p, k) => onWeekSegment(p, k, 'Property Visits')}
                />
            </ChartCard>

            <ChartCard
                title="Seller First Response Time"
                subtitle="Working-hours sellers only (created 9AM–7PM IST) — Response Time minus Created Time"
                height={320}
                empty={data.frtByWeek.every((w) => w.count === 0)}>
                <FrtChart data={data.frtByWeek} />
            </ChartCard>

            <SectionHeader title="Micromarket" />

            <ChartCard
                title="WoW Qualified Leads by Micromarket"
                subtitle="Bucketed by the week the seller came in"
                height={360}
                empty={seriesEmpty(data.qualifiedLeadsByMicromarket)}>
                <WoWStackedBar
                    data={data.qualifiedLeadsByMicromarket}
                    seriesOrder={MICROMARKET_ORDER}
                    colorFor={colorFor}
                    allowPercentToggle
                    allowBiWeeklyToggle
                    pairFromFirstFullWeek
                    onSegmentClick={(p, k) => onWeekSegment(p, k, 'Qualified Seller Leads by Micromarket')}
                />
            </ChartCard>

            <ChartCard
                title="WoW Property Visits — Direct vs. CP"
                subtitle="Every qualifying property, split by the property's own Source (not the seller's)"
                height={360}
                empty={seriesEmpty(data.propertyVisitsByDirectCp)}>
                <WoWStackedBar
                    data={data.propertyVisitsByDirectCp}
                    seriesOrder={['Direct', 'Channel Partner']}
                    colorFor={colorFor}
                    allowPercentToggle
                    allowBiWeeklyToggle
                    pairFromFirstFullWeek
                    allowStatusFilter
                    onSegmentClick={(p, k) => onWeekSegment(p, k, 'Property Visits — Direct vs. CP')}
                />
            </ChartCard>

            <ChartCard
                title="Pre-Visit Pipeline by Micromarket"
                subtitle="Window = attribute basis lead creation time; Till Date = forever. New/Old scoped"
                height={420}
                empty={isPipelineEmpty(data.pipelineByMicromarketTillDate)}>
                <MicromarketStatusBar
                    data={data.pipelineByMicromarket}
                    tillDateData={data.pipelineByMicromarketTillDate}
                    colorFor={colorFor}
                    onSegmentClick={(p, k) => onMicromarketStatusSegment('Pre-Visit Pipeline', p, k)}
                />
            </ChartCard>

            <ChartCard
                title="Acq Pipeline by Micromarket"
                subtitle="Properties that have already visited. Window = attribute basis lead creation time; Till Date = forever. New/Old scoped"
                height={420}
                empty={isPipelineEmpty(data.acqPipelineByMicromarketTillDate)}>
                <MicromarketStatusBar
                    data={data.acqPipelineByMicromarket}
                    tillDateData={data.acqPipelineByMicromarketTillDate}
                    colorFor={colorFor}
                    onSegmentClick={(p, k) => onMicromarketStatusSegment('Acq Pipeline', p, k)}
                />
            </ChartCard>

            <ChartCard
                title="Post Visit TAT"
                subtitle="Time-windowed by each stage's own transition date, New/Old scoped"
                height={400}
                empty={data.postVisitTat.stages.every((p) => p.countNew === 0 && p.countOld === 0)}>
                <PostVisitTatBar data={data.postVisitTat} onBarClick={onPostVisitTatBar} />
            </ChartCard>

            <ChartCard
                title="Properties with Stalled Conversions"
                subtitle="Window = attribute basis lead creation time; Till Date = forever. New/Old scoped"
                height={420}
                empty={isPipelineEmpty(data.stalledConversionsByMicromarketTillDate)}>
                <MicromarketStatusBar
                    data={data.stalledConversionsByMicromarket}
                    tillDateData={data.stalledConversionsByMicromarketTillDate}
                    colorFor={colorFor}
                    onSegmentClick={(p, k) => onMicromarketStatusSegment('Stalled Conversions', p, k)}
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
