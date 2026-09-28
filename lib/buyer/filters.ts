import type { LeadFact, SoldBidFact, VisitFact } from './facts'

// An empty array means "no filter on this dimension", not "match nothing".
export interface Period {
    start: string
    end: string
}

export interface BuyerFilters {
    /** Selected periods. Empty falls back to the reporting quarter. More than one is
     *  allowed and they need not be adjacent — two quarters either side of a gap leave
     *  the gap out of the axis rather than filling it in. */
    periods: Period[]
    grain: 'week' | 'month'
    clusters: string[]
    micromarkets: string[]
    /** Channel groups: Paid Ads, 3P, Organic and so on. */
    channels: string[]
    /** Raw Zoho Lead_Source values, lowercased. Narrows within a channel. */
    sources: string[]
}

export const EMPTY_FILTERS: BuyerFilters = {
    periods: [],
    grain: 'week',
    clusters: [],
    micromarkets: [],
    channels: [],
    sources: [],
}

export function hasDimensionFilter(f: BuyerFilters): boolean {
    return f.clusters.length > 0 || f.micromarkets.length > 0 || f.channels.length > 0 || f.sources.length > 0
}

export function isFiltered(f: BuyerFilters): boolean {
    return hasDimensionFilter(f) || f.periods.length > 0
}

/** True when `iso` falls inside any selected period. No periods means no time filter. */
export function inPeriods(periods: Period[], d: Date): boolean {
    if (periods.length === 0) return true
    return periods.some((p) => d >= new Date(p.start) && d < new Date(p.end))
}

// Matching is count-in-both: a lead carrying two micromarkets matches a filter on
// either of them. It still only ever counts once, because the caller dedupes on the
// lead — selecting two clusters a lead belongs to does not count it twice.
const matchesList = (selected: string[], values: string[]): boolean =>
    selected.length === 0 || values.some((v) => selected.includes(v))

// A cluster selection means "this cluster's micromarkets" — the picker always selects a
// parent's children alongside it, so `micromarkets` already carries the whole intent.
// The two must NOT be ANDed on a lead: a lead's micromarket comes from UTM_Micromarket
// (or the LSH first touch) while its cluster comes from Truva_Cluster, and those disagree
// on roughly a third of records — measured 2026-09-02, GLAM Paid Ads for JAS 2026 had 996
// leads by micromarket but only 690 of them also carried Truva_Cluster = GLAM, so ANDing
// silently under-reported the cluster by 31%. Cluster still applies on its own (and still
// filters the live-house card, where the cluster sits on the property and is reliable).
export function leadMatches(lead: LeadFact, f: BuyerFilters): boolean {
    if (f.micromarkets.length === 0 && !matchesList(f.clusters, lead.clusters)) return false
    if (!matchesList(f.micromarkets, lead.micromarkets)) return false
    if (f.channels.length > 0 && !f.channels.includes(lead.channel)) return false
    if (f.sources.length > 0 && !f.sources.includes(lead.rawSource.toLowerCase())) return false
    return true
}

/** Visits carry the lead's cluster and channel, but the visit's own micromarket is the
 *  one on the event — where the buyer actually went, which is the honest thing to filter
 *  a visit by. The lead's micromarkets are its stated interest, not its movements. */
export function visitMatches(visit: VisitFact, lead: LeadFact | undefined, f: BuyerFilters): boolean {
    // Same cluster/micromarket rule as leadMatches above — see the note there.
    if (f.micromarkets.length === 0 && !matchesList(f.clusters, visit.leadClusters)) return false
    if (f.micromarkets.length > 0 && !f.micromarkets.includes(visit.eventMicromarket)) return false
    if (f.channels.length > 0 && !f.channels.includes(visit.channel)) return false
    if (f.sources.length > 0 && !f.sources.includes((lead?.rawSource ?? '').toLowerCase())) return false
    return true
}

/** A sold property answers the filter bar through its BUYER's dimensions, which
 *  SoldBidFact carries directly rather than via a LeadFact — a Channel-Partner buyer has no
 *  LeadFact to look up. Same cluster/micromarket rule as leadMatches (never ANDed; see the
 *  note there), and the same count-in-both behaviour for a buyer carrying two micromarkets.
 *
 *  A buyer whose source is excluded from the population has `channel: null`, so any channel
 *  filter correctly leaves the sale out; with no channel filter it still counts, which is
 *  what makes the unfiltered tile a true "everything we sold" total. */
export function soldBidMatches(bid: SoldBidFact, f: BuyerFilters): boolean {
    if (f.micromarkets.length === 0 && !matchesList(f.clusters, bid.clusters)) return false
    if (!matchesList(f.micromarkets, bid.micromarkets)) return false
    if (f.channels.length > 0 && (bid.channel === null || !f.channels.includes(bid.channel))) return false
    if (f.sources.length > 0 && !f.sources.includes(bid.rawSource.trim().toLowerCase())) return false
    return true
}
