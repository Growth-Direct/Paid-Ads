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
import { SELLER_PRIMARY_METRICS, type ClusterPipelinePoint, type WeekSeriesPoint } from '@/lib/seller/types'
import { useMemo, useState } from 'react'
import ClusterPipelineBar from './ClusterPipelineBar'
import MicromarketBulletBar from './MicromarketBulletBar'
import { CHANNEL_ORDER, MICROMARKET_ORDER, STATUS_ORDER, colorFor } from './palette'
import OverallFunnel from './OverallFunnel'
import SellerFilterBar from './SellerFilterBar'

function clusterOf(micromarket: string): string {
    return MICROMARKET_TO_CLUSTER.get(micromarket) ?? 'Unknown'
}
import SpendNote from '@/components/shared/SpendNote'

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
                subtitle="QTD follows the selected time filter; Last 2wk and Weekly Pace Needed always track the real quarter regardless of the filter"
                height="auto">
                <TwoWeekTable data={data.targetVsAchieved} primaryMetrics={SELLER_PRIMARY_METRICS} groups={SELLER_TWO_WEEK_GROUPS} />
                <SpendNote ingest={data.spendIngest} sheetName="Seller" excludedUnallocated={data.spendExcludedUnallocated} />
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
