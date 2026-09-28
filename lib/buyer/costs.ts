import type { BuyerFacts, SpendFact } from './facts'
import type { BuyerFilters } from './filters'
import { micromarketsForClusters } from './shared'

// Spend total for an arbitrary window, filtered the same way every other card is. Kept
// out of derive.ts (whose output is locked by a golden test against a fixture with no
// spend data) even though its result now feeds directly into the Last 2-Week table's
// cost rows there.
//
// Unlike the leads/visits/conversions facts, spend carries no lead to attribute — it's
// a pre-aggregated day x channel x micromarket row from the growth team's spend sheet,
// so this just sums whatever matches the filters and window, no lead-level join.

function spendMatches(s: SpendFact, f: BuyerFilters, clusterMms: Set<string> | null): boolean {
    if (f.channels.length > 0 && !f.channels.includes(s.channel)) return false
    if (f.sources.length > 0 && !f.sources.includes(s.rawSource)) return false
    if (f.micromarkets.length > 0 || clusterMms) {
        if (!s.micromarket) return false // unallocated, excluded under a place filter
        const allowed = new Set<string>([...f.micromarkets, ...(clusterMms ?? [])])
        if (!allowed.has(s.micromarket)) return false
    }
    return true
}

export function computeSpendForWindow(
    facts: BuyerFacts,
    filters: BuyerFilters,
    windowStart: Date,
    windowEnd: Date
): number {
    const clusterMms = filters.clusters.length ? new Set(micromarketsForClusters(filters.clusters)) : null
    const inWindow = (iso: string): boolean => {
        const d = new Date(iso)
        return !Number.isNaN(d.getTime()) && d >= windowStart && d < windowEnd
    }

    let total = 0
    for (const s of facts.spend) {
        if (!inWindow(s.date)) continue
        if (!spendMatches(s, filters, clusterMms)) continue
        total += s.spendInr
    }
    return total
}

/** The complement of spendMatches's micromarket check: matches ONLY spend with no
 *  micromarket at all (a generic/cluster-level/AllMM campaign name — see
 *  micromarketFromCampaignName). Channel/source filters still apply, exactly as they do for
 *  named-micromarket spend. Backs the Budget Pacing "All MM" row — the growth team wants this
 *  money visible as its own category (2026-09-29), not silently missing from every
 *  by-micromarket cut. */
function unallocatedSpendMatches(s: SpendFact, f: BuyerFilters): boolean {
    if (f.channels.length > 0 && !f.channels.includes(s.channel)) return false
    if (f.sources.length > 0 && !f.sources.includes(s.rawSource)) return false
    return s.micromarket === null
}

export function computeUnallocatedSpendForWindow(
    facts: BuyerFacts,
    filters: BuyerFilters,
    windowStart: Date,
    windowEnd: Date
): number {
    const inWindow = (iso: string): boolean => {
        const d = new Date(iso)
        return !Number.isNaN(d.getTime()) && d >= windowStart && d < windowEnd
    }
    let total = 0
    for (const s of facts.spend) {
        if (!inWindow(s.date)) continue
        if (!unallocatedSpendMatches(s, filters)) continue
        total += s.spendInr
    }
    return total
}

// Same row-level filter as computeSpendForWindow, grouped into the same weekly buckets the
// WoW charts use, instead of summed over one window — backs the new WoW CPL/CPQL/CPV trend
// charts (derive.ts). `bucketOf` is the exact function `buildBuckets` (shared.ts) hands the
// rest of derive.ts, so a spend row lands in the same week a lead/visit created on the same
// date would.
export function computeSpendByWeek(
    facts: BuyerFacts,
    filters: BuyerFilters,
    bucketStarts: Date[],
    bucketOf: (iso: string) => number | undefined
): number[] {
    const clusterMms = filters.clusters.length ? new Set(micromarketsForClusters(filters.clusters)) : null
    const totals = bucketStarts.map(() => 0)
    for (const s of facts.spend) {
        const idx = bucketOf(s.date)
        if (idx === undefined) continue
        if (!spendMatches(s, filters, clusterMms)) continue
        totals[idx]! += s.spendInr
    }
    return totals
}
