import type { SpendOrigin } from '@/lib/spend/origin'
import { SELLER_QUALIFIED_STATUSES, type SellerChannel } from './types'

// The seller fact table. One row per Seller record and one per seller-linked Product
// (the visit/conversion carrier). Facts are already filtered for eligibility (VCV test
// cluster, excluded sources), so nothing downstream re-applies those rules.
//
// Sellers are NOT merged on phone — each Zoho record keeps its own row so drill-downs link
// to the real record. Instead each row carries dedupKey/isPrimary and derive.ts counts on
// those, exactly like the buyer LeadFact.

export interface SellerFact {
    id: string
    name: string
    /** Last 10 digits of Phone_Number, or '' when there aren't 10. */
    phoneKey: string
    /** phoneKey, or `id:<id>` when there is no usable phone so the seller stands alone. */
    dedupKey: string
    /** Exactly one seller per dedupKey group is primary — most-advanced Call_Status wins,
     *  earliest Created_Time breaks ties. Counting cards filter on this. */
    isPrimary: boolean
    /** True when the seller was returned by the window query AND created inside the window.
     *  Old-cohort sellers, pulled in only to resolve old visits/conversions, are false. */
    inPopulation: boolean
    /** Raw Zoho Call_Status. */
    callStatusRaw: string
    /** Call_Status with telephony junk folded into "Attempted to Contact", blank → "Blank". */
    callStatusFolded: string
    /** Raw Call_Status is in the qualified set. */
    isQualified: boolean
    /** Reason_for_Lead_Drop, trimmed — null when blank (folds to "No Reason Given" downstream,
     *  never silently dropped). Only meaningful when callStatusFolded is 'Not qualified', but
     *  carried unconditionally like every other raw field. */
    reasonForDrop: string | null
    /** Truva_Qualified, a SEPARATE multiselect field from Reason_for_Lead_Drop — sub-reasons
     *  for the "Not Truva approved" bucket specifically (e.g. why a seller wasn't Truva
     *  qualified). A seller can carry more than one. Carried unconditionally like every other
     *  raw field; only meaningful when reasonForDrop is 'Not Truva approved'. */
    notTruvaQualifiedReasons: string[]
    /** Raw Zoho Seller_Source, kept for reference. */
    rawSource: string
    channel: SellerChannel
    /** Every micromarket on the record (Truva_Micromarket, split on ';'). */
    micromarkets: string[]
    /** Every cluster on the record. Seller cluster data is poor; carried but not filtered on. */
    clusters: string[]
    createdAt: string
    /** EE_Response_Time — when the team first responded, or null if not yet. For FRT
     *  (First Response Time), mirroring lib/buyer/derive.ts's own FRT block exactly: the
     *  Sellers module carries the identical field names Leads does. */
    responseAt: string | null
    /** Acefone_Lead_ID — FRT is only meaningful for a seller that came through the calling
     *  system at all, same gate Buyer's FRT uses. */
    acefoneLeadId: string | null
}

// One row per seller-linked Product carrying only what the visit/conversion logic needs.
// VCV-cluster products are dropped upstream, so nothing here re-checks the cluster.
export interface SellerProductFact {
    /** The linked Seller's id (Products."Seller".id). */
    sellerId: string
    /** Raw Zoho Acq_Status. Drives the three-case visit logic. */
    acqStatus: string
    /** Visit_Date (YYYY-MM-DD), or null. */
    visitDate: string | null
    /** Seller_MoU_Signing_Date (YYYY-MM-DD), or null. */
    mouSigningDate: string | null
    /** The property's own Created_Time — distinct from its seller's, and from Visit_Date.
     *  Used only by the "Qualified Properties by Source" WoW chart, which attributes each
     *  property to the week it was itself created, not the week its seller was. */
    createdAt: string
    /** Products.Min_Guarantee — the seller's minimum guarantee price (₹). Summed over the same
     *  MoU-Signed, in-window population as conversions for the Target vs Achieved table's "GMV
     *  Acquired" row. 0 when null/missing so a summation never needs a null check. */
    minGuarantee: number
    /** Products.Source — the PROPERTY's own source, independent of the seller's own
     *  Seller_Source. Verified live 2026-09-24: 25 distinct values (Meta, 99 Acres, Offline
     *  Branding, ...), with 'Channel Partner' the single largest at ~2,900 of ~4,300 rows. Used
     *  only to split "WoW Property Visits — Direct vs. CP": Direct = anything other than
     *  'Channel Partner'. */
    source: string
    /** Products.Valuation_Request_date (YYYY-MM-DD), or null — the property's transition date
     *  into Acq_Status 'Sent for Valuation'. Verified live 2026-09-24, 36/36 populated for that
     *  status. Drives Post Visit TAT's time-windowing and its Visit Completed -> Sent for
     *  Valuation average-TAT connector. */
    valuationRequestDate: string | null
    /** Products.Pricing_completion_date (YYYY-MM-DD), or null — the property's transition date
     *  into Acq_Status 'Valuation Completed'. Verified live 2026-09-24, 43/43 populated for that
     *  status. */
    pricingCompletionDate: string | null
    /** Products.Offer_Date (YYYY-MM-DD), or null — the property's transition date into
     *  Acq_Status 'Offer Made to Seller' specifically (not Offer Made to Broker). Verified live
     *  2026-09-24, 24/24 populated for that status. */
    offerDate: string | null
}

// Ad/3P/offline spend for the SELLER tab, pre-aggregated from the growth team's manually
// filled "Seller side spends" tab to one row per (day × channel × micromarket × raw source).
// Campaign/adset/ad are dropped: nothing consumes them, and the sheet's spend is only
// meaningful at this grain anyway.
export interface SellerSpendFact {
    /** Full IST-midnight ISO instant (e.g. 2026-07-05T00:00:00+05:30), not a YYYY-MM-DD key —
     *  costs.ts parses it with `new Date(iso)`. */
    date: string
    channel: SellerChannel
    /** A valid seller micromarket, or null for the unallocated bucket. Null covers three
     *  distinct sheet values, all meaning "not attributable to one micromarket": the explicit
     *  `All MM`, a blank cell, and a cluster name typed into the micromarket column. */
    micromarket: string | null
    /** The sheet's UTM Source, lowercased, so a nested source filter narrows the spend
     *  numerator too and not just the seller denominator. */
    rawSource: string
    spendInr: number
    impressions: number
    clicks: number
}

// Surfaced in the payload and rendered under the Target vs Achieved table, so the growth team
// can debug the sheet they fill in themselves.
export interface SellerSpendIngest {
    status: 'ok' | 'unavailable' | 'schema-error'
    /** Which source produced these facts. Named in the note the growth team reads. */
    origin: SpendOrigin
    /** Set for 'unavailable' and 'schema-error'; shown verbatim. */
    error: string | null
    rowsRead: number
    rowsKept: number
    droppedBadDate: number
    droppedBadSpend: number
    /** Which slash-date order the build PROVED from the data. The seller tab is D/M, the
     *  OPPOSITE of the buyer tab's M/D — carried here so a silent flip is visible rather than
     *  quietly transposing every day and month. */
    slashOrder: 'MDY' | 'DMY' | null
    /** Rupees carrying no micromarket, and therefore dropped by any place filter. Rendered:
     *  it is ~20% of seller spend, and hiding it makes every filtered cost-per metric look
     *  cheaper than it is. */
    unallocatedInr: number
    /** Distinct raw values that fell through, capped for display. */
    unmappedSources: string[]
    unknownMicromarkets: string[]
    /** When the snapshot was built, so the UI can say how fresh spend is. */
    builtAt: string | null
}

export interface SellerFacts {
    sellers: SellerFact[]
    /** EVERY seller-linked property, any Acq_Status — unfiltered by status, so derive.ts can
     *  classify qualifying/pipeline/any-status views all from this one array. */
    products: SellerProductFact[]
    /** Properties belonging to Channel Partner-sourced sellers — excluded from `sellers`/
     *  `products` (and therefore every other metric on the dashboard) since Channel Partner is
     *  outside the DRR population, but kept here so the Overall Funnel's "Total Conversions
     *  (Channel Partner + Direct)" float box can add their conversions back in without a
     *  second Zoho fetch (the raw rows are already pulled by the unconditional Sellers/Products
     *  queries in aggregate.ts — this is just the subset `products` drops). */
    channelPartnerProducts: SellerProductFact[]
    /** Truva_Micromarket/Truva_Cluster for each Channel Partner-sourced seller behind
     *  channelPartnerProducts, keyed by seller id. These sellers never get a SellerFact of their
     *  own (dropped by eligibility before that point), but Zoho's place fields are already
     *  fetched for every seller regardless of source — carried here so the Overall Funnel's
     *  Total Conversions float box can honour the Micromarket/Cluster filter instead of always
     *  counting every Channel Partner conversion flat. A plain Record, not a Map: this whole
     *  fact table rides to the browser as JSON (SellerTab calls deriveReport client-side on
     *  every filter change, per the comment below) and a Map serialises to `{}`. */
    channelPartnerPlaces: Record<string, { micromarkets: string[]; clusters: string[] }>
    /** Pre-aggregated spend from the committed snapshot, not Zoho. Small enough to ride along
     *  in the fact table and be re-filtered in the browser like every other dimension. */
    spend: SellerSpendFact[]
    spendIngest: SellerSpendIngest
    /** Window the facts were fetched for. A filter range outside this needs a refetch. */
    windowStart: string
    windowEnd: string
}

/** Last 10 digits of a phone, or '' when there aren't 10. Strips +91, spaces and the
 *  formatting the CRM accumulates, so the same person entered two ways collapses to one key. */
export function sellerPhoneKey(...raw: Array<string | undefined | null>): string {
    for (const v of raw) {
        const digits = (v ?? '').replace(/\D/g, '')
        if (digits.length >= 10) return digits.slice(-10)
    }
    return ''
}

// Rank of a Call_Status for electing the survivor when several sellers share a phone: the
// record that got furthest wins. Qualified set is highest; telephony junk / dead states are
// lowest; "Not qualified" sits above junk but below anything still in progress; everything
// else (being worked) is in the middle. Ties break on earliest Created_Time, so a re-enquiry
// never re-dates an old seller into the current quarter.
//
// Shares SELLER_QUALIFIED_STATUSES with shared.ts's isSellerQualified rather than its own
// literal, so the qualified-set update on 2026-09-07 (Already sold the flat dropped, Prospect
// added) can't drift between "is this seller qualified" and "which record wins the dedupe".
const QUALIFIED = new Set<string>(SELLER_QUALIFIED_STATUSES)
const DEAD = new Set([
    'Network Issue',
    'Call Rejected',
    'Open - Disconnected',
    'Inactive',
    'Invalid number',
    '',
])
export function sellerStatusRank(status: string): number {
    const s = (status ?? '').trim()
    if (QUALIFIED.has(s)) return 4
    if (DEAD.has(s)) return 1
    if (s === 'Not qualified') return 2
    return 3
}

/** Fills in dedupKey and elects one isPrimary per phone group, in place. Must run AFTER
 *  every exclusion, so an excluded seller can never be elected the survivor of its group.
 *  Mirrors the buyer assignLeadIdentity. */
export function assignSellerIdentity(sellers: SellerFact[]): void {
    for (const s of sellers) {
        s.dedupKey = s.phoneKey || `id:${s.id}`
        s.isPrimary = false
    }
    const byKey = new Map<string, SellerFact[]>()
    for (const s of sellers) {
        const group = byKey.get(s.dedupKey)
        if (group) group.push(s)
        else byKey.set(s.dedupKey, [s])
    }
    for (const group of byKey.values()) {
        let winner = group[0]!
        for (const s of group.slice(1)) {
            const better =
                sellerStatusRank(s.callStatusRaw) !== sellerStatusRank(winner.callStatusRaw)
                    ? sellerStatusRank(s.callStatusRaw) > sellerStatusRank(winner.callStatusRaw)
                    : s.createdAt < winner.createdAt
            if (better) winner = s
        }
        winner.isPrimary = true
    }
}
