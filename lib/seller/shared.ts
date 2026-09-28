import { CLUSTER_TREE } from '@/lib/buyer/shared'
import { SELLER_MICROMARKETS, SELLER_QUALIFIED_STATUSES, type SellerChannel } from './types'

// Seller channel/status normalisation and the qualified/junk sets. The IST and week
// helpers (mondayOfIST, buildBuckets, fetchSlices, toZohoDateTime, dateKey, quarter*) are
// timezone/bucketing maths with no buyer semantics, so they are imported from the buyer
// module rather than duplicated — re-exported here so seller code has one import surface.
export {
    IST_OFFSET_MS,
    buildBuckets,
    dateKey,
    fetchSlices,
    mondayOfIST,
    quarterEndOfIST,
    quarterStartOfIST,
    toList,
    toZohoDateTime,
    weekLabel,
} from '@/lib/buyer/shared'
export type { Buckets, Period } from '@/lib/buyer/shared'

// Seller channel taxonomy, transcribed verbatim from the Metabase "Seller Weekly - Direct"
// channel_clean CASE (card 739 and friends). Lowercased keys, matched case-insensitively.
// Diverges from the buyer map in three ways the DRR is explicit about:
//   - NoBroker folds into 3P here (buyer excludes it entirely).
//   - `society data` (bare) → Cold Outreach here (buyer put it in Society WA & Mgmt Apps).
//   - Cold Outreach is a seller-only channel (society data cold-call / AI-calling / bare).
export const SELLER_CHANNEL_MAP: Record<string, SellerChannel> = {
    meta: 'Paid Ads',
    'google ads': 'Paid Ads',
    google_ads: 'Paid Ads',
    linkedin: 'Paid Ads',
    'paid ads (unattributed)': 'Paid Ads',
    'society data - meta': 'Paid Ads',
    '99 acres': '3P',
    '99acres': '3P',
    housing: '3P',
    'housing.com': '3P',
    magicbricks: '3P',
    nobroker: '3P',
    mygate: '3P',
    squareyards: '3P',
    'square yards': '3P',
    'offline branding': 'Offline Branding',
    'society wa groups': 'Society WA Groups & Management Apps',
    'society whatsapp': 'Society WA Groups & Management Apps',
    'society management app': 'Society WA Groups & Management Apps',
    'society management apps': 'Society WA Groups & Management Apps',
    'society data - wa blast': 'Society WA Groups & Management Apps',
    website: 'Organic',
    instagram: 'Organic',
    ig: 'Organic',
    whatsapp: 'Organic',
    organic: 'Organic',
    'word of mouth': 'Referral & WOM',
    referral: 'Referral & WOM',
    'seller referral': 'Referral & WOM',
    'society data - cold call': 'Cold Outreach',
    'society data - ai calling': 'Cold Outreach',
    'society data': 'Cold Outreach',
}

// Sources dropped from the seller DRR population entirely, matching the Metabase
// `lower("Seller_Source") NOT IN ('channel partner','society partners')` filter. Null-safe:
// a blank source is NOT excluded — it survives as 'Unmapped', exactly as Metabase keeps it.
export const EXCLUDED_SELLER_SOURCES = new Set(['channel partner', 'society partners'])

/** Channel for a raw Seller_Source. Returns null only for an EXCLUDED source (out of the
 *  DRR population). A blank source is 'Unmapped', not excluded — matching Metabase, where a
 *  blank Seller_Source falls through the channel CASE to 'Unmapped' and is never filtered
 *  out. Any unrecognised value is 'Unmapped' too, so a new source announces itself. */
export function mapSellerChannel(source: string | null | undefined): SellerChannel | null {
    const lower = (source ?? '').trim().toLowerCase()
    if (!lower) return 'Unmapped'
    if (EXCLUDED_SELLER_SOURCES.has(lower)) return null
    return SELLER_CHANNEL_MAP[lower] ?? 'Unmapped'
}

// Telephony dispositions the calling stack writes into Call_Status — real sellers someone
// failed to reach, folded into "Attempted to Contact" rather than dropped or shown raw.
// The seller set is narrower than the buyer's, per the DRR.
export const SELLER_TELEPHONY_JUNK_STATUSES = new Set(['Network Issue', 'Call Rejected', 'Open - Disconnected'])

/** Call_Status with telephony junk folded into "Attempted to Contact". A blank status folds
 *  to "Blank", matching the Metabase COALESCE(call_status,'Blank') on the by-status chart. */
export function foldSellerStatus(status: string | null | undefined): string {
    const s = (status ?? '').trim()
    if (!s) return 'Blank'
    return SELLER_TELEPHONY_JUNK_STATUSES.has(s) ? 'Attempted to Contact' : s
}

// Reverse of CLUSTER_TREE (micromarket -> cluster), built once. Shared by derive.ts (Visits
// in Pipeline by Cluster, Micromarket Analysis) and the WoW-by-micromarket chart component,
// which groups its tooltip by cluster the same way.
export const MICROMARKET_TO_CLUSTER = new Map<string, string>()
for (const [cluster, micromarkets] of Object.entries(CLUSTER_TREE)) {
    for (const mm of micromarkets) MICROMARKET_TO_CLUSTER.set(mm, cluster)
}

/** Which micromarkets a Cluster/MM filter selection implies, in canonical SELLER_MICROMARKETS
 *  order — micromarkets carry the whole intent when picked (NestedList ticks a cluster's
 *  children the moment its parent is), clusters only matter as a fallback, and nothing
 *  selected means all 11. Used by Micromarket Analysis to decide which bars/series to show;
 *  mirrors sellerMatches' own micromarkets-before-clusters precedence. */
export function micromarketsInScope(filters: { micromarkets: string[]; clusters: string[] }): string[] {
    if (filters.micromarkets.length) {
        const set = new Set(filters.micromarkets)
        return SELLER_MICROMARKETS.filter((mm) => set.has(mm))
    }
    if (filters.clusters.length) {
        const set = new Set(filters.clusters.flatMap((c) => CLUSTER_TREE[c] ?? []))
        return SELLER_MICROMARKETS.filter((mm) => set.has(mm))
    }
    return [...SELLER_MICROMARKETS]
}

const QUALIFIED = new Set<string>(SELLER_QUALIFIED_STATUSES)

/** True when the raw Call_Status is in the qualified set. Reads the raw value, not the
 *  folded one — folding only touches telephony junk, none of which is qualified. */
export function isSellerQualified(status: string | null | undefined): boolean {
    return QUALIFIED.has((status ?? '').trim())
}
