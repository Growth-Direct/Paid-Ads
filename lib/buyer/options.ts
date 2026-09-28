import type { BuyerFacts } from './facts'
import { CLUSTER_TREE, VALID_CLUSTERS } from './shared'
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
