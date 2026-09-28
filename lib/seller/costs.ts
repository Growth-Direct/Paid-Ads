import type { SellerFacts, SellerSpendFact } from './facts'
import type { SellerFilters } from './filters'
import { CLUSTER_TREE } from '@/lib/buyer/shared'

// Spend total for an arbitrary window, filtered the same way every other seller card is.
// Kept out of derive.ts (whose output is locked by a golden test against a fixture with no
// spend) even though its result feeds straight into the Target vs Achieved table's cost rows.
//
// Unlike sellers and products, a spend row carries nobody to attribute: it's a pre-aggregated
// day × channel × micromarket row from the growth team's sheet, so this just sums what matches
// the filters and window. No join, no dedupe.

export interface SellerSpendWindow {
    /** Spend matching the filters inside the window. */
    total: number
    /** Spend that matched every other filter but was dropped for having no micromarket, i.e.
     *  what a place filter costs you. Zero when no place filter is active. Reported so the UI
     *  can say so out loud: unallocated is ~20% of seller spend, and hiding it makes every
     *  filtered cost-per metric look cheaper than it really is. */
    excludedUnallocated: number
}

/** Collapses a source name to a comparison key: lowercased, non-alphanumerics stripped.
 *
 *  The sheet and Zoho spell the same source differently, and the source filter carries Zoho's
 *  spelling while a spend fact carries the sheet's. Measured on 2026-09-08: Zoho says
 *  `99 Acres`, the sheet says `99Acres` — one space, and ₹22,150 of real spend becomes
 *  invisible the moment someone filters to that source, with every cost-per row falling to a
 *  dash as though nothing had been spent. The other four line up today (`Meta`, `google_ads`,
 *  `Offline Branding`, `MagicBricks`/`Magicbricks`), but only by luck of casing.
 *
 *  Stripping punctuation and spaces is safe here because it never merges two sources that are
 *  actually distinct in this taxonomy: `Society Data`, `Society Data - WA Blast` and
 *  `Society Data - Cold Call` stay separate keys, and they map to different channels. */
function sourceKey(raw: string): string {
    return raw.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/** Micromarkets implied by the selected clusters. Uses CLUSTER_TREE directly rather than the
 *  buyer module's micromarketsForClusters(), which rewrites HABIBI to the single lumped row
 *  "Bangalore" for the BUYER target grid — the seller side carries Helsinki, Berlin and Hong
 *  Kong as their own micromarkets, so that alias would drop them. Same reasoning as
 *  lib/seller/options.ts's buildSellerClusterOptions. */
function micromarketsForSellerClusters(clusters: string[]): string[] {
    return clusters.flatMap((c) => CLUSTER_TREE[c] ?? [])
}

/** Dimension match, mirroring sellerMatches in filters.ts including both of its asymmetries:
 *
 *  - **Source narrows within channel, it doesn't widen.** Ticking a channel ticks its sources,
 *    so once sources are selected they carry the whole intent and the channel check is skipped.
 *  - **Never AND cluster against micromarket.** Ticking a cluster ticks its micromarkets, so
 *    once micromarkets are selected the cluster check is skipped.
 *
 *  Returns null for a row excluded only because it has no micromarket, so the caller can total
 *  that separately instead of losing it silently. */
function spendMatches(s: SellerSpendFact, f: SellerFilters, clusterMms: string[] | null): boolean | null {
    if (f.sources.length > 0) {
        // Compared on the normalised key, not the raw string — see sourceKey.
        if (!f.sources.some((sel) => sourceKey(sel) === sourceKey(s.rawSource))) return false
    } else if (f.channels.length > 0 && !f.channels.includes(s.channel)) {
        return false
    }

    const placeFiltered = f.micromarkets.length > 0 || (clusterMms !== null && clusterMms.length > 0)
    if (placeFiltered) {
        // Unallocated spend is counted in the unfiltered total but excluded under any place
        // filter: there is no basis to split "All MM" across micromarkets, and inventing one
        // would put money in markets that never saw it.
        if (!s.micromarket) return null
        const allowed = f.micromarkets.length > 0 ? f.micromarkets : (clusterMms ?? [])
        if (!allowed.includes(s.micromarket)) return false
    }

    return true
}

export function computeSellerSpendForWindow(
    facts: SellerFacts,
    filters: SellerFilters,
    windowStart: Date,
    windowEnd: Date
): SellerSpendWindow {
    const clusterMms = filters.clusters.length ? micromarketsForSellerClusters(filters.clusters) : null
    const startMs = windowStart.getTime()
    const endMs = windowEnd.getTime()
    const inWindow = (iso: string): boolean => {
        const t = new Date(iso).getTime()
        return !Number.isNaN(t) && t >= startMs && t < endMs
    }

    let total = 0
    let excludedUnallocated = 0
    for (const s of facts.spend) {
        if (!inWindow(s.date)) continue
        const match = spendMatches(s, filters, clusterMms)
        if (match === null) excludedUnallocated += s.spendInr
        else if (match) total += s.spendInr
    }
    return { total, excludedUnallocated }
}

/** A cost-per metric: null, never zero, whenever spend or the denominator is absent. A ₹0
 *  reads as free, which is the one wrong answer nobody double-checks. Mirrors
 *  lib/buyer/derive.ts's divRaw. */
export function costPer(spend: number, denominator: number): number | null {
    return spend > 0 && denominator > 0 ? spend / denominator : null
}
