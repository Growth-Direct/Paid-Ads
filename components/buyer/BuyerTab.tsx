'use client'

import ChartCard from '@/components/shared/ChartCard'
import LeadListModal, { type ExtraInfo, type LeadListItem } from '@/components/shared/LeadListModal'
import SectionHeader from '@/components/shared/SectionHeader'
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
import { useMemo, useState } from 'react'
import CostWeekChart from './CostWeekChart'
import FilterBar from './FilterBar'
import FrtChart from './FrtChart'
import HouseWarmBar from './HouseWarmBar'
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
                title="Target vs Achieved"
                subtitle={
                    timeFiltered
                        ? 'QTD vs the selected time filter’s window; Last 2wk and Weekly Pace Needed always track the real quarter regardless of the filter'
                        : dimFiltered
                          ? 'Targets are prorated from the selected cells of the channel × micromarket grid'
                          : 'Quarter-to-date vs the full quarter, plus the last 2 complete Monday–Sunday IST weeks and how much is needed per week for the rest of the quarter to close the target.'
                }
                height="auto">
                <TwoWeekTable data={data.twoWeekTable} groups={BUYER_TWO_WEEK_GROUPS} />
                <SpendNote ingest={data.spendIngest} sheetName="Buyer" />
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
