import { fetchRecordsByIds, queryRecords } from '@/lib/crm'
import { dateKey, isVcv } from '@/lib/buyer/shared'
import { assignSellerIdentity, sellerPhoneKey, type SellerFact, type SellerFacts, type SellerProductFact } from './facts'
import { fetchSlices, foldSellerStatus, isSellerQualified, mapSellerChannel, toList, toZohoDateTime } from './shared'
import { loadSellerSpend } from './spend/source'
import {
    ACQ_ALWAYS_VISIT_STATUSES,
    ACQ_DATED_VISIT_STATUSES,
    ACQ_NEVER_VISIT_STATUSES,
    SELLER_QUARTER_END_ISO,
    SELLER_QUARTER_LABEL,
    SELLER_QUARTER_START_ISO,
} from './types'

// Every documented status, across all three cases — 'Attempted to Contact' and blank are
// deliberately NOT here, since they're a known "ignored" case, not unrecognised drift; the
// canary check below excludes them separately.
const KNOWN_ACQ_STATUSES = new Set<string>([...ACQ_NEVER_VISIT_STATUSES, ...ACQ_DATED_VISIT_STATUSES, ...ACQ_ALWAYS_VISIT_STATUSES])
const IGNORED_ACQ_STATUSES = new Set<string>(['Attempted to Contact'])

// Zoho fetching + fact-table construction for the seller tab. Every metric is computed in
// derive.ts, from facts alone. Mirrors lib/buyer/aggregate.ts (window-keyed cache, in-flight
// dedup, sequential COQL only).
//
// The Sellers name field is `Name`, NOT `Full_Name` — verified live 2026-09-02:
// `select id, Full_Name from Sellers` returns "column given seems to be invalid", while
// `Name` returns the seller's name. (Leads uses Full_Name; Sellers does not.) A wrong name
// field here errors the whole Sellers query, so don't change this without probing again.
const SELLER_NAME_FIELD = 'Name'

interface RawSeller {
    id: string
    Name?: string
    Phone_Number?: string
    Call_Status?: string
    Reason_for_Lead_Drop?: string
    Truva_Qualified?: string[] | string | null
    Seller_Source?: string
    Truva_Cluster?: string[] | string | null
    Truva_Micromarket?: string[] | string | null
    Created_Time?: string
    EE_Response_Time?: string | null
    Acefone_Lead_ID?: string | null
}
interface RawProduct {
    id: string
    Seller?: { id: string } | string | null
    Acq_Status?: string
    Visit_Date?: string | null
    Seller_MoU_Signing_Date?: string | null
    Truva_Cluster?: string[] | string | null
    Created_Time?: string
    Min_Guarantee?: number | null
    Source?: string | null
    // Post Visit TAT's per-stage transition dates — verified live 2026-09-24 via the Metabase
    // mirror (table 153): Valuation_Request_date (field_id t153-142, 36/36 populated for
    // Acq_Status = 'Sent for Valuation'), Pricing_completion_date (t153-143, 43/43 for
    // 'Valuation Completed'), Offer_Date (t153-139, 24/24 for 'Offer Made to Seller').
    // Visit_Date above already covers 'Visit Completed'.
    Valuation_Request_date?: string | null
    Pricing_completion_date?: string | null
    Offer_Date?: string | null
}

function productSellerId(p: RawProduct): string | null {
    if (!p.Seller) return null
    return typeof p.Seller === 'string' ? p.Seller : p.Seller.id
}

export interface SellerFactsResponse {
    cachedAt: string
    quarterStart: string
    quarterEnd: string
    quarterLabel: string
    windowStart: string
    windowEnd: string
    facts: SellerFacts
}

const CACHE_TTL_MS = 5 * 60 * 1000
const _cache = new Map<string, { data: SellerFactsResponse; ts: number }>()
const _inFlight = new Map<string, Promise<SellerFactsResponse>>()

export function bustSellerCache() {
    _cache.clear()
}

export async function fetchSellerFactsCached(windowStart: Date, windowEnd: Date): Promise<SellerFactsResponse> {
    const key = `${windowStart.toISOString()}|${windowEnd.toISOString()}`
    const hit = _cache.get(key)
    if (hit && Date.now() - hit.ts < CACHE_TTL_MS) return hit.data
    const running = _inFlight.get(key)
    if (running) return running

    const p = _build(windowStart, windowEnd)
        .then((data) => {
            _cache.set(key, { data, ts: Date.now() })
            return data
        })
        .finally(() => {
            _inFlight.delete(key)
        })
    _inFlight.set(key, p)
    return p
}

/** Fetches the window from Zoho and returns the seller fact table.
 *
 *  The Products read has no status filter at all and no date bound — New/Old is decided by
 *  the parent seller's creation quarter, so there's no date column to filter on, and every
 *  Acq_Status is needed somewhere downstream: qualifying-visit and pipeline classification in
 *  derive.ts, plus the Overall Funnel's "Qualified Properties" float box, which counts a
 *  Qualified seller's properties regardless of status. One unconditional fetch (~4.6k rows
 *  all-time) is simpler and safer than several targeted ones that each risk missing a status
 *  nobody's queried for yet.
 *
 *  Every read comes from growth's copy of the Zoho mirror (lib/crm.ts), with the filters the COQL
 *  reads had.
 *
 *  Sellers referenced by a property but created before the window are then fetched by id, so
 *  the Old cohort can be resolved. */
export async function fetchSellerFacts(windowStart: Date, windowEnd: Date): Promise<SellerFacts> {
    const sellerFields = [
        'id',
        SELLER_NAME_FIELD,
        'Phone_Number',
        'Call_Status',
        'Reason_for_Lead_Drop',
        'Truva_Qualified',
        'Seller_Source',
        'Truva_Cluster',
        'Truva_Micromarket',
        'Created_Time',
        'EE_Response_Time',
        'Acefone_Lead_ID',
    ]
    const sellersQ = (a: Date, b: Date) =>
        queryRecords('Sellers', sellerFields, [
            { field: 'Created_Time', op: 'gte', value: toZohoDateTime(a) },
            { field: 'Created_Time', op: 'lt', value: toZohoDateTime(b) },
        ])

    // 1) Window sellers (the quarter cohort / population). Sliced like the buyer leads fetch
    //    so a window wider than ~a quarter stays under the row cap; sequential, never concurrent.
    const slices = fetchSlices(windowStart, windowEnd)
    const windowSellers: RawSeller[] = []
    for (const [a, b] of slices) {
        const page = (await sellersQ(a, b).catch((e) => {
            throw new Error(`sellersQ failed for ${a.toISOString()}: ${e.message}`)
        })) as RawSeller[]
        windowSellers.push(...page)
    }
    const windowSellerIds = new Set(windowSellers.map((s) => s.id))

    const productFields = [
        'id',
        'Seller',
        'Acq_Status',
        'Visit_Date',
        'Seller_MoU_Signing_Date',
        'Truva_Cluster',
        'Created_Time',
        'Min_Guarantee',
        'Source',
        'Valuation_Request_date',
        'Pricing_completion_date',
        'Offer_Date',
    ]

    // 2) EVERY seller-linked property, any Acq_Status — no filter. See the doc comment above for
    //    why this one broad fetch beats several targeted ones.
    const rawAllProducts = (await queryRecords('Products', productFields).catch((e) => {
        throw new Error(`products-all failed: ${e.message}`)
    })) as RawProduct[]

    // Drop VCV-cluster products — the test cluster is excluded everywhere, null-safe so a
    // blank cluster survives.
    const rawProducts = rawAllProducts.filter((p) => !isVcv(p.Truva_Cluster))

    // 3) Sellers referenced by a property but created before the window, so absent from the
    //    window query. Fetched by id so the Old cohort can be resolved.
    const rawSellerById = new Map<string, RawSeller>(windowSellers.map((s) => [s.id, s]))
    const referenced = new Set<string>()
    for (const p of rawProducts) {
        const sid = productSellerId(p)
        if (sid && !rawSellerById.has(sid)) referenced.add(sid)
    }
    const referencedCount = referenced.size
    let patchedCount = 0
    if (referenced.size > 0) {
        const patched = (await fetchRecordsByIds('Sellers', sellerFields, [
            ...referenced,
        ])) as RawSeller[]
        patchedCount = patched.length
        for (const s of patched) rawSellerById.set(s.id, s)
    }

    // --- eligibility: VCV test cluster, and sources outside the DRR population ---
    const eligible = (s: RawSeller): boolean => !isVcv(s.Truva_Cluster) && mapSellerChannel(s.Seller_Source) !== null

    const inWindow = (iso: string | undefined): boolean => {
        if (!iso) return false
        const d = new Date(iso)
        return !Number.isNaN(d.getTime()) && d >= windowStart && d < windowEnd
    }

    const sellers: SellerFact[] = []
    let droppedSellers = 0
    for (const s of rawSellerById.values()) {
        if (!eligible(s)) {
            droppedSellers++
            continue
        }
        const callStatusRaw = (s.Call_Status ?? '').trim()
        sellers.push({
            id: s.id,
            name: s.Name ?? '—',
            phoneKey: sellerPhoneKey(s.Phone_Number),
            dedupKey: '', // filled by assignSellerIdentity below
            isPrimary: false,
            inPopulation: windowSellerIds.has(s.id) && inWindow(s.Created_Time),
            callStatusRaw,
            callStatusFolded: foldSellerStatus(s.Call_Status),
            isQualified: isSellerQualified(s.Call_Status),
            reasonForDrop: (s.Reason_for_Lead_Drop ?? '').trim() || null,
            notTruvaQualifiedReasons: toList(s.Truva_Qualified),
            rawSource: (s.Seller_Source ?? '').trim(),
            channel: mapSellerChannel(s.Seller_Source)!,
            micromarkets: toList(s.Truva_Micromarket),
            clusters: toList(s.Truva_Cluster),
            createdAt: s.Created_Time ?? '',
            responseAt: s.EE_Response_Time ?? null,
            acefoneLeadId: s.Acefone_Lead_ID ?? null,
        })
    }
    // One person is one phone, not one Zoho record. Runs after every exclusion above.
    assignSellerIdentity(sellers)

    const eligibleSellerIds = new Set(sellers.map((s) => s.id))
    const toFact = (p: RawProduct): SellerProductFact | null => {
        const sid = productSellerId(p)
        // Keep only products whose seller survived eligibility, so a visit/conversion can
        // never resolve to a dropped (VCV / excluded-source) seller.
        if (!sid || !eligibleSellerIds.has(sid)) return null
        return {
            sellerId: sid,
            acqStatus: (p.Acq_Status ?? '').trim(),
            visitDate: p.Visit_Date ? p.Visit_Date.slice(0, 10) : null,
            mouSigningDate: p.Seller_MoU_Signing_Date ? p.Seller_MoU_Signing_Date.slice(0, 10) : null,
            createdAt: p.Created_Time ?? '',
            minGuarantee: p.Min_Guarantee ?? 0,
            source: (p.Source ?? '').trim(),
            valuationRequestDate: p.Valuation_Request_date ? p.Valuation_Request_date.slice(0, 10) : null,
            pricingCompletionDate: p.Pricing_completion_date ? p.Pricing_completion_date.slice(0, 10) : null,
            offerDate: p.Offer_Date ? p.Offer_Date.slice(0, 10) : null,
        }
    }
    const products = rawProducts.map(toFact).filter((p): p is SellerProductFact => p != null)

    // Channel Partner-sourced sellers/products — dropped from `sellers`/`products` above by
    // `eligible()` since Channel Partner is outside the DRR population, but their raw rows are
    // already sitting in `rawSellerById`/`rawProducts` (no extra Zoho query). Kept separately so
    // the Overall Funnel's "Total Conversions (Channel Partner + Direct)" float box can read
    // them without touching the population every other metric on the dashboard relies on.
    const channelPartnerSellerIds = new Set(
        [...rawSellerById.values()]
            .filter((s) => !isVcv(s.Truva_Cluster) && (s.Seller_Source ?? '').trim().toLowerCase() === 'channel partner')
            .map((s) => s.id)
    )
    const channelPartnerProducts: SellerProductFact[] = rawProducts
        .filter((p) => {
            const sid = productSellerId(p)
            return sid != null && channelPartnerSellerIds.has(sid)
        })
        .map((p) => ({
            sellerId: productSellerId(p)!,
            acqStatus: (p.Acq_Status ?? '').trim(),
            visitDate: p.Visit_Date ? p.Visit_Date.slice(0, 10) : null,
            mouSigningDate: p.Seller_MoU_Signing_Date ? p.Seller_MoU_Signing_Date.slice(0, 10) : null,
            createdAt: p.Created_Time ?? '',
            minGuarantee: p.Min_Guarantee ?? 0,
            source: (p.Source ?? '').trim(),
            valuationRequestDate: p.Valuation_Request_date ? p.Valuation_Request_date.slice(0, 10) : null,
            pricingCompletionDate: p.Pricing_completion_date ? p.Pricing_completion_date.slice(0, 10) : null,
            offerDate: p.Offer_Date ? p.Offer_Date.slice(0, 10) : null,
        }))
    // Place data for those same Channel Partner sellers — Truva_Micromarket/Truva_Cluster are
    // already fetched for every seller regardless of source (sellerFields above), just never
    // carried through for this pool before. Lets the Overall Funnel's Total Conversions float
    // box apply the Micromarket/Cluster filter instead of always counting every CP conversion.
    // A plain Record (not a Map) — this whole fact table is sent to the browser as JSON.
    const channelPartnerPlaces: Record<string, { micromarkets: string[]; clusters: string[] }> = Object.fromEntries(
        [...rawSellerById.values()]
            .filter((s) => channelPartnerSellerIds.has(s.id))
            .map((s) => [s.id, { micromarkets: toList(s.Truva_Micromarket), clusters: toList(s.Truva_Cluster) }])
    )

    // Canary: a non-blank Acq_Status matching none of the three documented cases (and not the
    // separately-known "ignored" set) means either a genuinely new status or a spelling drift
    // — visible here rather than silently mis-counted as "never a visit" by derive.ts's
    // classifyAcqStatus, or silently miscounted as "any status" in the Qualified Properties box.
    const unrecognisedStatuses = new Set(
        products.map((p) => p.acqStatus).filter((s) => s.length > 0 && !KNOWN_ACQ_STATUSES.has(s) && !IGNORED_ACQ_STATUSES.has(s))
    )

    // One line per cache-miss build, so a shrinking population is visible rather than
    // silent. Verified 2026-09-02: 2,640 qualifying properties fetched, 2,531 after the VCV
    // product filter, 942 kept — the rest belong to the 652 Channel Partner / Society
    // Partners sellers and 12 VCV sellers this dashboard deliberately excludes.
    console.log(
        `[seller] sellers=${sellers.length} (dropped ${droppedSellers} ineligible, ` +
            `${referencedCount} old-cohort patched in) products=${products.length}/${rawProducts.length}` +
            ` channelPartnerSellers=${channelPartnerSellerIds.size} channelPartnerProducts=${channelPartnerProducts.length}` +
            (unrecognisedStatuses.size > 0 ? `, UNRECOGNISED Acq_Status: ${[...unrecognisedStatuses].join('; ')}` : '')
    )
    // Spend comes from the growth activity ledger when it is configured, and from the committed
    // snapshot otherwise — never from Zoho. Either way it is pre-aggregated and small, so it
    // rides along in the fact table and the browser filters it like everything else.
    //
    // Bounded to the same window as the rest of the facts, for the reason the buyer path is: the
    // ledger holds future-dated rows, because a 3P billing period is written across all its days
    // the moment it is entered, so an unbounded read would total cost nobody has incurred.
    // windowEnd is exclusive here and inclusive there, hence the day back.
    const { facts: spend, ingest: spendIngest } = await loadSellerSpend(
        dateKey(windowStart),
        dateKey(new Date(windowEnd.getTime() - 86_400_000))
    )

    return {
        sellers,
        products,
        channelPartnerProducts,
        channelPartnerPlaces,
        spend,
        spendIngest,
        windowStart: windowStart.toISOString(),
        windowEnd: windowEnd.toISOString(),
    }
}

async function _build(windowStart: Date, windowEnd: Date): Promise<SellerFactsResponse> {
    return {
        cachedAt: new Date().toISOString(),
        quarterStart: new Date(SELLER_QUARTER_START_ISO).toISOString(),
        quarterEnd: new Date(SELLER_QUARTER_END_ISO).toISOString(),
        quarterLabel: SELLER_QUARTER_LABEL,
        windowStart: windowStart.toISOString(),
        windowEnd: windowEnd.toISOString(),
        facts: await fetchSellerFacts(windowStart, windowEnd),
    }
}
