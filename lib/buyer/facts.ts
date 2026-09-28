import type { SpendOrigin } from '@/lib/spend/origin'
import type { Channel } from './types'

// The fact table. One row per lead, visit, conversion and live house, each carrying
// every dimension the filters can slice on: time, cluster, micromarket, channel.
//
// Facts are already filtered for eligibility, so nothing downstream has to re-apply those
// rules and no card can forget to. Filtered here: the VCV test cluster; the Channel
// Partner / Builder / Seller Referral / NoBroker / Society Partners lead sources; leads
// whose every micromarket is virtual; visits at a virtual micromarket; and Channel-
// Partner-sourced BIDS, which drop their own visit, warm flag and conversion while
// leaving the lead behind them in the population.
//
// The one rule NOT applied here is phone identity — LeadFact rows are not merged, because
// drill-downs need the real Zoho record. Instead each row carries `dedupKey`/`isPrimary`
// and derive.ts counts on those.
//
// Cluster and micromarket are ARRAYS. Truva_Cluster and Truva_Micromarket are both
// multiselect picklists in Zoho, and a lead carrying two micromarkets counts under
// both. Per-micromarket columns therefore sum to more than the unfiltered total.

export interface LeadFact {
    id: string
    name: string
    /** Raw Zoho Lead_Status, before telephony junk is folded. */
    status: string
    /** Lead_Status with telephony dispositions folded into Attempted to Contact. */
    statusFolded: string
    /** Raw Zoho Lead_Source, kept so the source filter can offer real values. */
    rawSource: string
    /** rawSource with casing junk folded to a display spelling (`ig` -> Instagram). What
     *  the by-source charts stack on, so they name the source rather than its channel. */
    sourceLabel: string
    channel: Channel
    createdAt: string
    /** Every valid cluster on the record. Used by the cluster filter. */
    clusters: string[]
    /** Historical first-value-wins reading, which the cluster card still counts on so
     *  the reconciled baseline holds. Replaced by `clusters` when counting moves to
     *  count-in-both. */
    clusterPrimary: string
    /** Every micromarket on the record, casing fixed, unrecognised values kept.
     *  Truva_Micromarket is never read here — per the user it's unreliable. A 3P lead
     *  (99acres/Housing/MagicBricks) takes this from the LSH first-touch row; every other
     *  channel, Paid Ads included, takes it from UTM_Micromarket on the lead. Empty when
     *  the respective source has nothing — no fallback between them. */
    micromarkets: string[]
    /** Historical first-value-wins reading, empty string when the record has none. */
    micromarketPrimary: string
    notQualifiedReason: string | null
    isQualified: boolean
    hasWarmBid: boolean
    /** Zoho EE_Response_Time — when the lead was first contacted. Null until it happens. */
    responseAt: string | null
    /** Zoho UTM_Channel, kept so FRT can exclude the WhatsApp value. */
    utmChannel: string | null
    /** Zoho Acefone_Lead_ID — telephony system's lead reference. Leads without one are
     *  excluded from FRT (per the user, no Acefone ID means no reliable call trail). */
    acefoneLeadId: string | null
    /** Last 10 digits of Phone (falling back to Mobile), or '' when neither has 10. */
    phoneKey: string
    /** What makes this lead one person: `phoneKey`, or `id:<id>` when there is no usable
     *  phone so the lead stands alone. Visits and conversions dedupe on this, not on
     *  leadId, so two Zoho records for the same person count once. */
    dedupKey: string
    /** Exactly one lead per dedupKey group is primary — the one with the most advanced
     *  status, earliest-created breaking ties. Counting cards filter on this; the
     *  non-primary rows stay in the fact table so drill-downs still resolve. */
    isPrimary: boolean
    /** True when the lead was created inside the reporting window. Leads pulled in
     *  only to resolve New vs Old visits, or to populate the pipeline snapshot, are
     *  false and must not be counted as leads. */
    inPopulation: boolean
    /** True when the lead currently sits in a visit-pipeline status. */
    inPipeline: boolean

    // First-touch attribution from the lead's Serial_Number = 1 Lead_Source_History row,
    // bucketed on Timestamp. A SECOND, PARALLEL set of dimensions used ONLY by the cost
    // block in costs.ts. NOTHING in derive.ts may read these — the twelve funnel cards
    // are reconciled against Metabase on Truva_Micromarket and Lead_Source, and switching
    // any of them to attributed dimensions breaks that reconciliation silently.
    // __tests__/derive.golden.test.ts locks derive.ts against exactly that.
    /** LSH Source (same picklist as Lead_Source). '' when there is no LSH row. */
    attributedSource: string
    /** attributedSource through mapChannel(): a Channel, 'Unmapped', or null when the
     *  source is excluded or there is no LSH row. */
    attributedChannel: Channel | null
    /** A valid micromarket from the first touch, or null (no LSH row, or a virtual/junk
     *  micromarket). This, not Truva_Micromarket, is what cost metrics filter on. */
    attributedMicromarket: string | null
    /** LSH Timestamp of the first touch, or null. */
    attributedAt: string | null
    /** False when no serial-1 LSH row was found. Drives the cost coverage denominator. */
    hasAttribution: boolean

    // Added 2026-09-23, same first-touch LSH row as the block above and under the exact
    // same rule: the twelve cards above this comment in derive.ts's original golden test
    // never read these either. They exist for a NEW, separate set of cards — Leads/Qualified
    // by Campaign/AdSet/Ad/Property — added alongside, not by changing, the original twelve.
    /** LSH Campaign_Name of the first touch. '' when the touch had no ad campaign (Direct,
     *  Channel Partner, organic, referral, ...) or there is no LSH row — a real, expected
     *  value, not a data gap; ~27% of touches have no campaign at all (verified live
     *  2026-09-23). */
    attributedCampaign: string
    attributedAdSet: string
    attributedAd: string
    /** LSH Property_Name of the first touch, raw and untrimmed-display, same convention as
     *  Property_Name elsewhere. '' when blank or there is no LSH row. Distinct from a Bid's
     *  property (Deals.Products) — before a bid exists a lead isn't tied to one property, so
     *  this is the property they were enquiring about at that specific engagement, not a
     *  single definitive property for the lead. See metric-definitions.md. */
    attributedProperty: string
}

export interface VisitFact {
    eventId: string
    startAt: string
    /** Micromarket recorded on the visit event itself, not on the lead. */
    eventMicromarket: string
    leadId: string
    channel: Channel
    /** The lead's source label, so the by-source visit chart can name the source too. */
    sourceLabel: string
    leadClusters: string[]
    leadMicromarkets: string[]
    leadCreatedAt: string
    /** The property (Deal's Products field) this visit's bid is on — 'Unknown' when the bid
     *  carries no value. Backs "Unique Gross Visits": dedupe on (person, property), not person
     *  alone, so the same buyer visiting a different flat counts again. */
    propertyId: string
}

export interface ConversionFact {
    dealId: string
    leadId: string
    mouDate: string
    channel: Channel
    clusters: string[]
    micromarkets: string[]
    leadCreatedAt: string
}

/** Every property sold in the window — a bid that either signed its MoU (Stage
 *  'Closed - Won' with Buyer_MoU_Signing_Date in window) or received a blocking amount
 *  (Blocking_received_date in window, and not since collapsed). One row per BID, with NO
 *  source exclusion and NO lead-population requirement.
 *
 *  Deliberately a separate array from ConversionFact above, which is Direct-only (both at
 *  bid level and via its lead having survived the population's source exclusions), MoU-only,
 *  and deduped per buyer downstream. Those exclusions are not one thing but several, and
 *  lifting only the bid-level one is not enough: a Channel-Partner bid's LEAD usually also
 *  carries Lead_Source = 'Channel Partner', which EXCLUDED_SOURCES drops from the lead
 *  population entirely — so such a sale never resolves a LeadFact and vanishes regardless of
 *  how the bid itself is treated.
 *
 *  Backs the Overall Funnel's "Total Conversions" tile: "how many properties did we sell
 *  altogether." */
export interface SoldBidFact {
    dealId: string
    /** The date that put this sale in the window: the MoU signing date when it has one,
     *  otherwise the blocking date. */
    soldAt: string
    /** Counted off the blocking date rather than a signed MoU — an earlier, softer signal. */
    viaBlocking: boolean
    /** True when the BUYER came through a channel partner — read off the lead's own
     *  Lead_Source, not the bid's. Changed 2026-09-16 at the growth team's decision: a bid
     *  booked to a partner for a buyer who arrived directly is a Direct sale. Not used to
     *  exclude anything here; the tile counts both and this only splits them. */
    isChannelPartner: boolean
    /** The buyer's own dimensions, resolved from the RAW lead record rather than a LeadFact —
     *  a Channel-Partner lead has no LeadFact (EXCLUDED_SOURCES drops it), and this tile has
     *  to stay filterable for those sales too. `channel` is null for a lead whose source is
     *  excluded from the population, so a channel filter correctly leaves it out. */
    clusters: string[]
    micromarkets: string[]
    channel: Channel | null
    /** Raw Zoho Lead_Source, lowercased downstream — this is what the source filter compares
     *  against (it holds raw values, not display spellings). */
    rawSource: string
    /** rawSource folded to its display spelling, for labelling rather than filtering. */
    sourceLabel: string
    /** Added 2026-09-23, resolved the same independently-of-population way as channel/
     *  rawSource above: straight from the first-touch Lead_Source_History map, not via a
     *  LeadFact, so a Channel-Partner buyer's sale stays filterable by these too. '' when
     *  there is no first-touch row or it had no value for that field. */
    attributedCampaign: string
    attributedAdSet: string
    attributedAd: string
    attributedProperty: string
}

/** One completed visit EVENT in the window, tagged by whether the bid behind it came from a
 *  Channel Partner. A separate array from VisitFact above, which is Direct-only twice over —
 *  its bid must survive the Channel Partner exclusion AND its lead must survive the
 *  population's source exclusions — and which every Metabase-reconciled visit metric depends
 *  on staying exactly that. Backs the "Visits: Direct vs Channel Partner" WoW chart.
 *
 *  Carries no lead, channel or micromarket on purpose: a CP visit has no eligible LeadFact, so
 *  there is nothing to filter or drill into. See the chart's own doc entry. */
export interface VisitSplitFact {
    eventId: string
    startAt: string
    isChannelPartner: boolean
}

export interface HouseFact {
    house: string
    clusters: string[]
    uniqueVisits: number
    everWarmYes: number
}

// One row per Lead_Source_History touch, EVERY Serial_Number — not just the serial-1 rows
// LeadFact.attributed* reads. Lets the Overall Funnel's "Total Leads" block count every
// enquiry (including a lead's re-enquiries), against LeadFact's one-row-per-lead "Unique
// Leads". Only touches whose Lead resolves to an eligible LeadFact are ever counted, so
// the same VCV/channel exclusions apply without re-checking them here.
//
// campaign/adSet/ad/property/micromarket/leadStatus (added 2026-09-23) back the
// "Non-Unique Count" / "Lead Status" extra-info block shown in the drill-down for the
// Campaign/AdSet/Ad/Property/Micromarket breakdown charts — EXTRA CONTEXT, not part of the
// funnel. See lib/buyer/lsh.ts's fetchAllTouches and metric-definitions.md.
export interface LshTouchFact {
    leadId: string
    timestamp: string
    campaign: string
    adSet: string
    ad: string
    property: string
    micromarket: string
    leadStatus: string
}

// One row per bid (Deal), carrying only what the Direct-vs-Channel-Partner split needs.
// Deliberately NOT run through the usual eligibility filters — "company-wide" per the growth
// team's own request means every bid counts here, Channel-Partner-sourced ones included, since
// the whole point is to see how big that slice is. leadSource is the BID's own Lead_Source
// (Direct / Channel Partner / null), not the lead's.
export interface BidSourceFact {
    dealId: string
    leadSource: string | null
    createdAt: string
}

// Ad/3P/offline spend, pre-aggregated from the growth team's ~95K-row sheet to one row
// per (day × channel × micromarket × raw source). Campaign/adset/ad are dropped: nothing
// consumes them and Meta's 18-digit IDs are already corrupted by Sheets' float storage.
export interface SpendFact {
    /** YYYY-MM-DD, IST. Same key space as dateKey(). */
    date: string
    channel: Channel
    /** A valid micromarket, or null for the unallocated bucket (blank/unknown on sheet). */
    micromarket: string | null
    /** The sheet's UTM Source, lowercased, so the nested source filter narrows the
     *  numerator too, not just the lead denominator. */
    rawSource: string
    spendInr: number
    impressions: number
    clicks: number
}

// Surfaced in the payload and rendered, so the growth team debugs their own sheet.
export interface SpendIngest {
    status: 'ok' | 'unavailable' | 'schema-error'
    /** Which source produced these facts. Named in the note the growth team reads. */
    origin: SpendOrigin
    /** Set for 'unavailable' and 'schema-error'; shown verbatim in the banner. */
    error: string | null
    rowsRead: number
    rowsKept: number
    droppedBadDate: number
    droppedBadSpend: number
    /** Distinct raw values that fell through, capped for display. */
    unmappedSources: string[]
    unknownMicromarkets: string[]
    /** When the snapshot was built, so the footer can say how fresh spend is. */
    builtAt: string | null
    /** Added 2026-09-28. Set when this window's Meta ('meta' rawSource) rows were overlaid
     *  with a live Graph API pull instead of coming from origin above — the timestamp of that
     *  pull, so the footer can say Meta specifically is fresher than the rest. Null (the
     *  default, and every pre-existing snapshot/fixture) means Meta rows still come from
     *  `origin` like everything else. See lib/buyer/spend/meta.ts and source.ts's loadSpend(). */
    metaLiveAsOf?: string | null
}

export interface BuyerFacts {
    leads: LeadFact[]
    visits: VisitFact[]
    conversions: ConversionFact[]
    soldBids: SoldBidFact[]
    visitSplit: VisitSplitFact[]
    houses: HouseFact[]
    lshTouches: LshTouchFact[]
    spend: SpendFact[]
    spendIngest: SpendIngest
    /** Every bid in the window, Channel-Partner-sourced ones included — see BidSourceFact.
     *  Empty (never null) if the fetch failed; the Direct % of Bids row just reads as "—". */
    bidSources: BidSourceFact[]
    /** Window the facts were fetched for. Any filter range outside this needs a refetch. */
    windowStart: string
    windowEnd: string
}
