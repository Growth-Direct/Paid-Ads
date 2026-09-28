import type { BuyerFacts, LeadFact } from './facts'
import { ATTRIBUTION_NOT_APPLICABLE, ATTRIBUTION_UNMAPPED_PROPERTY, CLUSTER_TREE, VALID_CLUSTERS } from './shared'
import { CHANNELS } from './types'

// Filter options carry no counts. A count here would be computed over the loaded window
// rather than the selected range, so the moment someone narrows the dates it would
// disagree with the chart right behind it.
//
// The cluster tree is the one thing that cannot come from the data: Zoho holds cluster
// and micromarket as two unrelated multiselect picklists, so the nesting is transcribed
// from Knowledge/truva/truva-overview.md. Source values do come from the data, so the
// list reflects whatever Zoho actually returned for the loaded window.

export interface Option {
    id: string
    label: string
}

export interface OptionGroup extends Option {
    children: Option[]
}

export function buildClusterOptions(): OptionGroup[] {
    return [...VALID_CLUSTERS].map((cluster) => ({
        id: cluster,
        label: cluster,
        children: (CLUSTER_TREE[cluster] ?? []).map((mm) => ({ id: mm, label: mm })),
    }))
}

export function buildSourceOptions(facts: BuyerFacts): OptionGroup[] {
    // Raw Zoho values grouped under the channel our taxonomy maps them to. Anything
    // unmapped lands under Unmapped, which is how a new lead source announces itself.
    const rawByChannel = new Map<string, Set<string>>()
    for (const l of facts.leads) {
        if (!l.inPopulation) continue
        const set = rawByChannel.get(l.channel) ?? new Set<string>()
        set.add(l.rawSource || '(blank)')
        rawByChannel.set(l.channel, set)
    }

    return CHANNELS.filter((c) => rawByChannel.has(c)).map((channel) => ({
        id: channel,
        label: channel,
        children: [...(rawByChannel.get(channel) ?? new Set<string>())]
            .sort((a, b) => a.localeCompare(b))
            .map((raw) => ({ id: raw.toLowerCase(), label: raw })),
    }))
}

// Added 2026-09-23, for the Campaign/Ad Set/Ad/Property filter dropdowns. Flat lists, not
// grouped like Cluster/Source — there's no natural two-level grouping for a search box.
// `id` is the raw attributed value itself (not lowercased) since that's exactly what
// `lead.attributedCampaign`/etc. stores and what filters.ts compares against — unlike
// Source, whose `sources` filter deliberately lowercases.
function buildFlatOptions(facts: BuyerFacts, pick: (l: LeadFact) => string, blankLabel: string): Option[] {
    const values = new Set<string>()
    for (const l of facts.leads) {
        if (!l.inPopulation) continue
        values.add(pick(l) || blankLabel)
    }
    return [...values].sort((a, b) => a.localeCompare(b)).map((v) => ({ id: v, label: v }))
}

export function buildCampaignOptions(facts: BuyerFacts): Option[] {
    return buildFlatOptions(facts, (l) => l.attributedCampaign, ATTRIBUTION_NOT_APPLICABLE)
}

export function buildAdSetOptions(facts: BuyerFacts): Option[] {
    return buildFlatOptions(facts, (l) => l.attributedAdSet, ATTRIBUTION_NOT_APPLICABLE)
}

export function buildAdOptions(facts: BuyerFacts): Option[] {
    return buildFlatOptions(facts, (l) => l.attributedAd, ATTRIBUTION_NOT_APPLICABLE)
}

export function buildPropertyOptions(facts: BuyerFacts): Option[] {
    return buildFlatOptions(facts, (l) => l.attributedProperty, ATTRIBUTION_UNMAPPED_PROPERTY)
}
