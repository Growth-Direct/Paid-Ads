'use client'

import type { BuyerFilters } from '@/lib/buyer/filters'
import type { Option, OptionGroup } from '@/lib/buyer/options'
import { type TimeRange, customRange, fromDateInput, isCustom, toDateInput } from '@/lib/buyer/timePresets'
import {
    Dropdown,
    MONO,
    NestedList,
    Pill,
    SectionLabel,
    dateInputStyle,
} from '@/components/shared/FilterControls'
import { SearchSelect } from '@/components/shared/SearchSelect'
import { useEffect, useState } from 'react'

export default function FilterBar({
    filters,
    onChange,
    clusterOptions,
    sourceOptions,
    campaignOptions,
    adSetOptions,
    adOptions,
    propertyOptions,
    quarters,
    months,
    periods,
    onPeriods,
    defaultLabel,
    loading,
}: {
    filters: BuyerFilters
    onChange: (next: BuyerFilters) => void
    clusterOptions: OptionGroup[]
    sourceOptions: OptionGroup[]
    campaignOptions: Option[]
    adSetOptions: Option[]
    adOptions: Option[]
    propertyOptions: Option[]
    quarters: TimeRange[]
    months: TimeRange[]
    periods: TimeRange[]
    onPeriods: (p: TimeRange[]) => void
    defaultLabel: string
    loading: boolean
}) {
    // Mirror an active custom range back into the inputs, so the selected dates are
    // visible and editable rather than sitting behind an opaque "Custom" chip.
    const active = periods.find(isCustom)
    const [customStart, setCustomStart] = useState(() => (active ? toDateInput(active.start, new Date()) : ''))
    const [customEnd, setCustomEnd] = useState(() =>
        active ? toDateInput(new Date(new Date(active.end!).getTime() - 1).toISOString(), new Date()) : ''
    )
    useEffect(() => {
        if (!active) return
        setCustomStart(toDateInput(active.start, new Date()))
        setCustomEnd(toDateInput(new Date(new Date(active.end!).getTime() - 1).toISOString(), new Date()))
    }, [active?.id])

    const selectedIds = periods.map((p) => p.id)
    const togglePeriod = (r: TimeRange) =>
        onPeriods(
            selectedIds.includes(r.id)
                ? periods.filter((p) => p.id !== r.id)
                : [...periods.filter((p) => !p.id.startsWith('custom-')), r]
        )

    const timeSummary =
        periods.length === 0
            ? defaultLabel
            : periods.length === 1
              ? periods[0]!.label
              : `${periods.length} periods`

    const anyActive =
        filters.clusters.length > 0 ||
        filters.micromarkets.length > 0 ||
        filters.channels.length > 0 ||
        filters.sources.length > 0 ||
        filters.campaigns.length > 0 ||
        filters.adSets.length > 0 ||
        filters.ads.length > 0 ||
        filters.properties.length > 0 ||
        periods.length > 0

    const attrCount = filters.campaigns.length + filters.adSets.length + filters.ads.length + filters.properties.length
    const attrSummary = attrCount === 0 ? 'All' : `${attrCount} selected`

    const mmSummary =
        filters.micromarkets.length === 0
            ? 'All'
            : filters.clusters.length > 0 && filters.micromarkets.length > 2
              ? `${filters.clusters.join(', ')}${filters.clusters.length ? '' : ''}`
              : filters.micromarkets.length <= 2
                ? filters.micromarkets.join(', ')
                : `${filters.micromarkets.length} selected`

    const srcSummary =
        filters.sources.length === 0
            ? 'All'
            : filters.channels.length === 1 && filters.channels.length * 1 > 0
              ? filters.channels[0]!
              : filters.channels.length > 1
                ? `${filters.channels.length} groups`
                : `${filters.sources.length} selected`

    return (
        <div
            style={{
                position: 'sticky',
                top: 65,
                zIndex: 45,
                background: '#FFFFFF',
                margin: '0 -40px',
                padding: '14px 40px',
                borderBottom: '1px solid #CCCCCC',
            }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <Dropdown
                label="Time"
                summary={timeSummary + (loading ? ' …' : '')}
                active={periods.length > 0}
                width={340}
                footer={
                    <div style={{ display: 'flex', gap: 6 }}>
                        {(['week', 'month'] as const).map((g) => (
                            <button
                                key={g}
                                onClick={() => onChange({ ...filters, grain: g })}
                                style={{
                                    flex: 1,
                                    padding: '6px 8px',
                                    borderRadius: 6,
                                    border: `1px solid ${filters.grain === g ? '#0067FF' : '#CCCCCC'}`,
                                    background: filters.grain === g ? '#E6F0FF' : 'transparent',
                                    color: filters.grain === g ? '#0067FF' : '#333333',
                                    fontFamily: MONO,
                                    fontSize: 11,
                                    cursor: 'pointer',
                                }}>
                                by {g}
                            </button>
                        ))}
                    </div>
                }>
                <SectionLabel>Custom range</SectionLabel>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '2px 8px 10px' }}>
                    <input
                        type="date"
                        value={customStart}
                        onChange={(e) => setCustomStart(e.target.value)}
                        style={dateInputStyle}
                    />
                    <span style={{ color: '#666666', fontSize: 11 }}>to</span>
                    <input
                        type="date"
                        value={customEnd}
                        onChange={(e) => setCustomEnd(e.target.value)}
                        style={dateInputStyle}
                    />
                    <button
                        disabled={!customStart || !customEnd || customStart >= customEnd}
                        onClick={() =>
                            onPeriods([
                                customRange(
                                    fromDateInput(customStart),
                                    // the picker's end date is inclusive; the period is not
                                    new Date(new Date(fromDateInput(customEnd)).getTime() + 86400000).toISOString()
                                ),
                            ])
                        }
                        style={{
                            padding: '6px 10px',
                            borderRadius: 6,
                            border: 'none',
                            background: customStart && customEnd && customStart < customEnd ? '#0067FF' : '#E5E5E5',
                            color: '#fff',
                            fontFamily: MONO,
                            fontSize: 11,
                            cursor: customStart && customEnd && customStart < customEnd ? 'pointer' : 'not-allowed',
                        }}>
                        Apply
                    </button>
                </div>

                <SectionLabel>Quarters</SectionLabel>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '2px 8px 10px' }}>
                    {quarters.map((q) => (
                        <Pill
                            key={q.id}
                            label={q.label}
                            selected={selectedIds.includes(q.id)}
                            onClick={() => togglePeriod(q)}
                        />
                    ))}
                </div>

                <SectionLabel>Months</SectionLabel>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '2px 8px 4px' }}>
                    {months.map((m) => (
                        <Pill
                            key={m.id}
                            label={m.label}
                            selected={selectedIds.includes(m.id)}
                            onClick={() => togglePeriod(m)}
                        />
                    ))}
                </div>
            </Dropdown>

            <Dropdown label="Cluster / MM" summary={mmSummary} active={filters.micromarkets.length > 0}>
                <NestedList
                    groups={clusterOptions}
                    selectedParents={filters.clusters}
                    selectedChildren={filters.micromarkets}
                    onChange={(clusters, micromarkets) => onChange({ ...filters, clusters, micromarkets })}
                />
            </Dropdown>

            <Dropdown label="Source" summary={srcSummary} active={filters.sources.length > 0}>
                <NestedList
                    groups={sourceOptions}
                    selectedParents={filters.channels}
                    selectedChildren={filters.sources}
                    onChange={(channels, sources) => onChange({ ...filters, channels, sources })}
                />
            </Dropdown>

            <Dropdown label="Attribution" summary={attrSummary} active={attrCount > 0} width={300}>
                <SearchSelect
                    label="Campaign"
                    options={campaignOptions}
                    selected={filters.campaigns}
                    onChange={(campaigns) => onChange({ ...filters, campaigns })}
                />
                <SearchSelect
                    label="Ad Set"
                    options={adSetOptions}
                    selected={filters.adSets}
                    onChange={(adSets) => onChange({ ...filters, adSets })}
                />
                <SearchSelect label="Ad" options={adOptions} selected={filters.ads} onChange={(ads) => onChange({ ...filters, ads })} />
                <SearchSelect
                    label="Property"
                    options={propertyOptions}
                    selected={filters.properties}
                    onChange={(properties) => onChange({ ...filters, properties })}
                />
            </Dropdown>

            {anyActive && (
                <button
                    onClick={() => {
                        onPeriods([])
                        onChange({
                            ...filters,
                            clusters: [],
                            micromarkets: [],
                            channels: [],
                            sources: [],
                            campaigns: [],
                            adSets: [],
                            ads: [],
                            properties: [],
                            grain: 'week',
                        })
                    }}
                    style={{
                        padding: '7px 11px',
                        borderRadius: 8,
                        border: '1px solid transparent',
                        background: 'transparent',
                        color: '#333333',
                        fontFamily: MONO,
                        fontSize: 11.5,
                        cursor: 'pointer',
                        textDecoration: 'underline',
                    }}>
                    Clear all
                </button>
            )}
            </div>
        </div>
    )
}
