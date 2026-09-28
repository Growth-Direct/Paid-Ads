import type { SellerFact } from './facts'

// An empty array means "no filter on this dimension", not "match nothing".
export interface Period {
    start: string
    end: string
}

export type Scope = 'New' | 'Old'

export interface SellerFilters {
    /** Selected periods. Empty falls back to the seller reporting quarter. */
    periods: Period[]
    grain: 'week' | 'month'
    /** Selected clusters, the parents of the micromarket picker. */
    clusters: string[]
    /** Selected micromarkets (Truva_Micromarket values). */
    micromarkets: string[]
    /** Selected channels (channel_clean values), the parents of the source picker. */
    channels: string[]
    /** Selected raw Seller_Source values, lowercased. */
    sources: string[]
    /** Which visit cohorts to count: New (seller created in-quarter), Old, or both.
     *  Default is both (changed 2026-09-09, per an explicit growth-team request — the Metabase
     *  pill defaults to New only, but this dashboard now opens on the combined view). */
    visitScope: Scope[]
    /** Which conversion cohorts to count. Default both — see visitScope. */
    conversionScope: Scope[]
}

export const EMPTY_SELLER_FILTERS: SellerFilters = {
    periods: [],
    grain: 'week',
    clusters: [],
    micromarkets: [],
    channels: [],
    sources: [],
    visitScope: ['New', 'Old'],
    conversionScope: ['New', 'Old'],
}

export function hasDimensionFilter(f: SellerFilters): boolean {
    return f.micromarkets.length > 0 || f.channels.length > 0 || f.sources.length > 0 || f.clusters.length > 0
}

/** The cluster/micromarket half of sellerMatches, standalone so a caller with no SellerFact of
 *  its own (Channel Partner sellers, dropped from the main population before ever becoming one —
 *  see lib/seller/derive.ts's computeChannelPartnerConversions) can still apply the same rule.
 *
 *  **Never AND cluster against micromarket.** Truva_Cluster and Truva_Micromarket are unrelated
 *  Zoho picklists that disagree on many records, and ticking a cluster in the picker already
 *  ticks its micromarkets — so once micromarkets are selected they carry the whole intent and
 *  the cluster check is skipped. Micromarket is count-in-both: carrying two micromarkets
 *  matches either. */
export function placeMatches(micromarkets: string[], clusters: string[], f: SellerFilters): boolean {
    if (f.micromarkets.length > 0) return micromarkets.some((m) => f.micromarkets.includes(m))
    if (f.clusters.length > 0) return clusters.some((c) => f.clusters.includes(c))
    return true
}

/** Matches a seller against the cluster/micromarket and channel/source dimensions. Scope
 *  (New/Old) is not a seller property — it is applied cohort-by-cohort in derive.ts.
 *
 *  Source narrows within channel, it doesn't widen: ticking a channel ticks its sources, so the
 *  source list carries the intent; the channel check is skipped whenever sources are selected. */
export function sellerMatches(seller: SellerFact, f: SellerFilters): boolean {
    if (!sellerMatchesChannel(seller, f)) return false
    return placeMatches(seller.micromarkets, seller.clusters, f)
}

/** Just the channel/source half of sellerMatches — for a caller that buckets BY micromarket
 *  itself (Micromarket Analysis) rather than filtering on it, so the place dimension must be
 *  skipped rather than re-applied. */
export function sellerMatchesChannel(seller: SellerFact, f: SellerFilters): boolean {
    if (f.sources.length > 0) {
        return f.sources.includes((seller.rawSource || '(blank)').toLowerCase())
    }
    return f.channels.length === 0 || f.channels.includes(seller.channel)
}
