import { CLUSTER_TREE, VALID_CLUSTERS } from '@/lib/buyer/shared'
import type { SellerFacts } from './facts'
import { SELLER_CHANNELS } from './types'

// Filter options for the seller tab, in the same nested shape the buyer tab uses: a
// cluster parent over its micromarkets, and a channel parent over the raw Seller_Source
// values that map to it. Options carry no counts — a count computed over the loaded window
// would disagree with the chart the moment the dates are narrowed.

export type { Option, OptionGroup } from '@/components/shared/FilterControls'
import type { OptionGroup } from '@/components/shared/FilterControls'

/** Cluster → micromarket nesting, transcribed from Knowledge/truva/truva-overview.md via
 *  the buyer module's CLUSTER_TREE. The 11 leaves are exactly the seller target grid's
 *  micromarkets.
 *
 *  Note this deliberately uses CLUSTER_TREE directly rather than the buyer module's
 *  micromarketsForClusters(), which rewrites HABIBI to the single lumped row "Bangalore"
 *  for the BUYER target grid. The seller grid carries Helsinki, Berlin and Hong Kong as
 *  their own rows, so applying that alias here would resolve a HABIBI pick to a
 *  non-existent seller row and zero its target. */
export function buildSellerClusterOptions(): OptionGroup[] {
    return [...VALID_CLUSTERS].map((cluster) => ({
        id: cluster,
        label: cluster,
        children: (CLUSTER_TREE[cluster] ?? []).map((mm) => ({ id: mm, label: mm })),
    }))
}

/** Channel → raw Seller_Source nesting, built from the loaded window so the list reflects
 *  whatever Zoho actually returned. Anything unrecognised sits under Unmapped, which is how
 *  a new seller source announces itself instead of vanishing.
 *
 *  Deliberately NOT restricted to `inPopulation` sellers (changed 2026-09-09, per an explicit
 *  growth-team request): a source whose every seller predates the current quarter — e.g.
 *  NoBroker, all of it 2025-dated — is still real 3P data sitting in `facts.sellers` as the
 *  Old cohort, and now that Visits/Conversions default to New+Old (see EMPTY_SELLER_FILTERS)
 *  that data is visible by default. Excluding it from the picker meant it could never be
 *  filtered on at all, even though it already counted everywhere else. */
export function buildSellerSourceOptions(facts: SellerFacts): OptionGroup[] {
    const rawByChannel = new Map<string, Set<string>>()
    for (const s of facts.sellers) {
        const set = rawByChannel.get(s.channel) ?? new Set<string>()
        set.add(s.rawSource || '(blank)')
        rawByChannel.set(s.channel, set)
    }

    return SELLER_CHANNELS.filter((c) => rawByChannel.has(c)).map((channel) => ({
        id: channel,
        label: channel,
        children: [...(rawByChannel.get(channel) ?? new Set<string>())]
            .sort((a, b) => a.localeCompare(b))
            .map((raw) => ({ id: raw.toLowerCase(), label: raw })),
    }))
}
