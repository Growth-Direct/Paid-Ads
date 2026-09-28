import { type CrmFilter, fetchRecordsByIds, queryRecords } from '@/lib/crm'
import type { LeadAttribution } from './attribution'
import { fetchAllTouches, fetchFirstTouches } from './lsh'
import { loadSpend } from './spend/source'
import type {
    BidSourceFact,
    BuyerFacts,
    ConversionFact,
    HouseFact,
    LeadFact,
    SoldBidFact,
    VisitFact,
    VisitSplitFact,
} from './facts'
import {
    cleanClusters,
    clusterPrimary,
    dateKey,
    fixMicromarket,
    fixMicromarkets,
    foldStatus,
    isVcv,
    isVirtualMicromarket,
    mapChannel,
    monthSlices,
    sourceLabel,
    fetchSlices,
    toZohoDateTime,
} from './shared'
import {
    QUALIFIED_STATUSES,
    QUARTER_END_ISO,
    QUARTER_LABEL,
    QUARTER_START_ISO,
    VISIT_PIPELINE_STATUSES,
} from './types'

// This module does the Zoho fetching and turns the raw records into the fact table.
// Every metric is computed in derive.ts, from facts alone.

interface RawLead {
    id: string
    Full_Name?: string
    Lead_Status?: string
    Lead_Source?: string
    Created_Time?: string
    Truva_Cluster?: string[] | string | null
    Not_Qualified_Reason?: string
    UTM_Micromarket?: string[] | string | null
    EE_Response_Time?: string
    UTM_Channel?: string
    Acefone_Lead_ID?: string
    Phone?: string
    Mobile?: string
}
interface RawDeal {
    id: string
    Lead?: { id: string } | string | null
    Was_Bid_Warm?: boolean
    Stage?: string
    Buyer_MoU_Signing_Date?: string
    /** The BID's own source, not the lead's. Verified live: the only values are
     *  'Channel Partner' (6,578), 'Direct' (4,338) and null (17) over 24 months. */
    Lead_Source?: string
    /** The property this bid is on (its text id) — per docs/metric-skill/references/table-map.md
     *  ("a Bid is on a Property"), NOT independently verified live from this codebase as of
     *  2026-09-15 (no Zoho credentials in the session that added it). Backs "Unique Gross
     *  Visits" (dedupe on person+property, not person alone) — see VisitFact.propertyId. */
    Products?: string
    /** When the buyer's blocking amount (token) was received — a datetime carrying an IST
     *  offset, unlike the plain-date Buyer_MoU_Signing_Date. Verified live 2026-09-16.
     *  Prefer this over the Blocking_Ever_Received boolean, which is unreliable: 58 deals
     *  carry a real blocking date while that flag reads false. */
    Blocking_received_date?: string
}
/** Minimal shape for the Direct-vs-Channel-Partner split query — deliberately its own type
 *  rather than reusing RawDeal, since this fetch is intentionally NOT one of the three
 *  eligibility-scoped Deal fetches above (warm / won / event-referenced) and carries no other
 *  field those need. */
interface RawBidSource {
    id: string
    Lead_Source?: string
    Created_Time?: string
}
interface RawEvent {
    id: string
    What_Id?: { id: string } | string | null
    Module?: string
    Start_DateTime?: string
    Truva_Micromarket?: string
}
interface RawProduct {
    id: string
    Product_Name?: string
    Status?: string
    Truva_Cluster?: string[] | string | null
    Unique_visits_Direct?: number
    Active_warm_bids_Direct?: number
}

function dealLeadId(d: RawDeal): string | null {
    if (!d.Lead) return null
    return typeof d.Lead === 'string' ? d.Lead : d.Lead.id
}

// A bid brought in by a channel partner. Per the user these are out of scope everywhere,
// so the BID drops out — its visit, its warm flag and its conversion — while the lead
// behind it stays in the population and can still qualify on its own merits. Null-safe:
// the 17 bids with no source survive, matching how every other exclusion here treats a
// blank. This is bid-level and independent of the lead's own Lead_Source.
export function isChannelPartnerSource(source: string | null | undefined): boolean {
    return (source ?? '').trim().toLowerCase() === 'channel partner'
}
function isChannelPartnerDeal(d: RawDeal): boolean {
    return isChannelPartnerSource(d.Lead_Source)
}

/** Last 10 digits of a phone, or '' when there aren't 10. Strips +91, spaces, dashes and
 *  the assorted formatting the CRM accumulates, so the same person entered two ways
 *  collapses to one key. Takes fields in priority order — Phone, then Mobile. */
export function phoneKeyOf(...raw: Array<string | undefined | null>): string {
    for (const v of raw) {
        const digits = (v ?? '').replace(/\D/g, '')
        if (digits.length >= 10) return digits.slice(-10)
    }
    return ''
}

// Rank of a Lead_Status for picking the survivor when several Zoho leads share a phone:
// the record that got furthest down the funnel wins. Ties break on earliest Created_Time,
// so a re-enquiry can never re-date an old lead into the current quarter.
const STATUS_RANK: Record<string, number> = {
    'Purchased with Truva': 4,
    'Purchased outside Truva': 4,
    'Visit Scheduled': 3,
    'Visit to be Scheduled': 3,
    Qualified: 2,
    'Pre-Qualified': 2,
    'In Follow-up': 2,
    'Paused Search': 2,
}
function statusRank(status: string): number {
    return STATUS_RANK[status] ?? 1
}

/** Fills in `dedupKey` and elects one `isPrimary` per phone group, in place.
 *
 *  Must run AFTER every exclusion, so an excluded lead can never be elected the survivor
 *  of its group. Facts are not merged — each Zoho lead keeps its own row so drill-downs
 *  still link to the real record — instead the counting cards in derive.ts filter on
 *  `isPrimary`. A lead with no usable phone is keyed on its own id and so stands alone;
 *  phone-less leads never merge with each other. */
export function assignLeadIdentity(leads: LeadFact[]): void {
    for (const l of leads) {
        l.dedupKey = l.phoneKey || `id:${l.id}`
        l.isPrimary = false
    }
    const byDedupKey = new Map<string, LeadFact[]>()
    for (const l of leads) {
        const group = byDedupKey.get(l.dedupKey)
        if (group) group.push(l)
        else byDedupKey.set(l.dedupKey, [l])
    }
    for (const group of byDedupKey.values()) {
        let winner = group[0]!
        for (const l of group.slice(1)) {
            const better =
                statusRank(l.status) !== statusRank(winner.status)
                    ? statusRank(l.status) > statusRank(winner.status)
                    : l.createdAt < winner.createdAt
            if (better) winner = l
        }
        winner.isPrimary = true
    }
}
function eventBidId(e: RawEvent): string | null {
    if (!e.What_Id) return null
    return typeof e.What_Id === 'string' ? e.What_Id : e.What_Id.id
}

export interface BuyerFactsResponse {
    cachedAt: string
    quarterStart: string
    quarterEnd: string
    quarterLabel: string
    windowStart: string
    windowEnd: string
    facts: BuyerFacts
}

const CACHE_TTL_MS = 5 * 60 * 1000
// Keyed by window, so switching quarters does not evict the one you came from.
const _cache = new Map<string, { data: BuyerFactsResponse; ts: number }>()
const _inFlight = new Map<string, Promise<BuyerFactsResponse>>()

export function bustBuyerCache() {
    _cache.clear()
}

export async function fetchBuyerFactsCached(windowStart: Date, windowEnd: Date): Promise<BuyerFactsResponse> {
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

// A visit counts as complete once the linked Deal (Bid) has moved past these three
// stages — confirmed live against Event.Visit_Status (the previous, Metabase-reconciled
// definition): the two track each other closely, and per the user this Stage-based
// reading is the one to use everywhere now.
const STAGE_NOT_VISITED = new Set(['Unassigned', 'Pre-Visit', 'Cancelled'])

// A blocking that was taken and then fell through — the bid is not a property sold. Live
// Stage spellings verified 2026-09-16 by sampling real records, NOT by reading the field
// metadata, whose `actual_value` disagrees with what the API returns ('Closed - Won' is
// stored as 'Closed Won', 'Pre-Visit' as 'Qualification'); records come back with the
// DISPLAY spellings used here. Full live list: Unassigned, NA, Pre-Visit, Visit,
// Active - Cold, Active - Warm, Active - Hot, Offer Negotiation, Blocking Received,
// Closed - Won, Closed - Rejected, Closed - Sold, Cancelled.
const BLOCKING_COLLAPSED_STAGES = new Set(['Closed - Rejected', 'Cancelled'])

/** Fetches the window from Zoho and returns the fact table. Exported so the filter
 *  work can reuse it without going through the report shape. */
export async function fetchBuyerFacts(windowStart: Date, windowEnd: Date): Promise<BuyerFacts> {
    // Read from growth's copy of the Zoho mirror (lib/crm.ts), with the same filters the COQL
    // reads had. The shapes of the reads below — Deals never fetched broadly, only the
    // window-relevant slices plus whatever bids the window's visit Events reference, and windows
    // wider than a quarter fetched a slice at a time — were forced by COQL's 10,000-row cap. The
    // mirror has no such cap, but they are kept as they were so the numbers cannot move.
    const createdIn = (a: Date, b: Date): CrmFilter[] => [
        { field: 'Created_Time', op: 'gte', value: toZohoDateTime(a) },
        { field: 'Created_Time', op: 'lt', value: toZohoDateTime(b) },
    ]
    const leadFields = [
        'id',
        'Full_Name',
        'Lead_Status',
        'Lead_Source',
        'Created_Time',
        'Truva_Cluster',
        'UTM_Micromarket',
        'Not_Qualified_Reason',
        'EE_Response_Time',
        'UTM_Channel',
        'Acefone_Lead_ID',
        'Phone',
        'Mobile',
    ]
    const leadsQ = (a: Date, b: Date) => queryRecords('Leads', leadFields, createdIn(a, b))
    const eventsQ = (a: Date, b: Date) =>
        queryRecords('Events', ['id', 'What_Id', 'Module', 'Start_DateTime', 'Truva_Micromarket'], [
            { field: 'Module', op: 'eq', value: 'Bid' },
            { field: 'Start_DateTime', op: 'between', value: [toZohoDateTime(a), toZohoDateTime(b)] },
        ])
    // Lead_Source on Deals is the BID's source and drives the Channel Partner exclusion.
    // It has to be on all three Deal fetches below — missing one leaves CP bids in play
    // through whichever path skipped it. Products (the property this bid is on) rides along on
    // the same three fetches for the same reason — missing it on any path leaves that path's
    // visits without a property, falling into the 'Unknown' bucket unnecessarily.
    const warmDealsQ = () =>
        queryRecords('Deals', ['id', 'Lead', 'Was_Bid_Warm', 'Lead_Source', 'Products'], [
            { field: 'Was_Bid_Warm', op: 'eq', value: true },
        ])
    const wonDealsQ = () =>
        queryRecords('Deals', ['id', 'Lead', 'Stage', 'Buyer_MoU_Signing_Date', 'Lead_Source', 'Products'], [
            { field: 'Stage', op: 'eq', value: 'Closed - Won' },
            {
                field: 'Buyer_MoU_Signing_Date',
                op: 'between',
                value: [toZohoDateTime(windowStart).slice(0, 10), toZohoDateTime(windowEnd).slice(0, 10)],
            },
        ])
    // Every bid created in the window, Channel-Partner-sourced ones included — none of the
    // three Deal fetches above cover this (they're purpose-built subsets: warm all-time, won
    // in-window, visit-linked), and the Direct % of Bids row needs the true company-wide total,
    // not one of those slices. It rides the same slices/window as leadsQ.
    const bidSourcesQ = (a: Date, b: Date) =>
        queryRecords('Deals', ['id', 'Lead_Source', 'Created_Time'], createdIn(a, b))
    // Bids where a blocking amount was received in the window. A blocking comes BEFORE the
    // MoU in Truva's buyer journey, so these are NOT a subset of wonDealsQ above — a bid can
    // be blocked this quarter and sign its MoU in the next one (or never). Verified live
    // 2026-09-16: 32 in JAS 2026, of which 16 are not Closed-Won-in-window.
    // Blocking_received_date is a datetime (values carry an IST offset), unlike
    // Buyer_MoU_Signing_Date which is a plain date — hence the full toZohoDateTime here
    // against the .slice(0, 10) above. Inclusive at both ends, as the COQL BETWEEN was.
    const blockingDealsQ = () =>
        queryRecords(
            'Deals',
            ['id', 'Lead', 'Stage', 'Blocking_received_date', 'Buyer_MoU_Signing_Date', 'Lead_Source'],
            [
                {
                    field: 'Blocking_received_date',
                    op: 'between',
                    value: [toZohoDateTime(windowStart), toZohoDateTime(windowEnd)],
                },
            ]
        )

    // Sequential, as the COQL reads had to be (concurrent COQL calls came back with a spurious
    // "SYNTAX_ERROR near where"). Kept sequential so the order of reads, and so of any partial
    // failure, is unchanged.
    const slices = fetchSlices(windowStart, windowEnd)
    const windowLeads: RawLead[] = []
    for (const [a, b] of slices) {
        const page = (await leadsQ(a, b).catch((e) => {
            throw new Error(`leadsQ failed for ${a.toISOString()}: ${e.message}`)
        })) as RawLead[]
        windowLeads.push(...page)
    }
    const warmDeals = (await warmDealsQ().catch((e) => {
        throw new Error(`warmDealsQ failed: ${e.message}`)
    })) as RawDeal[]
    const wonDeals = (await wonDealsQ().catch((e) => {
        throw new Error(`wonDealsQ failed: ${e.message}`)
    })) as RawDeal[]
    // Additive: only the Overall Funnel's "Total Conversions" tile reads these. Degrades to
    // an empty list (tile falls back to MoU-signed sales alone) rather than failing the whole
    // report, same treatment as the other additive fetches here.
    const blockingDeals = (await blockingDealsQ().catch((e) => {
        console.error('[aggregate] blockingDealsQ failed, Total Conversions falls back to MoU-only:', e)
        return [] as RawDeal[]
    })) as RawDeal[]
    // First-touch attribution for the cost block. Serial-1 rows bucketed on Timestamp;
    // sequential like everything else. If it fails, cost degrades but the funnel does not
    // — so it is caught and left empty rather than throwing the whole report.
    const firstTouches = await fetchFirstTouches(slices).catch((e) => {
        console.error('[aggregate] fetchFirstTouches failed, cost attribution unavailable:', e)
        return new Map<string, LeadAttribution>()
    })
    // Every LSH touch (any Serial_Number) for the Overall Funnel's raw "Total Leads"
    // block. Unlike the queries above, this one is NOT safe on the shared `slices` —
    // every touch (not just each lead's first) can exceed COQL's 10,000-row cap within a
    // single quarter, so this always fetches on calendar-month slices regardless of the
    // window size. monthSlices collapses to one slice for a window under a month, so a
    // narrow Time filter costs no extra round-trips. Same degrade-not-throw treatment as
    // first-touch attribution above.
    const lshTouches = await fetchAllTouches(monthSlices(windowStart, windowEnd)).catch((e) => {
        console.error('[aggregate] fetchAllTouches failed, Overall Funnel Total Leads unavailable:', e)
        return [] as Awaited<ReturnType<typeof fetchAllTouches>>
    })
    // Direct % of Bids — additive, untested against live Zoho as of 2026-09-15 (no credentials
    // in the session that wrote it). Degrades to an empty array rather than failing the whole
    // report if the query is wrong, same treatment as fetchFirstTouches/fetchAllTouches above:
    // this feature must never be able to take down the rest of the dashboard.
    const bidSources: BidSourceFact[] = []
    try {
        for (const [a, b] of slices) {
            const page = (await bidSourcesQ(a, b)) as RawBidSource[]
            for (const d of page) {
                bidSources.push({ dealId: d.id, leadSource: d.Lead_Source ?? null, createdAt: d.Created_Time ?? '' })
            }
        }
    } catch (e) {
        console.error('[aggregate] bidSourcesQ failed, Direct % of Bids unavailable:', e)
        bidSources.length = 0
    }
    const windowEvents: RawEvent[] = []
    for (const [a, b] of slices) {
        const page = (await eventsQ(a, b).catch((e) => {
            throw new Error(`eventsQ failed for ${a.toISOString()}: ${e.message}`)
        })) as RawEvent[]
        windowEvents.push(...page)
    }
    const liveProducts = (await queryRecords(
        'Products',
        ['id', 'Product_Name', 'Status', 'Truva_Cluster', 'Unique_visits_Direct', 'Active_warm_bids_Direct'],
        [{ field: 'Status', op: 'eq', value: 'Live' }]
    )) as RawProduct[]
    const pipelineLeadsRaw = (await queryRecords(
        'Leads',
        [
            'id',
            'Full_Name',
            'Lead_Status',
            'Lead_Source',
            'Created_Time',
            'Truva_Cluster',
            'UTM_Micromarket',
            'Phone',
            'Mobile',
        ],
        [{ field: 'Lead_Status', op: 'in', value: [...VISIT_PIPELINE_STATUSES] }]
    )) as RawLead[]

    // Every Bid-module event's deal is needed up front now — completion is read off the
    // deal's own Stage, not the event's Visit_Status, so the deal has to be resolved
    // before completedEvents can be computed at all (not just for the ones that turn out
    // complete, as when Visit_Status could be read straight off the event).
    const dealById = new Map<string, RawDeal>([...warmDeals, ...wonDeals].map((d) => [d.id, d]))
    const eventDealIds = [...new Set(windowEvents.map(eventBidId).filter((id): id is string => !!id))].filter(
        (id) => !dealById.has(id)
    )
    if (eventDealIds.length > 0) {
        const eventDeals = (await fetchRecordsByIds(
            'Deals',
            ['id', 'Lead', 'Was_Bid_Warm', 'Stage', 'Buyer_MoU_Signing_Date', 'Lead_Source', 'Products'],
            eventDealIds
        )) as RawDeal[]
        for (const d of eventDeals) dealById.set(d.id, d)
    }
    const allDeals = [...dealById.values()]

    const completedEvents = windowEvents.filter((e) => {
        const bidId = eventBidId(e)
        const deal = bidId ? dealById.get(bidId) : undefined
        if (!deal || isChannelPartnerDeal(deal)) return false
        return !!deal.Stage && !STAGE_NOT_VISITED.has(deal.Stage)
    })

    // Leads referenced by a deal or visit but created before the window still have to be
    // resolvable, because New vs Old hinges on the lead's own creation date.
    const rawLeadById = new Map<string, RawLead>(windowLeads.map((l) => [l.id, l]))
    const referencedLeadIds = new Set<string>()
    for (const e of completedEvents) {
        const bidId = eventBidId(e)
        const leadId = bidId ? dealLeadId(dealById.get(bidId) ?? { id: '' }) : null
        if (leadId) referencedLeadIds.add(leadId)
    }
    for (const d of allDeals) {
        if (d.Was_Bid_Warm || d.Stage === 'Closed - Won') {
            const leadId = dealLeadId(d)
            if (leadId) referencedLeadIds.add(leadId)
        }
    }
    const missingLeadIds = [...referencedLeadIds].filter((id) => !rawLeadById.has(id))
    if (missingLeadIds.length > 0) {
        const patched = (await fetchRecordsByIds(
            'Leads',
            [
                'id',
                'Full_Name',
                'Lead_Status',
                'Lead_Source',
                'Created_Time',
                'Truva_Cluster',
                'UTM_Micromarket',
                'EE_Response_Time',
                'UTM_Channel',
                'Acefone_Lead_ID',
                'Phone',
                'Mobile',
            ],
            missingLeadIds
        )) as RawLead[]
        for (const l of patched) rawLeadById.set(l.id, l)
    }

    // --- eligibility: VCV test cluster, and sources outside the DRR population ---
    const eligible = (l: RawLead | undefined): l is RawLead =>
        !!l && !isVcv(l.Truva_Cluster) && mapChannel(l.Lead_Source) !== null

    const warmLeadIds = new Set<string>()
    for (const d of allDeals) {
        if (!d.Was_Bid_Warm || isChannelPartnerDeal(d)) continue
        const lid = dealLeadId(d)
        if (lid) warmLeadIds.add(lid)
    }

    const inWindow = (iso: string | undefined): boolean => {
        if (!iso) return false
        const d = new Date(iso)
        return !Number.isNaN(d.getTime()) && d >= windowStart && d < windowEnd
    }

    const pipelineIds = new Set(pipelineLeadsRaw.filter(eligible).map((l) => l.id))
    for (const l of pipelineLeadsRaw) if (!rawLeadById.has(l.id)) rawLeadById.set(l.id, l)

    const qualifiedSet = new Set<string>(QUALIFIED_STATUSES)
    const windowLeadIds = new Set(windowLeads.map((l) => l.id))

    const leads: LeadFact[] = []
    for (const l of rawLeadById.values()) {
        if (!eligible(l)) continue
        const status = l.Lead_Status ?? 'Unknown'
        const channel = mapChannel(l.Lead_Source)!
        // Per the user, Truva_Micromarket is unreliable and the micromarket dimension
        // reads from elsewhere instead: 3P (99acres/Housing/MagicBricks) takes it from
        // the LSH first-touch row; every other channel (Paid Ads included) takes it from
        // UTM_Micromarket on the lead itself. Blank stays blank in both cases — no
        // fallback to Truva_Micromarket.
        // 3P falls back to UTM_Micromarket when the first touch has none. fetchFirstTouches
        // only pulls LSH rows inside the window, so a 3P lead created before it — every
        // out-of-window lead on the visit-pipeline card — had no micromarket at all and
        // rendered as "Unknown". Measured 2026-09-02: 26 of the 28 3P leads in the pipeline
        // predate the quarter, and UTM_Micromarket supplies a real micromarket for 25 of
        // them. LSH still wins when present, so in-window 3P attribution is unchanged.
        const threeplMicromarket = firstTouches.get(l.id)?.micromarket ?? null
        const utmMicromarkets = fixMicromarkets(l.UTM_Micromarket)
        const rawMicromarkets =
            channel === '3P' ? (threeplMicromarket ? [threeplMicromarket] : utmMicromarkets) : utmMicromarkets
        // Virtual micromarkets are out of scope entirely. Filtered here rather than in
        // eligible() because the 3P path takes its micromarket from the LSH first touch,
        // not from UTM_Micromarket, so the raw lead alone cannot answer the question.
        const micromarkets = rawMicromarkets.filter((m) => !isVirtualMicromarket(m))
        // Every micromarket it had was virtual — drop the lead, and with it its visits and
        // conversions, which resolve through leadFactById below. A lead with NO micromarket
        // is not virtual and survives, same null-safe discipline as the VCV rule.
        if (rawMicromarkets.length > 0 && micromarkets.length === 0) continue
        leads.push({
            id: l.id,
            name: l.Full_Name ?? '—',
            status,
            statusFolded: foldStatus(l.Lead_Status),
            rawSource: (l.Lead_Source ?? '').trim(),
            sourceLabel: sourceLabel(l.Lead_Source),
            channel,
            createdAt: l.Created_Time ?? '',
            clusters: cleanClusters(l.Truva_Cluster),
            clusterPrimary: clusterPrimary(l.Truva_Cluster),
            micromarkets,
            micromarketPrimary: micromarkets[0] ?? '',
            notQualifiedReason: (l.Not_Qualified_Reason ?? '').trim() || null,
            isQualified: qualifiedSet.has(status),
            hasWarmBid: warmLeadIds.has(l.id),
            responseAt: l.EE_Response_Time ?? null,
            utmChannel: l.UTM_Channel ?? null,
            acefoneLeadId: l.Acefone_Lead_ID ?? null,
            phoneKey: phoneKeyOf(l.Phone, l.Mobile),
            // Overwritten by the pass below, once every lead is known.
            dedupKey: '',
            isPrimary: false,
            // Only leads the window query returned are population. Leads patched in to
            // resolve New vs Old, or pulled in by the pipeline snapshot, are not.
            inPopulation: windowLeadIds.has(l.id) && inWindow(l.Created_Time),
            inPipeline: pipelineIds.has(l.id),
            attributedSource: firstTouches.get(l.id)?.source ?? '',
            attributedChannel: firstTouches.get(l.id)?.channel ?? null,
            attributedMicromarket: firstTouches.get(l.id)?.micromarket ?? null,
            attributedAt: firstTouches.get(l.id)?.at ?? null,
            hasAttribution: firstTouches.has(l.id),
        })
    }
    // One person is one phone, not one Zoho record. Runs here, after every exclusion above.
    assignLeadIdentity(leads)

    const leadFactById = new Map(leads.map((l) => [l.id, l]))

    const visits: VisitFact[] = []
    for (const e of completedEvents) {
        const bidId = eventBidId(e)
        const deal = bidId ? dealById.get(bidId) : undefined
        const leadId = deal ? dealLeadId(deal) : null
        const lead = leadId ? leadFactById.get(leadId) : undefined
        if (!lead || !e.Start_DateTime) continue
        // A visit AT a virtual micromarket does not count, whatever the lead looks like.
        if (isVirtualMicromarket(e.Truva_Micromarket)) continue
        visits.push({
            eventId: e.id,
            startAt: e.Start_DateTime,
            eventMicromarket: fixMicromarket(e.Truva_Micromarket),
            leadId: lead.id,
            channel: lead.channel,
            sourceLabel: lead.sourceLabel,
            leadClusters: lead.clusters,
            leadMicromarkets: lead.micromarkets,
            leadCreatedAt: lead.createdAt,
            // Null-safe like every other grouping key here: a bid with no Products value still
            // counts, grouped under 'Unknown' rather than dropped or double-counted.
            propertyId: deal?.Products || 'Unknown',
        })
    }

    // The VCV test cluster sits on the bid's LEAD, read off the pre-eligibility raw leads so
    // a bid whose lead was excluded for its source can still be checked. Null-safe: an
    // unresolvable lead, or one with no cluster, is not VCV.
    const notVcv = (d: RawDeal): boolean => {
        const leadId = dealLeadId(d)
        const rawLead = leadId ? rawLeadById.get(leadId) : undefined
        return !(rawLead && isVcv(rawLead.Truva_Cluster))
    }

    // The BUYER behind a bid, read off the RAW lead rather than leadFactById. A
    // Channel-Partner lead has no LeadFact at all (EXCLUDED_SOURCES drops it), and the
    // Total Conversions tile still has to answer the filter bar for those sales — hence
    // the raw read. `channel` comes back null for any excluded source, so a channel filter
    // correctly leaves such a sale out instead of silently keeping it.
    //
    // Micromarket here is UTM_Micromarket only. The 3P LSH-first-touch rule that LeadFact
    // applies is deliberately NOT repeated: first touches are fetched only inside the
    // window, so a sale whose lead predates it would get nothing, and a half-applied rule
    // reads worse than a consistent simpler one. Flagged in metric-definitions.md.
    const buyerOf = (d: RawDeal) => {
        const leadId = dealLeadId(d)
        const rawLead = leadId ? rawLeadById.get(leadId) : undefined
        const source = rawLead?.Lead_Source ?? ''
        return {
            isChannelPartner: isChannelPartnerSource(source),
            clusters: cleanClusters(rawLead?.Truva_Cluster),
            micromarkets: fixMicromarkets(rawLead?.UTM_Micromarket).filter((m) => !isVirtualMicromarket(m)),
            channel: mapChannel(source),
            rawSource: source,
            sourceLabel: sourceLabel(source),
        }
    }

    // Every completed visit in the window, Channel Partner included — backs the "Visits:
    // Direct vs Channel Partner" chart. Deliberately shares none of the narrowing that
    // produces `visits` above: no isChannelPartnerDeal drop (completedEvents applies one, so
    // this walks windowEvents directly) and no leadFactById lookup, since a CP bid's lead is
    // itself usually Lead_Source = 'Channel Partner' and so outside the population entirely.
    // Requiring either would silently erase the CP series this chart exists to show.
    //
    // Kept: the same completed-visit rule (bid Stage past STAGE_NOT_VISITED), the virtual
    // micromarket exclusion (a place rule, not a source rule) and the VCV test cluster,
    // null-safe off rawLeadById.
    const visitSplit: VisitSplitFact[] = []
    for (const e of windowEvents) {
        if (!e.Start_DateTime) continue
        const bidId = eventBidId(e)
        const deal = bidId ? dealById.get(bidId) : undefined
        if (!deal || !deal.Stage || STAGE_NOT_VISITED.has(deal.Stage)) continue
        if (isVirtualMicromarket(e.Truva_Micromarket)) continue
        if (!notVcv(deal)) continue
        visitSplit.push({
            eventId: e.id,
            startAt: e.Start_DateTime,
            isChannelPartner: isChannelPartnerDeal(deal),
        })
    }

    const conversions: ConversionFact[] = []
    for (const d of allDeals) {
        if (d.Stage !== 'Closed - Won' || !d.Buyer_MoU_Signing_Date) continue
        // Direct-vs-CP is decided by the BUYER, not the bid: changed 2026-09-16 per the growth
        // team, after a sale whose buyer arrived Organic read as Channel Partner purely because
        // the bid was booked to a partner. isChannelPartnerDeal still governs visits and warm
        // flags above — those were not part of that decision.
        if (buyerOf(d).isChannelPartner) continue
        const mou = new Date(d.Buyer_MoU_Signing_Date)
        if (Number.isNaN(mou.getTime()) || mou < windowStart || mou >= windowEnd) continue
        const leadId = dealLeadId(d)
        const lead = leadId ? leadFactById.get(leadId) : undefined
        if (!lead || !lead.createdAt) continue
        conversions.push({
            dealId: d.id,
            leadId: lead.id,
            mouDate: d.Buyer_MoU_Signing_Date,
            channel: lead.channel,
            clusters: lead.clusters,
            micromarkets: lead.micromarkets,
            leadCreatedAt: lead.createdAt,
        })
    }

    // Every property actually sold in the window — the Overall Funnel's "Total Conversions"
    // tile. Deliberately shares NONE of the loop above's narrowing: no bid-level Channel
    // Partner exclusion, and no `leadFactById` lookup, because that map only holds leads that
    // survived the population's source exclusions (EXCLUDED_SOURCES) — and a Channel-Partner
    // bid's lead is itself usually Lead_Source = 'Channel Partner', so requiring a LeadFact
    // would silently drop the very conversions this tile exists to count. Resolves against
    // rawLeadById instead, which is patched above with every Closed-Won deal's lead whether
    // or not it is eligible.
    //
    // The ONE exclusion kept is the VCV test cluster — test data is not a real sale. Null-safe
    // like every other VCV check here: a lead with no cluster, or one we could not resolve at
    // all, still counts.
    const soldBids: SoldBidFact[] = []
    const soldBidIds = new Set<string>()
    const inSoldWindow = (iso: string | undefined): boolean => {
        if (!iso) return false
        const d = new Date(iso)
        return !Number.isNaN(d.getTime()) && d >= windowStart && d < windowEnd
    }
    for (const d of allDeals) {
        if (d.Stage !== 'Closed - Won' || !inSoldWindow(d.Buyer_MoU_Signing_Date)) continue
        if (!notVcv(d)) continue
        soldBidIds.add(d.id)
        soldBids.push({
            dealId: d.id,
            soldAt: d.Buyer_MoU_Signing_Date!,
            viaBlocking: false,
            ...buyerOf(d),
        })
    }
    // Blockings that have not since collapsed. Per the growth team 2026-09-16: a blocking
    // taken and then refunded is not a property sold. Verified live the same day — of the 16
    // blockings in JAS 2026 that are not already Closed-Won, 5 sit at 'Closed - Rejected'.
    // Deal ids already counted above are skipped, so a bid that blocked AND signed its MoU in
    // the window counts once, on its MoU date.
    for (const d of blockingDeals) {
        if (soldBidIds.has(d.id)) continue
        if (!inSoldWindow(d.Blocking_received_date)) continue
        if (d.Stage && BLOCKING_COLLAPSED_STAGES.has(d.Stage)) continue
        if (!notVcv(d)) continue
        soldBidIds.add(d.id)
        soldBids.push({
            dealId: d.id,
            soldAt: d.Blocking_received_date!,
            viaBlocking: true,
            ...buyerOf(d),
        })
    }

    // Products is the only source that does not pass through the lead eligibility check,
    // so the VCV test cluster has to be dropped here explicitly. Null-safe: a property
    // with no cluster survives. (Metabase's own card 738 omits this and charts the test
    // houses, which is why our figure is lower than theirs.)
    const houses: HouseFact[] = liveProducts
        .filter((p) => !isVcv(p.Truva_Cluster))
        .map((p) => ({
            house: p.Product_Name ?? '—',
            clusters: cleanClusters(p.Truva_Cluster),
            uniqueVisits: p.Unique_visits_Direct ?? 0,
            everWarmYes: p.Active_warm_bids_Direct ?? 0,
        }))

    // Spend comes from the growth activity ledger, not Zoho and no longer from a committed
    // file. Small and pre-aggregated either way, so it rides along in the fact table and the
    // browser filters it like everything else.
    //
    // Bounded to the same window as the rest of the facts. That is not only tidiness: the
    // ledger holds future-dated rows, because a 3P billing period is written across all its
    // days the moment it is entered, so an unbounded read would total cost nobody has
    // incurred. windowEnd is exclusive here and inclusive there, hence the day back.
    const { facts: spend, ingest: spendIngest } = await loadSpend(
        dateKey(windowStart),
        dateKey(new Date(windowEnd.getTime() - 86_400_000))
    )

    return {
        leads,
        visits,
        conversions,
        soldBids,
        visitSplit,
        houses,
        lshTouches,
        spend,
        spendIngest,
        bidSources,
        windowStart: windowStart.toISOString(),
        windowEnd: windowEnd.toISOString(),
    }
}

async function _build(windowStart: Date, windowEnd: Date): Promise<BuyerFactsResponse> {
    return {
        cachedAt: new Date().toISOString(),
        // The funnel stays pinned to the reporting quarter whatever window is loaded.
        quarterStart: new Date(QUARTER_START_ISO).toISOString(),
        quarterEnd: new Date(QUARTER_END_ISO).toISOString(),
        quarterLabel: QUARTER_LABEL,
        windowStart: windowStart.toISOString(),
        windowEnd: windowEnd.toISOString(),
        facts: await fetchBuyerFacts(windowStart, windowEnd),
    }
}
