import type { FrtWeekPoint, ReasonPoint, TwoWeekRow } from '@/lib/buyer/types'
import type { SellerFact, SellerFacts, SellerProductFact } from './facts'
import { type SellerFilters, type Scope, placeMatches, sellerMatches, sellerMatchesChannel } from './filters'
import { computeSellerSpendForWindow, costPer } from './costs'
// MICROMARKET_TO_CLUSTER lives in shared.ts (not here) so the chart components can import it
// too, for their own cluster-grouped tooltips — both derive cluster from the seller's PRIMARY
// micromarket rather than trusting the seller's own Truva_Cluster field, which disagrees with
// micromarket on about a third of records (CLAUDE.md's "never AND cluster against micromarket"
// rule) and is documented as especially poor on sellers ("Unknown dominates").
import { IST_OFFSET_MS, MICROMARKET_TO_CLUSTER, buildBuckets, dateKey, mappedMicromarket, micromarketsInScope, mondayOfIST } from './shared'
import { scoped, sellerTargetsFor } from './targets'
import {
    ACQ_ALWAYS_VISIT_STATUSES,
    ACQ_CONVERTED_STATUS,
    ACQ_DATED_VISIT_STATUSES,
    ACQ_PIPELINE_STATUSES,
    SELLER_QUARTER_LABEL,
    type ClusterPipelinePoint,
    type CohortSplitPipeline,
    type LeadListItem,
    type MicromarketTargetPoint,
    type PostVisitTatData,
    type SellerReportData,
    type WeekSeriesPoint,
} from './types'

// Every seller card is derived here, from the fact table alone. No Zoho access and no clock
// beyond what is passed in, so this runs identically on the server and in the browser.
// Mirrors lib/buyer/derive.ts's fact-table → pure-derive split.

export interface SellerDeriveOptions {
    /** The reporting quarter the pacing/rates are pinned to when no time filter is set. */
    quarterStart: Date
    quarterEnd: Date
    now: Date
    filters: SellerFilters
}

// The status lists live in types.ts so aggregate.ts can bound its Products fetch by them too.
const ACQ_DATED = new Set<string>(ACQ_DATED_VISIT_STATUSES)
const ACQ_ALWAYS = new Set<string>(ACQ_ALWAYS_VISIT_STATUSES)
const ACQ_PIPELINE = new Set<string>(ACQ_PIPELINE_STATUSES)

const DAY_MS = 86400000

function emptySeries(starts: Date[], label: (d: Date) => string, incomplete: boolean[] = []): WeekSeriesPoint[] {
    return starts.map((s, i) => ({
        weekStart: dateKey(s),
        weekLabel: label(s),
        counts: {},
        leadIds: {},
        incomplete: incomplete[i] === true,
    }))
}

function bump(point: WeekSeriesPoint, key: string, id: string) {
    point.counts[key] = (point.counts[key] ?? 0) + 1
    ;(point.leadIds[key] ??= []).push(id)
}

/** n/d as a percentage, one decimal. Null when the denominator is 0 (a 0 would read as a
 *  real 0% rather than "not computable"). */
function ratioPct(n: number, d: number): number | null {
    return d > 0 ? Math.round((n / d) * 1000) / 10 : null
}

/** Null-safe ratioPct, for rate targets built from two (possibly absent) target-grid values —
 *  mirrors lib/buyer/derive.ts's safeRatio. */
function safeRatio(n: number | null, d: number | null): number | null {
    return n == null || d == null ? null : ratioPct(n, d)
}

function instantInWindow(iso: string, startMs: number, endMs: number): boolean {
    const t = new Date(iso).getTime()
    return !Number.isNaN(t) && t >= startMs && t < endMs
}

// === First Response Time — working-hours sellers only ===
// FRT = EE_Response_Time minus Created_Time, in minutes. Mirrors lib/buyer/derive.ts's own FRT
// block exactly — the Sellers module carries the identical field names Leads does
// (EE_Response_Time, Acefone_Lead_ID). Unlike Buyer's version, no source-exclusion list is
// applied here: that set (FRT_EXCLUDED_SOURCES) was tuned by Buyer-specific incidents, and
// sellers count for FRT the same way they count everywhere else on this tab unless the growth
// team says otherwise later.
const FRT_WORK_START_HOUR = 9
const FRT_WORK_END_HOUR = 19 // 7:00 PM IST; working hours is [9, 19), 7:00 PM itself excluded.

function frtEligible(seller: SellerFact): boolean {
    return !!seller.acefoneLeadId
}

function istHourOfDay(d: Date): number {
    const ist = new Date(d.getTime() + IST_OFFSET_MS)
    return ist.getUTCHours() + ist.getUTCMinutes() / 60
}

function isWorkingHours(d: Date): boolean {
    const h = istHourOfDay(d)
    return h >= FRT_WORK_START_HOUR && h < FRT_WORK_END_HOUR
}

// Minutes from Created Time to first response, for a working-hours-created seller only.
// Returns null for a non-working-hours seller, one with no response yet, or a negative
// duration (a data-quality edge case, excluded rather than shown as a misleading negative
// number) — same rules as lib/buyer/derive.ts's own frtMinutes.
function frtMinutes(createdAt: string, responseAt: string | null): number | null {
    if (!responseAt) return null
    const created = new Date(createdAt)
    const responded = new Date(responseAt)
    if (Number.isNaN(created.getTime()) || Number.isNaN(responded.getTime())) return null
    if (!isWorkingHours(created)) return null

    const minutes = (responded.getTime() - created.getTime()) / 60000
    return minutes < 0 ? null : minutes
}

function percentile(sorted: number[], p: number): number | null {
    if (sorted.length === 0) return null
    const idx = (p / 100) * (sorted.length - 1)
    const lo = Math.floor(idx)
    const hi = Math.ceil(idx)
    if (lo === hi) return sorted[lo]!
    return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (idx - lo)
}

function summarizeFrt(minutes: number[]): Omit<FrtWeekPoint, 'weekStart' | 'weekLabel'> {
    if (minutes.length === 0) return { avgMinutes: null, medianMinutes: null, p80Minutes: null, count: 0 }
    const sorted = [...minutes].sort((a, b) => a - b)
    const avg = minutes.reduce((s, n) => s + n, 0) / minutes.length
    const round1 = (n: number | null) => (n == null ? null : Math.round(n * 10) / 10)
    return {
        avgMinutes: round1(avg),
        medianMinutes: round1(percentile(sorted, 50)),
        p80Minutes: round1(percentile(sorted, 80)),
        count: minutes.length,
    }
}

interface Actuals {
    leads: number
    qualified: number
    /** Distinct dedupKey among the same population as `leads`, folded via foldSellerStatus to
     *  'Attempted to Contact' — telephony junk (Network Issue, Call Rejected, ...) folds in
     *  here too, per CLAUDE.md's "never drop telephony-junk statuses" rule. Real leads someone
     *  hasn't reached yet, not a rate — no grid target exists for it. */
    attemptedToContact: number
    /** Same population as `leads`, callStatusFolded === 'Not qualified' (lowercase q — the
     *  live Zoho spelling). Distinct from `qualified`'s complement: Inactive/Call Later/etc.
     *  sit in neither bucket, so attemptedToContact + notQualified + qualified <= leads. */
    notQualified: number
    /** Distinct sellers with >=1 qualifying property. This is the dashboard-wide "Seller
     *  Visits" number now (pacing table actual, QLTV% and the conversion-rate denominator) —
     *  a DELIBERATE departure from the skill's agreed per-property definition
     *  (metric-definitions.md: "Counted per property, not per seller"), made so the Overall
     *  Funnel's spine stays entirely person-based, mirroring the Buyer funnel. The skill's own
     *  per-property number survives as `qualifyingProperties`, now shown only as funnel
     *  context, not as an actual/target/rate anywhere. */
    visits: number
    conversions: number
    /** EVERY property (any Acq_Status) belonging to a seller in this window's Qualified Leads
     *  set. Floats above Qualified Leads as "Qualified Properties" — not gated on Acq_Status
     *  at all, unlike qualifyingProperties below. */
    qualifiedSellerProperties: number
    /** The skill's own "Seller Visits" under the three-case rule (Case 2 needs a Visit_Date,
     *  Case 3 always counts), counted per property, additionally gated on the seller being
     *  Qualified. Floats above Unique Seller Visits as "Qualified Property Visits". */
    qualifyingProperties: number
    /** Properties at Acq_Status 'Visit Scheduled' or 'Visit to be Scheduled' — the funnel's
     *  "Visits in Pipeline" branch. Same seller-match and New/Old scoping as visits. */
    pipelineCount: number
    // The following are the SAME underlying counts as visits/conversions/pipelineCount/
    // qualifyingProperties above, just split by cohort and NOT gated on filters.visitScope/
    // conversionScope — the Target vs Achieved table shows New, Old and Total unconditionally
    // (mirroring Buyer's table, which has no New/Old toggle at all), independent of whatever
    // the scope pills currently have selected for the Overall Funnel's own single number.
    /** Distinct New-cohort sellers with >=1 qualifying property. */
    visitsNew: number
    /** Distinct Old-cohort sellers with >=1 qualifying property. */
    visitsOld: number
    /** Per-property qualifying-visit count (not deduped to the seller), New cohort. */
    qualifyingNew: number
    /** Per-property qualifying-visit count (not deduped to the seller), Old cohort. */
    qualifyingOld: number
    pipelineNew: number
    pipelineOld: number
    conversionsNew: number
    conversionsOld: number
    /** Distinct sellers with >=1 converted property, per cohort — the deduped reading only the
     *  Overall Funnel (Unique Seller) uses. See the doc comment where these are built. */
    convertedSellersNew: number
    convertedSellersOld: number
    /** Sum of Products.Min_Guarantee over the exact same population as conversionsNew +
     *  conversionsOld — the Target vs Achieved table's "GMV Acquired" row. New+Old combined,
     *  unconditional on the visit/conversion scope pills, same as Spend. */
    gmvAcquired: number
}

// The pacing/rate actuals, generalised to an arbitrary window. New vs Old hinges on the
// seller's own creation date against `cohortBoundary` (the window start) — Metabase's
// quarter_sellers/old_cohort_sellers split works the same way, but against its own hardcoded
// Jul 5 anchor. This dashboard's window start moved to Jul 1 on 2026-09-09 (per an explicit
// growth-team request, to match the Buyer tab's calendar quarter), so the two now genuinely
// disagree on which sellers are New vs Old for any seller created Jul 1–4. See
// SELLER_QUARTER_START_ISO's doc comment and metric-definitions.md.
function computeActuals(
    facts: SellerFacts,
    filters: SellerFilters,
    sellerById: Map<string, SellerFact>,
    windowStart: Date,
    windowEnd: Date,
    cohortBoundary: Date
): Actuals {
    const startMs = windowStart.getTime()
    const endMs = windowEnd.getTime()
    const boundaryMs = cohortBoundary.getTime()

    // Leads = distinct dedupKey among primary, in-population sellers created in-window that
    // match the filters. isPrimary already guarantees one row per phone, so counting rows is
    // counting distinct phones.
    const windowSellers = facts.sellers.filter(
        (s) => s.isPrimary && s.inPopulation && instantInWindow(s.createdAt, startMs, endMs) && sellerMatches(s, filters)
    )
    const leads = windowSellers.length
    const qualified = windowSellers.filter((s) => s.isQualified).length
    const attemptedToContact = windowSellers.filter((s) => s.callStatusFolded === 'Attempted to Contact').length
    const notQualified = windowSellers.filter((s) => s.callStatusFolded === 'Not qualified').length

    // Qualified Properties — EVERY property (any Acq_Status) belonging to one of THIS
    // window's Qualified Leads, matched by raw seller id (products reference a specific Zoho
    // Seller record, not a phone-deduped one). Not New/Old-scoped, mirroring Qualified Leads
    // itself, which has no New/Old toggle either.
    const qualifiedSellerIds = new Set(windowSellers.filter((s) => s.isQualified).map((s) => s.id))
    let qualifiedSellerProperties = 0
    for (const p of facts.products) {
        if (qualifiedSellerIds.has(p.sellerId)) qualifiedSellerProperties++
    }

    // Qualifying properties — the three-case rule, with DIFFERENT attribution for New vs Old
    // (per the Notion doc's "Old Visit" section, which is not just Case 1's list re-applied —
    // it drops the New cohort's "Case 3 always counts" exception entirely):
    //   - New: Case 2 needs any Visit_Date; Case 3 always counts, no date required.
    //   - Old: EVERY non-Case-1 status (both what are Case 2 and Case 3 for New) needs a
    //     Visit_Date that falls WITHIN THE CURRENT WINDOW. There is no unconditional "always"
    //     exception for Old — an Old seller could have reached any status in any past quarter,
    //     so only an in-window date proves the visit belongs to this quarter's count.
    // Counted PER PROPERTY, not per seller, so a seller with two qualifying properties
    // contributes two. Kept as funnel context only — see the note on `visits` below for why
    // the dashboard's actual "Seller Visits" number is no longer this.
    //
    // Gated on the seller ALSO being a Qualified Lead — a dashboard-only addition, not in the
    // skill doc (flagged in metric-definitions.md's Open Questions). Call_Status and
    // Acq_Status are otherwise independent fields, so without this gate a property can count
    // here even when its seller was never marked Qualified.
    //
    // The seller's own dimensions carry the filter — channel and micromarket live on the
    // seller, not the property.
    let qualifyingNew = 0
    let qualifyingOld = 0
    // Distinct sellers with at least one qualifying property. THIS is now the dashboard-wide
    // "Seller Visits" — see the Actuals.visits doc comment.
    const visitedSellersNew = new Set<string>()
    const visitedSellersOld = new Set<string>()
    for (const p of facts.products) {
        const seller = sellerById.get(p.sellerId)
        if (!seller || !seller.isQualified || !sellerMatches(seller, filters)) continue
        const isNew = instantInWindow(seller.createdAt, startMs, endMs)
        const isOld = !isNew && new Date(seller.createdAt).getTime() < boundaryMs
        if (!isNew && !isOld) continue
        const ok = isNew
            ? isQualifyingVisitNew(p.acqStatus, p.visitDate)
            : isQualifyingVisitOld(p.acqStatus, p.visitDate, startMs, endMs)
        if (!ok) continue
        if (isNew) {
            qualifyingNew++
            visitedSellersNew.add(seller.dedupKey)
        } else {
            qualifyingOld++
            visitedSellersOld.add(seller.dedupKey)
        }
    }
    const qualifyingProperties = scopedCount(qualifyingNew, qualifyingOld, filters.visitScope)
    const visits = scopedUnion(visitedSellersNew, visitedSellersOld, filters.visitScope).size
    const visitsNew = visitedSellersNew.size
    const visitsOld = visitedSellersOld.size

    // Visits in Pipeline — a property scheduled but not yet visited (Acq_Status 'Visit
    // Scheduled' or 'Visit to be Scheduled'). Same seller-match, Qualified-seller gate and
    // New/Old scoping as visits, but shown as a plain count in the funnel, not a rate.
    let pipelineNew = 0
    let pipelineOld = 0
    for (const p of facts.products) {
        if (!isPipelineProperty(p.acqStatus)) continue
        const seller = sellerById.get(p.sellerId)
        if (!seller || !seller.isQualified || !sellerMatches(seller, filters)) continue
        if (instantInWindow(seller.createdAt, startMs, endMs)) pipelineNew++
        else if (new Date(seller.createdAt).getTime() < boundaryMs) pipelineOld++
    }
    const pipelineCount = scopedCount(pipelineNew, pipelineOld, filters.visitScope)

    // Seller Conversions — a property at MoU Signed WHOSE Seller_MoU_Signing_Date falls
    // within the current window, per property, New/Old by the parent seller's creation
    // quarter. The signing-date gate was added to the Notion doc on 2026-09-07 (previously
    // status alone was sufficient) — verified live against the doc directly. In practice this
    // mostly affects Old conversions: a New seller's MoU date, if present, is already
    // guaranteed to fall in-quarter (it can't predate the seller's own in-quarter creation or
    // land in the future), but an Old seller could have signed in any quarter since, and the
    // status alone can't tell you which one.
    let convNew = 0
    let convOld = 0
    // Distinct sellers with >=1 converted property, per cohort — the Overall Funnel (Unique
    // Seller)'s own Conversions arms/CVR use this (added 2026-09-22, per an explicit
    // growth-team request, once the property-level funnel below needed its own, genuinely
    // undeduped reading to disagree with). convNew/convOld above stay per-property/undeduped —
    // the Target vs Achieved table's New/Old Conversions rows and the Overall Funnel (Unique
    // Property) both keep reading those, unchanged.
    const convertedSellersNew = new Set<string>()
    const convertedSellersOld = new Set<string>()
    // GMV Acquired — sum of Min_Guarantee over this SAME population (MoU Signed, in-window
    // signing date, New+Old combined, unconditional on the visit/conversion scope pills — same
    // treatment as Spend itself, which has no New/Old split either).
    let gmvAcquired = 0
    for (const p of facts.products) {
        if (p.acqStatus !== ACQ_CONVERTED_STATUS) continue
        if (!p.mouSigningDate || !instantInWindow(p.mouSigningDate, startMs, endMs)) continue
        const seller = sellerById.get(p.sellerId)
        if (!seller || !sellerMatches(seller, filters)) continue
        if (instantInWindow(seller.createdAt, startMs, endMs)) {
            convNew++
            convertedSellersNew.add(seller.dedupKey)
            gmvAcquired += p.minGuarantee
        } else if (new Date(seller.createdAt).getTime() < boundaryMs) {
            convOld++
            convertedSellersOld.add(seller.dedupKey)
            gmvAcquired += p.minGuarantee
        }
    }
    const conversions = scopedCount(convNew, convOld, filters.conversionScope)

    return {
        leads,
        qualified,
        attemptedToContact,
        notQualified,
        visits,
        conversions,
        qualifiedSellerProperties,
        qualifyingProperties,
        pipelineCount,
        visitsNew,
        visitsOld,
        qualifyingNew,
        qualifyingOld,
        pipelineNew,
        pipelineOld,
        conversionsNew: convNew,
        conversionsOld: convOld,
        convertedSellersNew: convertedSellersNew.size,
        convertedSellersOld: convertedSellersOld.size,
        gmvAcquired,
    }
}

type VisitCase = 'always' | 'dated' | 'never'

/** Classifies a raw Acq_Status into the three-case rule. Anything matching neither
 *  ACQ_DATED_VISIT_STATUSES nor ACQ_ALWAYS_VISIT_STATUSES is 'never' — Case 1, the explicitly
 *  ignored statuses ('Attempted to Contact', blank), and any future/unrecognised status all
 *  land here. A closed-world read of the doc's exhaustive case tables. */
function classifyAcqStatus(acqStatus: string): VisitCase {
    const s = (acqStatus ?? '').trim()
    if (ACQ_ALWAYS.has(s)) return 'always'
    if (ACQ_DATED.has(s)) return 'dated'
    return 'never'
}

/** New-cohort qualifying-visit rule: Case 3 always counts, Case 2 counts with any Visit_Date
 *  present. Also used directly by the WoW visit charts, which only ever consider New-cohort
 *  sellers (bucketing is by the seller's own in-window creation week, so an Old-cohort seller
 *  can never get a bucket there regardless). */
function isQualifyingVisitNew(acqStatus: string, visitDate: string | null): boolean {
    const c = classifyAcqStatus(acqStatus)
    return c === 'always' || (c === 'dated' && !!visitDate)
}

/** Old-cohort qualifying-visit rule (Notion doc's "Old Visit" section, not just Case 1
 *  re-applied): every non-'never' status needs a Visit_Date that falls WITHIN
 *  [startMs, endMs) — no unconditional "always" exception, since an Old seller's status could
 *  have been reached in any past quarter and only an in-window date proves it belongs to
 *  this one. */
function isQualifyingVisitOld(acqStatus: string, visitDate: string | null, startMs: number, endMs: number): boolean {
    const c = classifyAcqStatus(acqStatus)
    return c !== 'never' && !!visitDate && instantInWindow(visitDate, startMs, endMs)
}

/** A property is "in pipeline" at Acq_Status 'Visit Scheduled' or 'Visit to be Scheduled'.
 *  aggregate.ts's fetch already bounds facts.pipelineProducts to just these two, but this
 *  mirrors isQualifyingVisit's defensive re-check rather than trusting the fetch silently. */
function isPipelineProperty(acqStatus: string): boolean {
    return ACQ_PIPELINE.has((acqStatus ?? '').trim())
}

/** Union of the New and/or Old cohort key sets, per the selected scope. */
function scopedUnion(newKeys: Set<string>, oldKeys: Set<string>, scope: Scope[]): Set<string> {
    const out = new Set<string>()
    if (scope.includes('New')) for (const k of newKeys) out.add(k)
    if (scope.includes('Old')) for (const k of oldKeys) out.add(k)
    return out
}

/** Per-property counts summed over the selected cohorts. */
function scopedCount(newCount: number, oldCount: number, scope: Scope[]): number {
    return (scope.includes('New') ? newCount : 0) + (scope.includes('Old') ? oldCount : 0)
}

/** Builds a ClusterPipelinePoint[] grouped by the seller's primary micromarket, stacked by
 *  Acq_Status — shared by the Pre-Visit Pipeline, Acq Pipeline and Stalled Conversions
 *  Micromarket charts. `productGate` carries each chart's own property-level filter (its status
 *  list, plus Stalled Conversions' extra Visit_Date-present check); `sellerGate` carries the
 *  New/Old cohort classification (see `windowSplit` below, which builds the New/Old pair every
 *  caller now needs). */
function groupByMicromarket(
    products: SellerProductFact[],
    sellersById: Map<string, SellerFact>,
    filters: SellerFilters,
    productGate: (p: SellerProductFact) => boolean,
    sellerGate: (seller: SellerFact) => boolean
): ClusterPipelinePoint[] {
    const map = new Map<string, ClusterPipelinePoint>()
    for (const p of products) {
        if (!productGate(p)) continue
        const seller = sellersById.get(p.sellerId)
        if (!seller || !seller.isQualified || !sellerMatches(seller, filters)) continue
        if (!sellerGate(seller)) continue
        const mm = mappedMicromarket(seller.micromarkets)
        const point = map.get(mm) ?? { cluster: mm, counts: {}, leadIds: {} }
        point.counts[p.acqStatus] = (point.counts[p.acqStatus] ?? 0) + 1
        ;(point.leadIds[p.acqStatus] ??= []).push(p.sellerId)
        map.set(mm, point)
    }
    const total = (pt: ClusterPipelinePoint) => Object.values(pt.counts).reduce((s: number, n) => s + (n ?? 0), 0)
    return [...map.values()].sort((a, b) => total(b) - total(a))
}

/** Window mode ("attribute basis lead creation time" — a lead counts only when ITS OWN
 *  creation date falls in the currently selected time window) + Till Date mode ("forever" — no
 *  time gate at all) both need the New/Old split available client-side, so the chart's own
 *  New/Old scope toggle (default Overall = both) can pick a cohort without a refetch. Rebuilt
 *  2026-09-24: the window/till-date toggle previously changed nothing under the default,
 *  unfiltered quarter view, because "Old" had no lower bound (any seller created before the
 *  window, however long ago) — collapsing Window to "created before the window ends", which is
 *  true of virtually every real lead. Window now means exactly what it says: New only.
 *
 *  Old is deliberately "everything NOT New" (not "created strictly before the window") — a lead
 *  created AFTER a narrowed window (e.g. an Aug-created lead while viewing a Jul-only period)
 *  must still show up once Till Date's restriction is lifted, the same as a lead from a prior
 *  quarter would. Old only ever appears once Till Date's time restriction is lifted; in Window
 *  mode it's structurally empty (a lead either belongs to the CURRENT window, or it doesn't). */
function windowSplit(
    products: SellerProductFact[],
    sellersById: Map<string, SellerFact>,
    filters: SellerFilters,
    productGate: (p: SellerProductFact) => boolean,
    funnelStartMs: number,
    funnelEndMs: number
): { window: CohortSplitPipeline; tillDate: CohortSplitPipeline } {
    const isNewCohort = (s: SellerFact) => instantInWindow(s.createdAt, funnelStartMs, funnelEndMs)
    const isOldCohort = (s: SellerFact) => !isNewCohort(s)
    const newGroup = groupByMicromarket(products, sellersById, filters, productGate, isNewCohort)
    const oldGroup = groupByMicromarket(products, sellersById, filters, productGate, isOldCohort)
    return {
        window: { new: newGroup, old: [] }, // Old is structurally empty in Window mode — see doc comment above
        tillDate: { new: newGroup, old: oldGroup },
    }
}

/** Conversions among Channel Partner-sourced sellers — same rule as the main conversions loop
 *  (MoU Signed, signing date inside the window), but over the separate pool `aggregate.ts` kept
 *  aside instead of the main population. Still no channel/source gate and this reading is never
 *  New/Old-scoped, per the user — Channel Partner sellers have no channel taxonomy of their own
 *  and the box is meant to show a flat total regardless of the visit/conversion scope pills. It
 *  DOES honour the Micromarket/Cluster filter (added 2026-09-09, per an explicit growth-team
 *  request) via `places`, the Channel Partner sellers' own Truva_Micromarket/Truva_Cluster —
 *  those fields are real and already fetched, just not previously carried through to this pool. */
function computeChannelPartnerConversions(
    products: SellerProductFact[],
    places: Record<string, { micromarkets: string[]; clusters: string[] }>,
    filters: SellerFilters,
    startMs: number,
    endMs: number
): number {
    let count = 0
    for (const p of products) {
        if (p.acqStatus !== ACQ_CONVERTED_STATUS) continue
        if (!p.mouSigningDate || !instantInWindow(p.mouSigningDate, startMs, endMs)) continue
        const place = places[p.sellerId]
        if (!placeMatches(place?.micromarkets ?? [], place?.clusters ?? [], filters)) continue
        count++
    }
    return count
}

/** Direct-side conversions for the "Total Conversions (Channel Partner + Direct)" float,
 *  place-and-time-only — mirrors computeChannelPartnerConversions's own placeMatches-only
 *  matching for its Channel Partner half, just over the main population instead of the CP pool.
 *  Added 2026-09-24 per an explicit growth-team request: "overall conversions (Channel partner +
 *  Direct) should only change basis the micromarket filter and time filter if changed" — picking
 *  a Channel today measurably moved this float (it summed actuals.conversionsNew/conversionsOld,
 *  which DO gate on sellerMatches' channel/source check), which the user says it should not.
 *  Every other conversions row/rate on this tab keeps reading the channel-aware actuals figures
 *  unchanged — this is a separate reading for this one float only. */
function computeDirectConversionsPlaceOnly(
    products: SellerProductFact[],
    sellersById: Map<string, SellerFact>,
    filters: SellerFilters,
    startMs: number,
    endMs: number
): number {
    let count = 0
    for (const p of products) {
        if (p.acqStatus !== ACQ_CONVERTED_STATUS) continue
        if (!p.mouSigningDate || !instantInWindow(p.mouSigningDate, startMs, endMs)) continue
        const seller = sellersById.get(p.sellerId)
        if (!seller || !placeMatches(seller.micromarkets, seller.clusters, filters)) continue
        count++
    }
    return count
}

export function deriveReport(facts: SellerFacts, opts: SellerDeriveOptions): Omit<SellerReportData, 'cachedAt'> {
    const { quarterStart, quarterEnd, now, filters } = opts

    const periods = filters.periods
    const { bucketStarts, labelOf, bucketOf, bucketIncomplete } = buildBuckets(periods, filters.grain, quarterStart, quarterEnd, now)

    // === The funnel's own time window — computed here (rather than down by computeActuals's
    // call site) so every other section below (the Micromarket pipeline charts, the WoW
    // Property Visits New/Old split) can gate on it too. FOLLOWS the selected time window; with
    // no time filter it's the reporting quarter. New vs Old still hinges on the seller's creation
    // date against the window start (mirroring the buyer funnel) — mirrors lib/buyer/derive.ts's
    // own windowFraction reasoning.
    const rangeStart = periods.length
        ? new Date(Math.min(...periods.map((p) => new Date(p.start).getTime())))
        : quarterStart
    const rangeEnd = periods.length
        ? new Date(Math.max(...periods.map((p) => new Date(p.end).getTime())))
        : quarterEnd
    const timeFiltered = periods.length > 0
    const funnelStart = timeFiltered ? rangeStart : quarterStart
    const funnelEnd = timeFiltered ? rangeEnd : quarterEnd
    const funnelStartMs = funnelStart.getTime()
    const funnelEndMs = funnelEnd.getTime()

    const sellersById = new Map(facts.sellers.map((s) => [s.id, s]))
    const listItems: Record<string, LeadListItem> = {}
    const record = (s: SellerFact) => {
        listItems[s.id] = {
            id: s.id,
            name: s.name,
            status: s.callStatusRaw || '—',
            source: s.channel,
            createdAt: s.createdAt,
        }
    }

    // === WoW Channel Performance — 6 charts, all stacked by the 7-channel DRR taxonomy (plus
    // the Unmapped catch-all), reusing exactly the metrics already built above rather than
    // inventing new ones.
    const leadsByChannel = emptySeries(bucketStarts, labelOf, bucketIncomplete)
    const qualifiedLeadsByChannel = emptySeries(bucketStarts, labelOf, bucketIncomplete)
    const leadsByStatus = emptySeries(bucketStarts, labelOf, bucketIncomplete)
    const qualifiedPropertiesByChannel = emptySeries(bucketStarts, labelOf, bucketIncomplete)
    const sellerVisitsByChannel = emptySeries(bucketStarts, labelOf, bucketIncomplete)
    // Pre-sales' own WoW Property Visits chart, stacked by New/Old cohort instead of Channel —
    // rebuilt 2026-09-24 per an explicit growth-team request ("stack old and new in the visits
    // chart. Attribution basis visit date."). Property-level (not deduped to the seller, same as
    // the by-Channel reading it replaces), but strict Visit_Date attribution ONLY — deliberately
    // WITHOUT the Case-3 seller-creation-date fallback the New-cohort qualifying-visit rule
    // otherwise allows, since an event chart can't place an undated event. See the two loops
    // below for New and Old.
    const propertyVisitsByCohort = emptySeries(bucketStarts, labelOf, bucketIncomplete)
    // Micromarket section's own WoW stack — same population/window gate as the New-cohort
    // qualifying-visit loop below (qualifying property, New-cohort visit rule, bucketed on
    // Visit_Date with the Case-3 fallback), but split by the PROPERTY's own Source into Direct
    // vs Channel Partner instead of by cohort.
    const propertyVisitsByDirectCp = emptySeries(bucketStarts, labelOf, bucketIncomplete)
    // Micromarket Analysis' two WoW stacks — same population/window gates as the by-channel
    // charts above, just keyed by the seller's PRIMARY micromarket instead of channel.
    const qualifiedLeadsByMicromarket = emptySeries(bucketStarts, labelOf, bucketIncomplete)
    const sellerVisitsByMicromarket = emptySeries(bucketStarts, labelOf, bucketIncomplete)
    // FRT (First Response Time), also bucketed by the seller's created week, same population
    // gate as everything else above.
    const frtMinutesByBucket: number[][] = bucketStarts.map(() => [])

    // #1, #2, #6: bucketed by the seller's own Created_Time. Population sellers only (primary,
    // in-window), so these sum to the pacing table's Leads figure. Also builds a per-seller
    // lookup (bucket index + channel + micromarket) that the property-level loops below reuse,
    // so they don't recompute bucketOf per property.
    interface SellerBucketInfo {
        idx: number
        channel: string
        micromarket: string
        dedupKey: string
        isQualified: boolean
    }
    const sellerBucket = new Map<string, SellerBucketInfo>()
    // Pre-sales: Not Qualified Reasons — same population/window gate as the WoW charts above,
    // built inside this same loop (mirrors lib/buyer/derive.ts's placement exactly).
    const reasonMap = new Map<string, { count: number; sellerIds: string[] }>()
    // The "Not Truva approved" slice's own sub-reasons, from the SEPARATE Truva_Qualified
    // multiselect field (Zoho API name verified live 2026-09-08, distinct from
    // Reason_for_Lead_Drop). A seller can carry more than one sub-reason, so these percentages
    // are of the "Not Truva approved" total (reasonMap's own count for that key), not of each
    // other — they can sum past 100%.
    const notTruvaApprovedSubReasonMap = new Map<string, { count: number; sellerIds: string[] }>()
    for (const s of facts.sellers) {
        if (!s.isPrimary || !s.inPopulation || !sellerMatches(s, filters)) continue
        const idx = bucketOf(s.createdAt)
        if (idx === undefined) continue
        record(s)
        const sellerMicromarket = mappedMicromarket(s.micromarkets)
        bump(leadsByChannel[idx]!, s.channel, s.id)
        bump(leadsByStatus[idx]!, s.callStatusFolded, s.id)
        if (s.isQualified) {
            bump(qualifiedLeadsByChannel[idx]!, s.channel, s.id)
            bump(qualifiedLeadsByMicromarket[idx]!, sellerMicromarket, s.id)
        }
        sellerBucket.set(s.id, {
            idx,
            channel: s.channel,
            micromarket: sellerMicromarket,
            dedupKey: s.dedupKey,
            isQualified: s.isQualified,
        })
        if (frtEligible(s)) {
            const minutes = frtMinutes(s.createdAt, s.responseAt)
            if (minutes != null) frtMinutesByBucket[idx]!.push(minutes)
        }
        if (s.callStatusFolded === 'Not qualified') {
            const reason = s.reasonForDrop || 'No Reason Given'
            const entry = reasonMap.get(reason) ?? { count: 0, sellerIds: [] }
            entry.count += 1
            entry.sellerIds.push(s.id)
            reasonMap.set(reason, entry)
            if (reason === 'Not Truva approved') {
                for (const sub of s.notTruvaQualifiedReasons) {
                    const subEntry = notTruvaApprovedSubReasonMap.get(sub) ?? { count: 0, sellerIds: [] }
                    subEntry.count += 1
                    subEntry.sellerIds.push(s.id)
                    notTruvaApprovedSubReasonMap.set(sub, subEntry)
                }
            }
        }
    }
    const notQualifiedReasons: ReasonPoint[] = [...reasonMap.entries()]
        .map(([reason, v]) => ({ reason, count: v.count, leadIds: v.sellerIds }))
        .sort((a, b) => b.count - a.count)
    const notTruvaApprovedSubReasons: ReasonPoint[] = [...notTruvaApprovedSubReasonMap.entries()]
        .map(([reason, v]) => ({ reason, count: v.count, leadIds: v.sellerIds }))
        .sort((a, b) => b.count - a.count)

    const frtByWeek: FrtWeekPoint[] = bucketStarts.map((s, i) => ({
        weekStart: dateKey(s),
        weekLabel: labelOf(s),
        ...summarizeFrt(frtMinutesByBucket[i]!),
    }))

    // #3: Qualified Properties by Channel — every property (any Acq_Status) of a qualified
    // seller, bucketed by the PROPERTY's own Created_Time — deliberately not the seller's, since
    // this isn't a visit concept (see #4/#5 below for why those two use a different date).
    // Drill-down is one entry PER PROPERTY, not deduped to the seller: a seller with 2
    // properties in one bucket/channel appears twice in that segment's list.
    for (const p of facts.products) {
        const info = sellerBucket.get(p.sellerId)
        if (!info?.isQualified) continue
        const idx = bucketOf(p.createdAt)
        if (idx === undefined) continue
        bump(qualifiedPropertiesByChannel[idx]!, info.channel, p.sellerId)
    }

    // #4, #5: qualifying visits, New-cohort rule only (bucketing is the seller's own in-window
    // week, so an Old-cohort seller can never land in one of these buckets regardless of which
    // rule is applied). Attribution date is the property's own Visit_Date, falling back to the
    // seller's Created_Time only for a date-less Case 3 property (a Case 2 property always has
    // a date already, since that's required to qualify at all) — per the DRR doc's "attributes
    // on visit date first, falls back to lead creation time" line, which had no effect until
    // these charts existed (no visits-over-time chart previously read it).
    //
    // #4 (Seller Visits) is deduped per seller per bucket — it's the "unique seller" reading,
    // mirroring Buyer's uniqueVisitsBySource. #5 (Property Visits) is not deduped: every
    // qualifying property bumps its own bucket, one drill-down entry per property, same as #3.
    const seenSellerBucket = new Set<string>()
    for (const p of facts.products) {
        const info = sellerBucket.get(p.sellerId)
        if (!info?.isQualified) continue
        if (!isQualifyingVisitNew(p.acqStatus, p.visitDate)) continue
        const seller = sellersById.get(p.sellerId)!
        const attributionDate = p.visitDate ?? seller.createdAt
        const idx = bucketOf(attributionDate)
        if (idx === undefined) continue

        bump(propertyVisitsByDirectCp[idx]!, p.source === 'Channel Partner' ? 'Channel Partner' : 'Direct', p.sellerId)

        // WoW Property Visits (New/Old stack) — strict Visit_Date attribution, deliberately
        // WITHOUT the Case-3 fallback used just above: a date-less Case-3 property is excluded
        // from this one chart rather than mis-dated to the seller's own creation week.
        if (p.visitDate) {
            const visitIdx = bucketOf(p.visitDate)
            if (visitIdx !== undefined) bump(propertyVisitsByCohort[visitIdx]!, 'New', p.sellerId)
        }

        const key = `${idx}|${info.dedupKey}`
        if (!seenSellerBucket.has(key)) {
            seenSellerBucket.add(key)
            bump(sellerVisitsByChannel[idx]!, info.channel, p.sellerId)
            bump(sellerVisitsByMicromarket[idx]!, info.micromarket, p.sellerId)
        }
    }

    // The "Channel Partner" half of WoW Property Visits — Direct vs. CP needed a look at the
    // SEPARATE Channel Partner pool (facts.channelPartnerProducts), not just facts.products.
    // Channel-Partner-SOURCED SELLERS are excluded from the whole dashboard's population
    // upstream (aggregate.ts's eligible(): mapSellerChannel returns null for that source), so a
    // CP-sourced seller's own properties never reach facts.products/sellerBucket — meaning this
    // chart's CP segment was structurally near-empty even though it's meant to split by the
    // PROPERTY's own Source, not the seller's. Fixed 2026-09-24 per an explicit growth-team
    // report ("cp visits are not showing... need to be mapped on property source"): this
    // separate pool is scanned too, same visit-qualifying rule, place-only filter (no
    // channel/source gate — CP sellers have no channel taxonomy of their own, same precedent as
    // computeChannelPartnerConversions), still keyed by the property's OWN Source field (so a
    // CP-sourced seller's property that happens to carry a different Source still lands in
    // 'Direct', not assumed 'Channel Partner'). No seller.createdAt is tracked for this pool, so
    // the Case-3 date fallback uses the property's own Created_Time instead. Not deduped to the
    // seller, same as the main population's own half of this chart just above.
    for (const p of facts.channelPartnerProducts) {
        if (!isQualifyingVisitNew(p.acqStatus, p.visitDate)) continue
        const place = facts.channelPartnerPlaces[p.sellerId]
        if (!placeMatches(place?.micromarkets ?? [], place?.clusters ?? [], filters)) continue
        const attributionDate = p.visitDate ?? p.createdAt
        const idx = bucketOf(attributionDate)
        if (idx === undefined) continue
        bump(propertyVisitsByDirectCp[idx]!, p.source === 'Channel Partner' ? 'Channel Partner' : 'Direct', p.sellerId)
    }

    // Old half of WoW Property Visits — isQualifyingVisitOld already requires an in-window
    // Visit_Date to qualify at all, so there's no fallback question here the way there is for
    // New's Case 3. Uses sellersById directly (not sellerBucket, which only ever holds
    // population sellers whose OWN createdAt falls in a weekly bucket — false for every
    // Old-cohort seller, by definition created before the funnel window).
    for (const p of facts.products) {
        const seller = sellersById.get(p.sellerId)
        if (!seller || !seller.isQualified || !sellerMatches(seller, filters)) continue
        if (instantInWindow(seller.createdAt, funnelStartMs, funnelEndMs)) continue // New cohort, handled above
        if (new Date(seller.createdAt).getTime() >= funnelStartMs) continue // neither New nor Old
        if (!isQualifyingVisitOld(p.acqStatus, p.visitDate, funnelStartMs, funnelEndMs)) continue
        const visitIdx = bucketOf(p.visitDate!)
        if (visitIdx === undefined) continue
        bump(propertyVisitsByCohort[visitIdx]!, 'Old', p.sellerId)
    }

    // === Pre-sales: Visits in Pipeline by Cluster — a live snapshot, deliberately IGNORING the
    // time filter entirely (mirrors lib/buyer/derive.ts's own pipeline chart: "what is queued
    // right now has no time dimension to slice"). Independent of computeActuals's own
    // New/Old-scoped pipelineCount below, which stays exactly as it was for the Overall Funnel
    // and Target vs Achieved table — this is a different, purely-current reading.
    const clusterMap = new Map<string, ClusterPipelinePoint>()
    for (const p of facts.products) {
        if (!isPipelineProperty(p.acqStatus)) continue
        const seller = sellersById.get(p.sellerId)
        if (!seller || !seller.isQualified || !sellerMatches(seller, filters)) continue
        const mm = mappedMicromarket(seller.micromarkets)
        const cluster = mm === 'Unmapped' ? 'Unmapped' : (MICROMARKET_TO_CLUSTER.get(mm) ?? 'Unmapped')
        const point = clusterMap.get(cluster) ?? { cluster, counts: {}, leadIds: {} }
        point.counts[mm] = (point.counts[mm] ?? 0) + 1
        ;(point.leadIds[mm] ??= []).push(p.sellerId)
        clusterMap.set(cluster, point)
    }
    const clusterTotalOf = (p: ClusterPipelinePoint) => Object.values(p.counts).reduce((s: number, n) => s + (n ?? 0), 0)
    const pipelineByCluster = [...clusterMap.values()].sort((a, b) => clusterTotalOf(b) - clusterTotalOf(a))

    // === Micromarket: Pre-Visit Pipeline by Micromarket — the SAME population as
    // pipelineByCluster (qualified seller, ACQ_PIPELINE_STATUSES), but grouped by micromarket ->
    // Acq_Status instead of cluster -> micromarket, so the status itself (Visit to be Scheduled
    // vs Visit Scheduled) is visible and filterable per components/seller/MicromarketStatusBar.tsx.
    // `.cluster` on the returned points holds the MICROMARKET name (reusing ClusterPipelinePoint's
    // shape, not its usual grouping).
    //
    // Windowed by the seller's own creation date, New/Old split (see `windowSplit`'s doc comment
    // above) — per an explicit growth-team request 2026-09-24 ("the pipeline visits count should
    // vary basis attribution to lead creation date... Window toggle to attribute basis lead
    // creation time and till date toggle to have a forever lead creation").
    const pipelineProductGate = (p: SellerProductFact) => isPipelineProperty(p.acqStatus)
    const pipelineSplit = windowSplit(facts.products, sellersById, filters, pipelineProductGate, funnelStartMs, funnelEndMs)
    const pipelineByMicromarket = pipelineSplit.window
    const pipelineByMicromarketTillDate = pipelineSplit.tillDate

    // === Micromarket: Acq Pipeline by Micromarket — "already visited" = Acq_Status in either
    // ACQ_ALWAYS_VISIT_STATUSES or ACQ_DATED_VISIT_STATUSES (Case 2/3 — a real, recognised
    // post-pipeline status), explicitly excluding both ACQ_PIPELINE_STATUSES (not yet visited)
    // and the Case-1 "never" bucket (Attempted to Contact/blank/unrecognised — not a real visit
    // signal either). Same qualified-seller gate as the pipeline chart above. Stacked BY
    // Acq_Status, micromarket on the x-axis. Windowed/split the same way as Pre-Visit Pipeline
    // above (the chart's own New/Old scope toggle replaces the page-level filters.visitScope pill
    // this used to read, so it works the same way in both Window and Till Date mode).
    const ACQ_VISITED_STATUSES = new Set<string>([...ACQ_ALWAYS_VISIT_STATUSES, ...ACQ_DATED_VISIT_STATUSES])
    const acqPipelineProductGate = (p: SellerProductFact) => ACQ_VISITED_STATUSES.has(p.acqStatus)
    const acqPipelineSplit = windowSplit(facts.products, sellersById, filters, acqPipelineProductGate, funnelStartMs, funnelEndMs)
    const acqPipelineByMicromarket = acqPipelineSplit.window
    const acqPipelineByMicromarketTillDate = acqPipelineSplit.tillDate

    // === Micromarket: Properties with Stalled Conversions — an exact, growth-team-supplied
    // status list (matches a reference chart they shared), gated additionally on Visit_Date
    // being present (a property that was never actually visited isn't "stalled" post-visit).
    // Same qualified-seller gate as the other Micromarket pipeline charts above. Stacked BY
    // Acq_Status, micromarket on the x-axis. Given the SAME Window/Till Date + New/Old treatment
    // 2026-09-24, per an explicit growth-team request ("Properties with stalled conversions
    // should have the same logic").
    const STALLED_CONVERSION_STATUSES = new Set<string>([
        'Visit to be Scheduled',
        'Visit Scheduled',
        'Valuation Completed',
        'Explore Later - Post Visit',
        'Request Valuation Range',
        'Valuation Range Received',
        'Offer Range Rolled Out',
    ])
    const stalledProductGate = (p: SellerProductFact) => STALLED_CONVERSION_STATUSES.has(p.acqStatus) && !!p.visitDate
    const stalledSplit = windowSplit(facts.products, sellersById, filters, stalledProductGate, funnelStartMs, funnelEndMs)
    const stalledConversionsByMicromarket = stalledSplit.window
    const stalledConversionsByMicromarketTillDate = stalledSplit.tillDate

    // === Micromarket: Post Visit TAT — rebuilt 2026-09-24 per an explicit growth-team request
    // ("Post Visit TAT chart needs to have visit complete count basis the visit logic. Time
    // attribution for a quarter etc. for a visit basis visit date logic for old and new."). Was a
    // live snapshot of the CURRENT Acq_Status distribution; now time-windowed by each stage's OWN
    // transition date, New/Old split (same cohort rule as every other visit metric on this tab).
    //
    // A property counts toward a stage when THAT STAGE's own date field falls in the window —
    // deliberately NOT gated on the property's current Acq_Status equalling the stage. These are
    // lifecycle timestamps that (per Zoho's usual convention) stay populated once a property
    // moves past that stage, so this counts "reached this stage in-window", cumulative across
    // stages, not "is currently sitting at this stage" (which is what the old live-snapshot
    // reading showed, and is still what Acq Pipeline by Micromarket shows). "Offer Made" counts
    // Offer Made to Seller only, per the user (not Offer Made to Broker). Same qualified-seller
    // gate as the pipeline charts above.
    //
    // Date fields verified live 2026-09-24 via the Metabase mirror (table 153): Visit_Date
    // (already used elsewhere), Valuation_Request_date (field_id t153-142, 36/36 populated for
    // Acq_Status = 'Sent for Valuation'), Pricing_completion_date (t153-143, 43/43 for 'Valuation
    // Completed'), Offer_Date (t153-139, 24/24 for 'Offer Made to Seller').
    const POST_VISIT_TAT_STAGES: Array<{ stage: string; dateOf: (p: SellerProductFact) => string | null }> = [
        { stage: 'Visit Completed', dateOf: (p) => p.visitDate },
        { stage: 'Sent for Valuation', dateOf: (p) => p.valuationRequestDate },
        { stage: 'Valuation Completed', dateOf: (p) => p.pricingCompletionDate },
        { stage: 'Offer Made to Seller', dateOf: (p) => p.offerDate },
    ]
    // "Visit Completed" is matched to the SAME population the funnel/table's own Property
    // Visits count uses (Unique/New/Old Property Visits) — per an explicit growth-team request
    // 2026-09-25 ("match the post visit TAT chart visit completed count with the property visit
    // count in the funnel and the table") — the qualifying-visit rule (isQualifyingVisitNew/Old,
    // the 3-case Acq_Status classification), not the blanket "does Visit_Date fall in window"
    // check the other 3 stages below still use. A genuine Case-1 "never" property (e.g. Junk)
    // with a stray Visit_Date populated no longer counts here, and a Case-3 New-cohort property
    // with NO Visit_Date now counts (it "always" qualifies, mirroring the funnel/table exactly)
    // — both now agree with every other property-visit reading on this tab.
    function qualifyingVisitStage(): { leadIdsNew: string[]; leadIdsOld: string[] } {
        const leadIdsNew: string[] = []
        const leadIdsOld: string[] = []
        for (const p of facts.products) {
            const seller = sellersById.get(p.sellerId)
            if (!seller || !seller.isQualified || !sellerMatches(seller, filters)) continue
            const isNew = instantInWindow(seller.createdAt, funnelStartMs, funnelEndMs)
            const isOld = !isNew && new Date(seller.createdAt).getTime() < funnelStartMs
            if (!isNew && !isOld) continue
            const ok = isNew
                ? isQualifyingVisitNew(p.acqStatus, p.visitDate)
                : isQualifyingVisitOld(p.acqStatus, p.visitDate, funnelStartMs, funnelEndMs)
            if (!ok) continue
            ;(isNew ? leadIdsNew : leadIdsOld).push(p.sellerId)
        }
        return { leadIdsNew, leadIdsOld }
    }
    const postVisitTatStages = POST_VISIT_TAT_STAGES.map(({ stage, dateOf }) => {
        if (stage === 'Visit Completed') {
            const { leadIdsNew, leadIdsOld } = qualifyingVisitStage()
            return { stage, countNew: leadIdsNew.length, countOld: leadIdsOld.length, leadIdsNew, leadIdsOld }
        }
        const leadIdsNew: string[] = []
        const leadIdsOld: string[] = []
        for (const p of facts.products) {
            const date = dateOf(p)
            if (!date || !instantInWindow(date, funnelStartMs, funnelEndMs)) continue
            const seller = sellersById.get(p.sellerId)
            if (!seller || !seller.isQualified || !sellerMatches(seller, filters)) continue
            const isNew = instantInWindow(seller.createdAt, funnelStartMs, funnelEndMs)
            const isOld = !isNew && new Date(seller.createdAt).getTime() < funnelStartMs
            if (isNew) leadIdsNew.push(p.sellerId)
            else if (isOld) leadIdsOld.push(p.sellerId)
        }
        return { stage, countNew: leadIdsNew.length, countOld: leadIdsOld.length, leadIdsNew, leadIdsOld }
    })

    // Average TAT between adjacent stages — days between the two stages' own transition dates,
    // over properties with BOTH dates populated and BOTH falling in the window (the transition
    // itself must have happened inside the selected period). Carries sum+count rather than a
    // pre-divided average so the chart's New/Old toggle can blend cohorts correctly (average of
    // the underlying day-differences, not an average of two averages).
    const postVisitTatTransitions = POST_VISIT_TAT_STAGES.slice(0, -1).map((from, i) => {
        const to = POST_VISIT_TAT_STAGES[i + 1]!
        let sumDaysNew = 0
        let pairsNew = 0
        let sumDaysOld = 0
        let pairsOld = 0
        for (const p of facts.products) {
            const fromDate = from.dateOf(p)
            const toDate = to.dateOf(p)
            if (!fromDate || !toDate) continue
            if (!instantInWindow(fromDate, funnelStartMs, funnelEndMs) || !instantInWindow(toDate, funnelStartMs, funnelEndMs)) continue
            const seller = sellersById.get(p.sellerId)
            if (!seller || !seller.isQualified || !sellerMatches(seller, filters)) continue
            const days = (new Date(toDate).getTime() - new Date(fromDate).getTime()) / DAY_MS
            const isNew = instantInWindow(seller.createdAt, funnelStartMs, funnelEndMs)
            const isOld = !isNew && new Date(seller.createdAt).getTime() < funnelStartMs
            if (isNew) {
                sumDaysNew += days
                pairsNew++
            } else if (isOld) {
                sumDaysOld += days
                pairsOld++
            }
        }
        return { from: from.stage, to: to.stage, sumDaysNew, pairsNew, sumDaysOld, pairsOld }
    })
    const postVisitTat: PostVisitTatData = { stages: postVisitTatStages, transitions: postVisitTatTransitions }

    // === Cards 1–4: pacing table + rates — reuses funnelStart/funnelEnd computed above.
    const actuals = computeActuals(facts, filters, sellersById, funnelStart, funnelEnd, funnelStart)

    // Targets come from the reporting quarter's grid, so they apply only to a window sitting
    // inside that quarter. A window equal to the quarter (the default, or that quarter picked
    // explicitly) shows the full target; a month or custom range inside it shows that slice's
    // day-pro-rata share; a window outside the quarter (no grid) shows blank targets — mirrors
    // lib/buyer/derive.ts's windowFraction exactly, so a filtered Seller window doesn't compare
    // a few weeks of actuals against the whole quarter's target.
    const quarterDays = (quarterEnd.getTime() - quarterStart.getTime()) / DAY_MS
    const insideQuarter =
        funnelStart.getTime() >= quarterStart.getTime() - DAY_MS &&
        funnelEnd.getTime() <= quarterEnd.getTime() + DAY_MS
    const windowFraction = insideQuarter
        ? Math.min(1, (funnelEnd.getTime() - funnelStart.getTime()) / DAY_MS / quarterDays)
        : 0
    const t = sellerTargetsFor({ channels: filters.channels, micromarkets: filters.micromarkets, sources: filters.sources })
    const gridApplies = insideQuarter && t.covered && windowFraction > 0
    /** The full quarter-grid value, scaled to the SELECTED window's day-share of the quarter —
     *  null when the window sits outside the quarter or the selection matches no grid cell.
     *  Mirrors lib/buyer/derive.ts's `targets` (its `fullTargets * windowFraction`). */
    function windowScaled(raw: number): number | null {
        return gridApplies ? raw * windowFraction : null
    }
    const targetFor: Record<string, number | null> = {
        Leads: windowScaled(t.leads),
        QL: windowScaled(t.ql),
    }

    // WHOLE days elapsed, not fractional — card 739 paces on `CURRENT_DATE - DATE '2026-07-05'`,
    // an integer day count, so a fractional pace drifts from the dashboard the growth team reads
    // (measured 2026-09-02: fractional gave Expected 1663 against Metabase's 1641). Flooring also
    // reads better: you don't earn part of a day's target part-way through it. The flooring
    // itself still applies now that `funnelStart` anchors on Jul 1, not Metabase's Jul 5 — only
    // the anchor date moved, this reasoning is independent of which one is used.
    const daysTotal = Math.round((funnelEnd.getTime() - funnelStart.getTime()) / DAY_MS)
    const daysElapsed = Math.min(Math.max(Math.floor((now.getTime() - funnelStart.getTime()) / DAY_MS), 0), daysTotal)
    const pace = daysTotal > 0 ? daysElapsed / daysTotal : 0
    const expectedPctOfTarget = Math.round(pace * 1000) / 10

    // === Micromarket Analysis — two "Overall Quarter" bullet bars (Qualified Seller Leads,
    // Qualified Seller Visits) against each in-scope micromarket's own ABSOLUTE quarter
    // target — the full JAS commitment, per the user, not the Target vs Achieved table's
    // paced-by-days-elapsed reading. Channel still narrows which grid rows are summed, same
    // as everywhere else; Time and pace do NOT scale it down — "Overall Quarter" means the
    // whole quarter's ceiling regardless of what's selected or how much of it has elapsed.
    // Which micromarkets appear still follows the Cluster/MM filter (micromarketsInScope);
    // the ACHIEVED bars beside this ceiling still respect Time like every other actual.
    const micromarketsForCharts = micromarketsInScope(filters)
    function absoluteMicromarketTarget(raw: number, covered: boolean): number | null {
        return covered ? Math.round(raw * 1000) / 1000 : null
    }
    const qualifiedByMm = new Map<string, number>(micromarketsForCharts.map((mm) => [mm, 0]))
    const visitedNewByMm = new Map<string, Set<string>>(micromarketsForCharts.map((mm) => [mm, new Set<string>()]))
    const visitedOldByMm = new Map<string, Set<string>>(micromarketsForCharts.map((mm) => [mm, new Set<string>()]))
    const mmFunnelStartMs = funnelStart.getTime()
    const mmFunnelEndMs = funnelEnd.getTime()
    for (const s of facts.sellers) {
        if (!s.isPrimary || !s.inPopulation || !s.isQualified || !sellerMatchesChannel(s, filters)) continue
        if (!instantInWindow(s.createdAt, mmFunnelStartMs, mmFunnelEndMs)) continue
        const mm = mappedMicromarket(s.micromarkets)
        const current = qualifiedByMm.get(mm)
        if (current === undefined) continue
        qualifiedByMm.set(mm, current + 1)
    }
    for (const p of facts.products) {
        const seller = sellersById.get(p.sellerId)
        if (!seller || !seller.isQualified || !sellerMatchesChannel(seller, filters)) continue
        const mm = mappedMicromarket(seller.micromarkets)
        if (!visitedNewByMm.has(mm)) continue
        const isNew = instantInWindow(seller.createdAt, mmFunnelStartMs, mmFunnelEndMs)
        const isOld = !isNew && new Date(seller.createdAt).getTime() < mmFunnelStartMs
        if (!isNew && !isOld) continue
        const ok = isNew
            ? isQualifyingVisitNew(p.acqStatus, p.visitDate)
            : isQualifyingVisitOld(p.acqStatus, p.visitDate, mmFunnelStartMs, mmFunnelEndMs)
        if (!ok) continue
        ;(isNew ? visitedNewByMm : visitedOldByMm).get(mm)!.add(seller.dedupKey)
    }
    const qualifiedLeadsByMicromarketQuarter: MicromarketTargetPoint[] = micromarketsForCharts.map((mm) => {
        const g = sellerTargetsFor({ channels: filters.channels, micromarkets: [mm], sources: filters.sources })
        return { micromarket: mm, actual: qualifiedByMm.get(mm) ?? 0, target: absoluteMicromarketTarget(g.ql, g.covered) }
    })
    const qualifiedVisitsByMicromarketQuarter: MicromarketTargetPoint[] = micromarketsForCharts.map((mm) => {
        const g = sellerTargetsFor({ channels: filters.channels, micromarkets: [mm], sources: filters.sources })
        // Respects the Visits scope pill, same as everywhere else the New/Old columns exist —
        // column L (Total) only when both are selected, column K (New) or J (Old) alone
        // otherwise, never a flat New+Old regardless of the filter.
        const visits = scopedCount(visitedNewByMm.get(mm)?.size ?? 0, visitedOldByMm.get(mm)?.size ?? 0, filters.visitScope)
        const target = scoped(filters.visitScope, g.newVisits, g.oldVisits, g.totalVisits)
        return { micromarket: mm, actual: visits, target: absoluteMicromarketTarget(target, g.covered) }
    })

    // === Target vs Achieved — Buyer's TwoWeekTable architecture, DRR metric set, no cost/spend
    // rows (Seller has no ad-spend data source at all). QTD column follows the selected time
    // filter (defaulting to the reporting quarter); Last 2-Week column is always the most recent
    // 2 complete Monday-Sunday IST weeks, exactly like every other Seller WoW chart — the time
    // filter does not move it, mirroring Buyer's own Last-2-Week column.
    const thisWeekStart = mondayOfIST(now)
    const twoWkStart = new Date(thisWeekStart.getTime() - 14 * DAY_MS)
    const w2Actuals = computeActuals(facts, filters, sellersById, twoWkStart, thisWeekStart, quarterStart)

    // Spend for the two columns. The QTD window follows the time filter, capped at `now` —
    // the growth team's "Seller side spends" sheet is committed for the WHOLE quarter up
    // front (verified live 2026-09-09: both spend sheets already carry rows through Sep 30,
    // three weeks past `now`), not filled in day by day, so summing the raw window counts
    // spend that hasn't been incurred yet as if it already had been. Reported 2026-09-09 by
    // the growth team against 3P specifically (99 Acres, Housing.com, Magicbricks), but the
    // cap applies uniformly — every channel's sheet is pre-filled the same way. The Last
    // 2-Week window never needs this: `thisWeekStart` is always <= `now` by construction.
    const spendCutoff = new Date(Math.min(Math.max(now.getTime(), funnelStart.getTime()), funnelEnd.getTime()))
    const qSpend = computeSellerSpendForWindow(facts, filters, funnelStart, spendCutoff)
    const w2Spend = computeSellerSpendForWindow(facts, filters, twoWkStart, thisWeekStart)

    // Row order rebuilt 2026-09-22 per an explicit growth-team-supplied sequence — Spend (+CPL)
    // at the top, then 8 primary rows each with their own sub-fields nested right after them.
    // See lib/seller/types.ts's SELLER_PRIMARY_METRICS for which of these render bold/flush-left.
    type Unit = 'count' | '%' | 'currency' | 'x'
    const UNITS: Record<string, Unit> = {
        // Spend and its one cost-per sub-row that has no volume metric of its own to nest under.
        // No spend target exists — the Metabase card 739 grid has no spend column — so every
        // cost-per row shows a dash in both target columns and only the achieved figure is real.
        // See qTargetsFull below.
        Spend: 'currency',
        // Added 2026-09-24, per an explicit growth-team request — sum of Products.Min_Guarantee
        // over the exact same MoU-Signed, in-window population as Total Property Conversions
        // (New+Old combined, unconditional on the scope pills, same as Spend itself). No grid
        // target exists for either — dash everywhere except the Achieved columns, same
        // treatment as Visits in Pipeline/Attempted to Contact/Not Qualified below.
        'GMV Acquired': 'currency',
        '% Spends of GMV': '%',
        'CPL': 'currency',
        'Total Leads': 'count',
        'Total Qualified Seller Leads': 'count',
        // Added 2026-09-23, per an explicit growth-team request — same population/filters as
        // Total Leads above (Time, Channel, Cluster/MM all apply), no grid target exists for
        // either so both show a dash everywhere except the Achieved columns, same treatment as
        // Visits in Pipeline below. Changed to a % of Total Leads 2026-09-24, per an explicit
        // growth-team request ("ATC% and NQ% in place of absolute numbers") — same denominator
        // LTQL % uses, so the three read together as "of every lead, this much qualified, this
        // much couldn't be reached, this much didn't qualify".
        'Attempted to Contact %': '%',
        'Not Qualified %': '%',
        'Qualified Property Leads': 'count',
        'LTQL %': '%',
        'CPQL': 'currency',
        'Unique Seller Total Visits': 'count',
        'Unique Seller New Visits': 'count',
        'Unique Seller Old Visits': 'count',
        'QLTV %': '%',
        // Renamed from 'Total Property Visits' — same number, terminology now matches "Unique
        // Seller Total Visits" above it.
        'Unique Property Total Visits': 'count',
        'New Property Visits': 'count',
        'Old Property Visits': 'count',
        'CPV': 'currency',
        // Was its own primary row; now nests under Unique Property Total Visits, per the user.
        'Visits in Pipeline': 'count',
        // Renamed from 'Total Conversions' — this row was always property-level/undeduped (see
        // Actuals.conversionsNew/conversionsOld's doc comment), unlike the Overall Funnel
        // (Unique Seller)'s own newConversions/oldConversions, which are seller-deduped.
        'Total Property Conversions': 'count',
        'New Conversions': 'count',
        'Old Conversions': 'count',
        'CAC': 'currency',
    }
    const METRIC_ORDER = Object.keys(UNITS)
    // Rates don't shrink with either window — a target LTQL% is the same expectation on day 1
    // as on day 90. Every other row is a volume metric and gets paced.
    // Cost-per rows are rates too: a ₹1,000 target cost per lead is the same expectation on
    // day 1 as on day 90. Listed here even though no cost target exists yet, so that the day
    // one arrives it isn't silently pro-rated by days elapsed.
    const RATE_METRICS = new Set([
        'LTQL %',
        'QLTV %',
        '% Spends of GMV',
        'Attempted to Contact %',
        'Not Qualified %',
        'CPL',
        'CPQL',
        'CPV',
        'CAC',
    ])
    // Lower is better for a cost-per metric — overspending is the "behind" direction, the
    // opposite of every other row where more is better. Spend itself is NOT here: whether
    // spending more than planned is good or bad depends on what it bought, so it is left
    // unsigned rather than coloured wrongly. Mirrors lib/buyer/derive.ts's own set. Attempted to
    // Contact %/Not Qualified % belong here too (fewer unreachable/unqualified leads is always
    // better) — currently a no-op since neither has a grid target (lagFor short-circuits before
    // this is ever read), but correct if one is ever added.
    const LOWER_IS_BETTER = new Set([
        'CPL',
        'CPQL',
        'CPV',
        'CAC',
        'Attempted to Contact %',
        'Not Qualified %',
    ])

    /** `isQuarterColumn` gates only the conversion cost — see the note on that row. */
    function actualsRow(a: Actuals, spend: number, isQuarterColumn: boolean): Record<string, number | null> {
        return {
            'Total Leads': a.leads,
            'Total Qualified Seller Leads': a.qualified,
            'Attempted to Contact %': ratioPct(a.attemptedToContact, a.leads),
            'Not Qualified %': ratioPct(a.notQualified, a.leads),
            'LTQL %': ratioPct(a.qualified, a.leads),
            'Qualified Property Leads': a.qualifiedSellerProperties,
            'Unique Seller Total Visits': a.visitsNew + a.visitsOld,
            'Unique Seller New Visits': a.visitsNew,
            'Unique Seller Old Visits': a.visitsOld,
            // Always New visits, per the user — not gated by the visitScope filter pill.
            'QLTV %': ratioPct(a.visitsNew, a.qualified),
            'Unique Property Total Visits': a.qualifyingNew + a.qualifyingOld,
            'New Property Visits': a.qualifyingNew,
            'Old Property Visits': a.qualifyingOld,
            // Quarter column: New+Old combined, a live "till date" read — anyone currently
            // sitting in pipeline, whether their own lead was created this quarter or carried
            // over from before it. Last 2wk column: New only — per an explicit growth-team
            // clarification 2026-09-25 ("the visits in pipeline column should include people
            // whose leads were created last two weeks and are now in the pipeline"), this column
            // means "of the leads that came in during the last two weeks, how many are
            // currently in pipeline" — the same "created in this window" population every other
            // Last-2wk row already uses (Total Leads, ATC %, NQ %), not a live snapshot widened
            // by an Old bucket that isn't really a "last two weeks" figure at all.
            'Visits in Pipeline': isQuarterColumn ? a.pipelineNew + a.pipelineOld : a.pipelineNew,
            'Total Property Conversions': a.conversionsNew + a.conversionsOld,
            'New Conversions': a.conversionsNew,
            'Old Conversions': a.conversionsOld,
            Spend: spend,
            'GMV Acquired': a.gmvAcquired,
            '% Spends of GMV': ratioPct(spend, a.gmvAcquired),
            // Cost denominators pin to the NEW cohort regardless of the scope pills, per
            // docs/metric-skill/references/metric-definitions.md: spend buys new sellers, and
            // an old-cohort visit was paid for in an earlier quarter. The labels say "New" so
            // they can never silently disagree with the Total/Old rows above them.
            'CPL': costPer(spend, a.leads),
            'CPQL': costPer(spend, a.qualified),
            // Denominator changed 2026-09-22 from the unique-seller new-visit count (a.visitsNew)
            // to the property-level one (a.qualifyingNew), per the user, so this row's basis
            // matches the "Unique Property Total Visits" section it's now nested under rather
            // than the seller-level section above it.
            'CPV': costPer(spend, a.qualifyingNew),
            // Suppressed outside the quarter column, mirroring Buyer's CAC: a seller MoU signed
            // in the last two weeks was bought by spend from months earlier, so dividing one
            // fortnight's spend by that fortnight's conversions is a number with no meaning.
            // It reads as a real figure, which is worse than a dash.
            'CAC': isQuarterColumn ? costPer(spend, a.conversionsNew) : null,
        }
    }
    const qActualsRow = actualsRow(actuals, qSpend.total, true)
    const w2ActualsRow = actualsRow(w2Actuals, w2Spend.total, false)

    const newVisitsTargetQ = windowScaled(t.newVisits)
    const oldVisitsTargetQ = windowScaled(t.oldVisits)
    const totalVisitsTargetQ = windowScaled(t.totalVisits)
    const qlTargetQ = windowScaled(t.ql)
    const leadsTargetQ = windowScaled(t.leads)
    const newConvTargetQ = windowScaled(t.newConv)
    const oldConvTargetQ = windowScaled(t.oldConv)
    const totalConvTargetQ = windowScaled(t.totalConv)
    const spendTargetQ = windowScaled(t.spendInr)
    // Null, never 0, whenever spend or the denominator is absent — mirrors lib/buyer/derive.ts's
    // divTarget and lib/seller/costs.ts's costPer (a real 0 target would read as "spend nothing
    // and still hit it").
    const divTarget = (n: number | null, d: number | null): number | null => (n != null && n > 0 && d != null && d > 0 ? n / d : null)
    const qTargetsFull: Record<string, number | null> = {
        'Total Leads': leadsTargetQ,
        'Total Qualified Seller Leads': qlTargetQ,
        // No grid column exists for either — null throughout, same reasoning as Visits in
        // Pipeline/Property Visits below.
        'Attempted to Contact %': null,
        'Not Qualified %': null,
        'LTQL %': safeRatio(qlTargetQ, leadsTargetQ),
        // Reuses Total Qualified Seller Leads' own target directly, per the user (2026-09-24) —
        // replaces the earlier 1.2x-of-Leads placeholder, same "share the seller-level target"
        // treatment already given to the Qualified Property Visits rows below.
        'Qualified Property Leads': qlTargetQ,
        'Unique Seller Total Visits': totalVisitsTargetQ,
        'Unique Seller New Visits': newVisitsTargetQ,
        'Unique Seller Old Visits': oldVisitsTargetQ,
        'QLTV %': safeRatio(newVisitsTargetQ, qlTargetQ),
        // Reuse the SAME seller-level visit targets, per the user — there is no separate grid
        // column for property-level visits, and the property-visit rows are the property-level
        // reading of the exact same underlying visit population, so they share a target rather
        // than showing a dash. Visits in Pipeline still has nothing to reuse (it isn't a visit
        // count at all) and stays null.
        'Unique Property Total Visits': totalVisitsTargetQ,
        'New Property Visits': newVisitsTargetQ,
        'Old Property Visits': oldVisitsTargetQ,
        'Visits in Pipeline': null,
        'Total Property Conversions': totalConvTargetQ,
        'New Conversions': newConvTargetQ,
        'Old Conversions': oldConvTargetQ,
        // Spend and the cost-per targets, from the target grid's own spendInr column
        // (Truva_JAS26_Planning_ChannelLevel.xlsx, "MM-WISE View (Seller)") — divided by the
        // SAME window-scaled targets the achieved cost figures divide by, mirroring
        // lib/buyer/derive.ts's own CPL/CPQL/CPV/CAC target derivation exactly.
        Spend: spendTargetQ,
        // No grid column exists for GMV — null throughout, same reasoning as Visits in
        // Pipeline/Property Visits above.
        'GMV Acquired': null,
        '% Spends of GMV': null,
        CPL: divTarget(spendTargetQ, leadsTargetQ),
        CPQL: divTarget(spendTargetQ, qlTargetQ),
        // CPV's achieved denominator is property-level new visits (a.qualifyingNew, see
        // actualsRow) — now that New Property Visits reuses newVisitsTargetQ above instead of
        // being null, CPV's target can divide by that same figure, same pattern as CPL/CPQL.
        CPV: divTarget(spendTargetQ, newVisitsTargetQ),
        CAC: divTarget(spendTargetQ, newConvTargetQ),
    }

    function pacedQTarget(metric: string): number | null {
        const full = qTargetsFull[metric] ?? null
        if (full == null) return null
        if (RATE_METRICS.has(metric)) return full
        return Math.round(full * pace * 1000) / 1000
    }
    // A 14-day pro-rata share of the FULL (window-scaled) quarter target — a separate slice
    // from the QTD pacing above, not compounded with it. Mirrors lib/buyer/derive.ts exactly.
    const w2Share = daysTotal > 0 ? 14 / daysTotal : 0
    function w2TargetFor(metric: string): number | null {
        const full = qTargetsFull[metric] ?? null
        if (full == null) return null
        if (RATE_METRICS.has(metric)) return full
        return Math.round(full * w2Share * 1000) / 1000
    }
    // A deficit-based catch-up target: whatever's left to hit the FULL quarter target
    // (qTargetFull - qAchieved so far), spread evenly over the days remaining, then sliced to a
    // fortnight. Steeper than w2TargetFor's flat run-rate share when behind pace, easier when
    // ahead — floored at 0 so a metric already past its full target never asks for a negative
    // catch-up. Purely informational, additive to nextW2Target — never written to, never
    // affects the team's own typed Channel x Cluster grid.
    const remainingDays = daysTotal - daysElapsed
    function nextW2TargetProRataFor(metric: string): number | null {
        const full = qTargetsFull[metric] ?? null
        if (full == null) return 0
        if (RATE_METRICS.has(metric)) return full
        if (remainingDays <= 0) return 0
        const achieved = qActualsRow[metric] ?? 0
        const deficit = full - achieved
        return Math.round(Math.max(0, deficit * (14 / remainingDays)) * 1000) / 1000
    }
    function lagFor(metric: string, target: number | null, achieved: number | null): number | null {
        if (target == null || achieved == null) return null
        // Positive means behind. For a cost-per row that is achieved ABOVE target, so the
        // subtraction flips — otherwise overspending would render green.
        const diff = LOWER_IS_BETTER.has(metric) ? achieved - target : target - achieved
        return Math.round(diff * 1000) / 1000
    }

    const targetVsAchieved: TwoWeekRow[] = METRIC_ORDER.map((metric) => {
        const qTarget = pacedQTarget(metric)
        const qAchieved = qActualsRow[metric] ?? null
        const qTargetFull = qTargetsFull[metric] ?? null
        const w2Target = w2TargetFor(metric)
        const w2Achieved = w2ActualsRow[metric] ?? null
        return {
            metric,
            unit: UNITS[metric]!,
            qTarget,
            qAchieved,
            qLag: lagFor(metric, qTarget, qAchieved),
            qTargetFull,
            // Progress toward the WHOLE quarter's goal — a different read from qLag, which
            // compares against the paced (days-elapsed) target instead. Mirrors
            // lib/buyer/derive.ts's own qPctCompleted exactly; Seller never set this before
            // 2026-09-22, so its Qtr Target/% Completed columns were silently blank.
            qPctCompleted: safeRatio(qAchieved, qTargetFull),
            w2Target,
            w2Achieved,
            w2Lag: lagFor(metric, w2Target, w2Achieved),
            // Same flat-rate formula as w2Target — the run-rate target for the next 2 weeks is
            // identical to the last 2 weeks', there is just no achieved figure for it yet.
            nextW2Target: w2TargetFor(metric),
            nextW2TargetProRata: nextW2TargetProRataFor(metric),
        }
    })

    // "Total Conversions (Channel Partner + Direct)" — the Overall Funnel's extra float box.
    // Both halves are place-and-time-only: no channel/source gate, not scoped by the
    // visit/conversion pills, per an explicit growth-team request ("overall conversions...
    // should only change basis the micromarket filter and time filter if changed") — see
    // computeDirectConversionsPlaceOnly's doc comment for why Direct's own reading changed
    // 2026-09-24 (it used to reuse actuals.conversionsNew/conversionsOld, which DO gate on
    // channel/source). Still respects the selected time window (funnelStart/funnelEnd), same as
    // everything else on the funnel.
    const channelPartnerConversions = computeChannelPartnerConversions(
        facts.channelPartnerProducts,
        facts.channelPartnerPlaces,
        filters,
        funnelStart.getTime(),
        funnelEnd.getTime()
    )
    const directConversionsTotal = computeDirectConversionsPlaceOnly(facts.products, sellersById, filters, funnelStart.getTime(), funnelEnd.getTime())
    const totalConversionsWithChannelPartner = directConversionsTotal + channelPartnerConversions

    // The Overview stat tiles' own reading, pill-scoped by filters.visitScope/conversionScope —
    // separate from the funnel diagram's own per-arm rates below, which are unconditional.
    const ltqlPct = ratioPct(actuals.qualified, actuals.leads)
    const qltvPct = ratioPct(actuals.visits, actuals.qualified)
    const convRatePct = ratioPct(actuals.conversions, actuals.visits)

    // Rate target — ratio of the target grid's own values, not independently entered. Mirrors
    // lib/buyer/derive.ts's LTQL %/QL-V % target computation.
    const ltqlTarget = safeRatio(targetFor.QL ?? null, targetFor.Leads ?? null)

    // The Overall Funnel (Unique Seller)'s own per-arm rates — New/Old, unconditionally.
    // Visits use the same actuals.visitsNew/visitsOld the Target vs Achieved table's New/Old
    // Visits rows use; Conversions use the seller-DEDUPED convertedSellersNew/convertedSellersOld
    // (added 2026-09-22 — see computeActuals) so this funnel's numbers genuinely mean "how many
    // sellers", not "how many properties". The Overall Funnel (Unique Property) below uses the
    // undeduped conversionsNew/conversionsOld instead, same basis as the table.
    const newQltvPct = ratioPct(actuals.visitsNew, actuals.qualified)
    const oldQltvPct = ratioPct(actuals.visitsOld, actuals.qualified)
    const newConvRatePct = ratioPct(actuals.convertedSellersNew, actuals.visitsNew)
    const oldConvRatePct = ratioPct(actuals.convertedSellersOld, actuals.visitsOld)
    const newQltvTarget = safeRatio(newVisitsTargetQ, qlTargetQ)
    const oldQltvTarget = safeRatio(oldVisitsTargetQ, qlTargetQ)
    // Target reuses the same grid-sourced newConvTargetQ/oldConvTargetQ the property funnel and
    // the table use — there's only one New/Old conversions target column, no separate
    // seller-deduped one, so this is an approximation (deduped actual vs undeduped target) but
    // the only target data that exists.
    const newConvRateTarget = safeRatio(newConvTargetQ, newVisitsTargetQ)
    const oldConvRateTarget = safeRatio(oldConvTargetQ, oldVisitsTargetQ)

    // The Overall Funnel (Unique Property)'s own achieved rates — see SellerOverallFunnelPropertyData's
    // doc comment in lib/seller/types.ts for why this funnel has no "Leads -> Qualified" rate
    // label. Its TARGETS, per an explicit growth-team request, are now identical to the Overall
    // Funnel (Unique Seller)'s own — reused directly below rather than recomputed — even though
    // this funnel's actuals are property-level/undeduped. That's a deliberate approximation (a
    // property-level count compared against a seller-level target), not a claim the two mean the
    // same thing.
    const qualPct = ratioPct(actuals.qualifiedSellerProperties, actuals.leads)
    const newVisitPct = ratioPct(actuals.qualifyingNew, actuals.qualifiedSellerProperties)
    const oldVisitPct = ratioPct(actuals.qualifyingOld, actuals.qualifiedSellerProperties)
    const propNewConvRatePct = ratioPct(actuals.conversionsNew, actuals.qualifyingNew)
    const propOldConvRatePct = ratioPct(actuals.conversionsOld, actuals.qualifyingOld)

    // The Overview section's funnel diagram — see components/seller/OverallFunnel.tsx for how
    // the arms and float boxes are positioned and labelled. Changed 2026-09-21 from a single
    // pill-scoped Visits/Conversions node each to a branching New/Old shape — see
    // SellerOverallFunnelData's doc comment in lib/seller/types.ts.
    const overallFunnel: SellerReportData['overallFunnel'] = {
        uniqueLeads: { actual: actuals.leads, target: targetFor.Leads ?? null },
        qualified: { actual: actuals.qualified, target: targetFor.QL ?? null },
        newVisits: { actual: actuals.visitsNew, target: newVisitsTargetQ },
        oldVisits: { actual: actuals.visitsOld, target: oldVisitsTargetQ },
        totalVisits: { actual: actuals.visitsNew + actuals.visitsOld, target: totalVisitsTargetQ },
        // Seller-deduped (convertedSellersNew/Old), NOT the property-level conversionsNew/Old
        // the table and the Overall Funnel (Unique Property) use — see computeActuals.
        newConversions: { actual: actuals.convertedSellersNew, target: newConvTargetQ },
        oldConversions: { actual: actuals.convertedSellersOld, target: oldConvTargetQ },
        totalConversions: { actual: actuals.convertedSellersNew + actuals.convertedSellersOld, target: totalConvTargetQ },
        pipelineCount: actuals.pipelineNew + actuals.pipelineOld,
        directConversionsTotal,
        totalConversionsWithChannelPartner,
        ltqlPct,
        newQltvPct,
        oldQltvPct,
        newConvRatePct,
        oldConvRatePct,
        ltqlTarget,
        newQltvTarget,
        oldQltvTarget,
        newConvRateTarget,
        oldConvRateTarget,
    }

    // "Overall Funnel (Unique Property)" — components/seller/OverallFunnelProperty.tsx. Every
    // node counts PROPERTIES, not deduped to a seller — see SellerOverallFunnelPropertyData's
    // doc comment in lib/seller/types.ts. Every target below is the SAME value the Overall
    // Funnel (Unique Seller) uses for its corresponding node/rate, per an explicit growth-team
    // request — see the comment above where the achieved rates are computed. Also carries its
    // own "Total Conversions (Channel Partner + Direct)" float, same numbers as the Unique
    // Seller funnel's (directConversionsTotal is already property-level/undeduped).
    const overallFunnelProperty: SellerReportData['overallFunnelProperty'] = {
        uniqueLeads: { actual: actuals.leads, target: targetFor.Leads ?? null },
        qualifiedProperties: { actual: actuals.qualifiedSellerProperties, target: qlTargetQ },
        newVisits: { actual: actuals.qualifyingNew, target: newVisitsTargetQ },
        oldVisits: { actual: actuals.qualifyingOld, target: oldVisitsTargetQ },
        totalVisits: { actual: actuals.qualifyingNew + actuals.qualifyingOld, target: totalVisitsTargetQ },
        newConversions: { actual: actuals.conversionsNew, target: newConvTargetQ },
        oldConversions: { actual: actuals.conversionsOld, target: oldConvTargetQ },
        totalConversions: { actual: actuals.conversionsNew + actuals.conversionsOld, target: totalConvTargetQ },
        pipelineCount: actuals.pipelineNew + actuals.pipelineOld,
        directConversionsTotal,
        totalConversionsWithChannelPartner,
        qualPct,
        qualTarget: ltqlTarget,
        newVisitPct,
        oldVisitPct,
        newVisitTarget: newQltvTarget,
        oldVisitTarget: oldQltvTarget,
        newConvRatePct: propNewConvRatePct,
        oldConvRatePct: propOldConvRatePct,
        newConvRateTarget,
        oldConvRateTarget,
    }

    return {
        quarterLabel: SELLER_QUARTER_LABEL,
        expectedPctOfTarget,
        windowWeeks: bucketStarts.length,
        targetVsAchieved,
        spendIngest: facts.spendIngest,
        spendExcludedUnallocated: qSpend.excludedUnallocated,
        ltqlPct,
        qltvPct,
        convRatePct,
        overallFunnel,
        overallFunnelProperty,
        leadsByChannel,
        qualifiedLeadsByChannel,
        leadsByStatus,
        qualifiedPropertiesByChannel,
        sellerVisitsByChannel,
        propertyVisitsByCohort,
        propertyVisitsByDirectCp,
        notQualifiedReasons,
        notTruvaApprovedSubReasons,
        frtByWeek,
        pipelineByCluster,
        pipelineByMicromarket,
        pipelineByMicromarketTillDate,
        acqPipelineByMicromarket,
        acqPipelineByMicromarketTillDate,
        stalledConversionsByMicromarket,
        stalledConversionsByMicromarketTillDate,
        postVisitTat,
        qualifiedLeadsByMicromarketQuarter,
        qualifiedVisitsByMicromarketQuarter,
        qualifiedLeadsByMicromarket,
        sellerVisitsByMicromarket,
        sellersById: listItems,
    }
}
