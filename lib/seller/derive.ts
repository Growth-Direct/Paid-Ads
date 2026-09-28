import type { ReasonPoint, TwoWeekRow } from '@/lib/buyer/types'
import type { CostWeekPoint } from '@/lib/buyer/types'
import type { SellerFact, SellerFacts, SellerProductFact } from './facts'
import { type SellerFilters, type Scope, placeMatches, sellerMatches, sellerMatchesChannel } from './filters'
import { computeSellerSpendByWeek, computeSellerSpendForWindow, costPer } from './costs'
// MICROMARKET_TO_CLUSTER lives in shared.ts (not here) so the chart components can import it
// too, for their own cluster-grouped tooltips — both derive cluster from the seller's PRIMARY
// micromarket rather than trusting the seller's own Truva_Cluster field, which disagrees with
// micromarket on about a third of records (CLAUDE.md's "never AND cluster against micromarket"
// rule) and is documented as especially poor on sellers ("Unknown dominates").
import { MICROMARKET_TO_CLUSTER, buildBuckets, dateKey, micromarketsInScope, mondayOfIST } from './shared'
import { scoped, sellerTargetsFor } from './targets'
import {
    ACQ_ALWAYS_VISIT_STATUSES,
    ACQ_CONVERTED_STATUS,
    ACQ_DATED_VISIT_STATUSES,
    ACQ_PIPELINE_STATUSES,
    SELLER_QUARTER_LABEL,
    type ClusterPipelinePoint,
    type LeadListItem,
    type MicromarketTargetPoint,
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

interface Actuals {
    leads: number
    qualified: number
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
    for (const p of facts.products) {
        if (p.acqStatus !== ACQ_CONVERTED_STATUS) continue
        if (!p.mouSigningDate || !instantInWindow(p.mouSigningDate, startMs, endMs)) continue
        const seller = sellerById.get(p.sellerId)
        if (!seller || !sellerMatches(seller, filters)) continue
        if (instantInWindow(seller.createdAt, startMs, endMs)) convNew++
        else if (new Date(seller.createdAt).getTime() < boundaryMs) convOld++
    }
    const conversions = scopedCount(convNew, convOld, filters.conversionScope)

    return {
        leads,
        qualified,
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

export function deriveReport(facts: SellerFacts, opts: SellerDeriveOptions): Omit<SellerReportData, 'cachedAt'> {
    const { quarterStart, quarterEnd, now, filters } = opts

    const periods = filters.periods
    const { bucketStarts, labelOf, bucketOf, bucketIncomplete } = buildBuckets(periods, filters.grain, quarterStart, quarterEnd, now)

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
    const propertyVisitsByChannel = emptySeries(bucketStarts, labelOf, bucketIncomplete)
    // Micromarket Analysis' two WoW stacks — same population/window gates as the by-channel
    // charts above, just keyed by the seller's PRIMARY micromarket instead of channel.
    const qualifiedLeadsByMicromarket = emptySeries(bucketStarts, labelOf, bucketIncomplete)
    const sellerVisitsByMicromarket = emptySeries(bucketStarts, labelOf, bucketIncomplete)

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
        const primaryMicromarket = s.micromarkets[0] || 'Unknown'
        bump(leadsByChannel[idx]!, s.channel, s.id)
        bump(leadsByStatus[idx]!, s.callStatusFolded, s.id)
        if (s.isQualified) {
            bump(qualifiedLeadsByChannel[idx]!, s.channel, s.id)
            bump(qualifiedLeadsByMicromarket[idx]!, primaryMicromarket, s.id)
        }
        sellerBucket.set(s.id, {
            idx,
            channel: s.channel,
            micromarket: primaryMicromarket,
            dedupKey: s.dedupKey,
            isQualified: s.isQualified,
        })
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

        bump(propertyVisitsByChannel[idx]!, info.channel, p.sellerId)

        const key = `${idx}|${info.dedupKey}`
        if (!seenSellerBucket.has(key)) {
            seenSellerBucket.add(key)
            bump(sellerVisitsByChannel[idx]!, info.channel, p.sellerId)
            bump(sellerVisitsByMicromarket[idx]!, info.micromarket, p.sellerId)
        }
    }

    // === Added 2026-09-26: "(by created week)" variants — same qualifying-visit rule and
    // same per-seller/per-property grain as sellerVisitsByChannel/propertyVisitsByChannel
    // just above, bucketed by the SELLER's own created week instead of the qualifying
    // visit's attribution date. `info.idx` (built in the population loop above) already IS
    // bucketOf(seller.createdAt) — no need to recompute it.
    const sellerVisitsByChannelCreatedWeek = emptySeries(bucketStarts, labelOf, bucketIncomplete)
    const propertyVisitsByChannelCreatedWeek = emptySeries(bucketStarts, labelOf, bucketIncomplete)
    const seenSellerBucketCreated = new Set<string>()
    for (const p of facts.products) {
        const info = sellerBucket.get(p.sellerId)
        if (!info?.isQualified) continue
        if (!isQualifyingVisitNew(p.acqStatus, p.visitDate)) continue

        bump(propertyVisitsByChannelCreatedWeek[info.idx]!, info.channel, p.sellerId)

        const key = `${info.idx}|${info.dedupKey}`
        if (!seenSellerBucketCreated.has(key)) {
            seenSellerBucketCreated.add(key)
            bump(sellerVisitsByChannelCreatedWeek[info.idx]!, info.channel, p.sellerId)
        }
    }

    // === Added 2026-09-26: WoW CPL/CPQL/CPV — weekly Spend divided by that week's Total
    // Leads / Total Qualified Seller Leads / Unique Seller Visits (by created week). Uses
    // costPer (imported above) for the same null-on-zero-denominator safety as every other
    // cost-per figure on this tab.
    function sumSeriesCounts(p: WeekSeriesPoint): number {
        return Object.values(p.counts).reduce((s: number, n) => s + (n ?? 0), 0)
    }
    const weeklySellerSpend = computeSellerSpendByWeek(facts, filters, bucketStarts, bucketOf)
    function costWeekSeries(denominatorOf: (i: number) => number): CostWeekPoint[] {
        return bucketStarts.map((s, i) => ({
            weekStart: dateKey(s),
            weekLabel: labelOf(s),
            value: costPer(weeklySellerSpend[i]!, denominatorOf(i)),
        }))
    }
    const cplByWeek = costWeekSeries((i) => sumSeriesCounts(leadsByChannel[i]!))
    const cpqlByWeek = costWeekSeries((i) => sumSeriesCounts(qualifiedLeadsByChannel[i]!))
    const cpvByWeek = costWeekSeries((i) => sumSeriesCounts(sellerVisitsByChannelCreatedWeek[i]!))

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
        const primaryMicromarket = seller.micromarkets[0] || 'Unknown'
        const cluster = MICROMARKET_TO_CLUSTER.get(primaryMicromarket) ?? 'Unknown'
        const point = clusterMap.get(cluster) ?? { cluster, counts: {}, leadIds: {} }
        point.counts[primaryMicromarket] = (point.counts[primaryMicromarket] ?? 0) + 1
        ;(point.leadIds[primaryMicromarket] ??= []).push(p.sellerId)
        clusterMap.set(cluster, point)
    }
    const clusterTotalOf = (p: ClusterPipelinePoint) => Object.values(p.counts).reduce((s: number, n) => s + (n ?? 0), 0)
    const pipelineByCluster = [...clusterMap.values()].sort((a, b) => clusterTotalOf(b) - clusterTotalOf(a))

    // === Cards 1–4: pacing table + rates. These FOLLOW the selected time window; with no
    // time filter they are the reporting quarter. New vs Old still hinges on the seller's
    // creation date against the window start (mirroring the buyer funnel).
    const rangeStart = periods.length
        ? new Date(Math.min(...periods.map((p) => new Date(p.start).getTime())))
        : quarterStart
    const rangeEnd = periods.length
        ? new Date(Math.max(...periods.map((p) => new Date(p.end).getTime())))
        : quarterEnd
    const timeFiltered = periods.length > 0
    const funnelStart = timeFiltered ? rangeStart : quarterStart
    const funnelEnd = timeFiltered ? rangeEnd : quarterEnd
    const actuals = computeActuals(facts, filters, sellersById, funnelStart, funnelEnd, funnelStart)

    // Targets come from the reporting quarter's grid, so they apply only to a window sitting
    // inside that quarter. A window equal to the quarter (the default, or that quarter picked
    // explicitly) shows the full target; a month or custom range inside it shows that slice's
    // day-pro-rata share; a window outside the quarter (no grid) shows blank targets — mirrors
    // lib/buyer/derive.ts's windowFraction exactly, so a filtered Seller window doesn't compare
    // a few weeks of actuals against the whole quarter's target.
    const DAY_MS = 86400000
    const quarterDays = (quarterEnd.getTime() - quarterStart.getTime()) / DAY_MS
    const insideQuarter =
        funnelStart.getTime() >= quarterStart.getTime() - DAY_MS &&
        funnelEnd.getTime() <= quarterEnd.getTime() + DAY_MS
    const windowFraction = insideQuarter
        ? Math.min(1, (funnelEnd.getTime() - funnelStart.getTime()) / DAY_MS / quarterDays)
        : 0
    const t = sellerTargetsFor({ channels: filters.channels, micromarkets: filters.micromarkets })
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
        'Seller Visits': gridApplies ? scoped(filters.visitScope, t.newVisits, t.oldVisits, t.totalVisits) * windowFraction : null,
        'Seller Conversions': gridApplies
            ? scoped(filters.conversionScope, t.newConv, t.oldConv, t.totalConv) * windowFraction
            : null,
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
        const mm = s.micromarkets[0] || 'Unknown'
        const current = qualifiedByMm.get(mm)
        if (current === undefined) continue
        qualifiedByMm.set(mm, current + 1)
    }
    for (const p of facts.products) {
        const seller = sellersById.get(p.sellerId)
        if (!seller || !seller.isQualified || !sellerMatchesChannel(seller, filters)) continue
        const mm = seller.micromarkets[0] || 'Unknown'
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
        const g = sellerTargetsFor({ channels: filters.channels, micromarkets: [mm] })
        return { micromarket: mm, actual: qualifiedByMm.get(mm) ?? 0, target: absoluteMicromarketTarget(g.ql, g.covered) }
    })
    const qualifiedVisitsByMicromarketQuarter: MicromarketTargetPoint[] = micromarketsForCharts.map((mm) => {
        const g = sellerTargetsFor({ channels: filters.channels, micromarkets: [mm] })
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

    // "Qualified Property Leads" has no grid column of its own — the user's own placeholder,
    // 1.2x the Total Leads target, flagged for them to confirm before treating as final.
    const QUALIFIED_PROPERTY_LEADS_TARGET_MULTIPLIER = 1.2

    type Unit = 'count' | '%' | 'currency' | 'x'
    const UNITS: Record<string, Unit> = {
        'Total Leads': 'count',
        'Total Qualified Seller Leads': 'count',
        'LTQL %': '%',
        'Qualified Property Leads': 'count',
        'Unique Seller Total Visits': 'count',
        'Unique Seller New Visits': 'count',
        'Unique Seller Old Visits': 'count',
        'QLTV %': '%',
        'Total Property Visits': 'count',
        'New Property Visits': 'count',
        'Old Property Visits': 'count',
        'Visits in Pipeline': 'count',
        'Total Conversions': 'count',
        'New Conversions': 'count',
        'Old Conversions': 'count',
        // Spend and the four cost-per metrics. No spend target exists — the Metabase card 739
        // grid has no spend column — so every one of these shows a dash in both target columns
        // and only the achieved figure is real. See qTargetsFull below.
        Spend: 'currency',
        'CPL': 'currency',
        'CPQL': 'currency',
        'CPV': 'currency',
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
        'CPL',
        'CPQL',
        'CPV',
        'CAC',
    ])
    // Lower is better for a cost-per metric — overspending is the "behind" direction, the
    // opposite of every other row where more is better. Spend itself is NOT here: whether
    // spending more than planned is good or bad depends on what it bought, so it is left
    // unsigned rather than coloured wrongly. Mirrors lib/buyer/derive.ts's own set.
    const LOWER_IS_BETTER = new Set([
        'CPL',
        'CPQL',
        'CPV',
        'CAC',
    ])

    /** `isQuarterColumn` gates only the conversion cost — see the note on that row. */
    function actualsRow(a: Actuals, spend: number, isQuarterColumn: boolean): Record<string, number | null> {
        return {
            'Total Leads': a.leads,
            'Total Qualified Seller Leads': a.qualified,
            'LTQL %': ratioPct(a.qualified, a.leads),
            'Qualified Property Leads': a.qualifiedSellerProperties,
            'Unique Seller Total Visits': a.visitsNew + a.visitsOld,
            'Unique Seller New Visits': a.visitsNew,
            'Unique Seller Old Visits': a.visitsOld,
            // Always New visits, per the user — not gated by the visitScope filter pill.
            'QLTV %': ratioPct(a.visitsNew, a.qualified),
            'Total Property Visits': a.qualifyingNew + a.qualifyingOld,
            'New Property Visits': a.qualifyingNew,
            'Old Property Visits': a.qualifyingOld,
            'Visits in Pipeline': a.pipelineNew + a.pipelineOld,
            'Total Conversions': a.conversionsNew + a.conversionsOld,
            'New Conversions': a.conversionsNew,
            'Old Conversions': a.conversionsOld,
            Spend: spend,
            // Cost denominators pin to the NEW cohort regardless of the scope pills, per
            // docs/metric-skill/references/metric-definitions.md: spend buys new sellers, and
            // an old-cohort visit was paid for in an earlier quarter. The labels say "New" so
            // they can never silently disagree with the Total/Old rows above them.
            //
            // The visit denominator is the UNIQUE-SELLER count (a.visitsNew), not the
            // per-property one (a.qualifyingNew) — same number QLTV % divides by, and the
            // dashboard-wide meaning of "Seller Visits". costPer returns null, never 0, when
            // either side is absent.
            'CPL': costPer(spend, a.leads),
            'CPQL': costPer(spend, a.qualified),
            'CPV': costPer(spend, a.visitsNew),
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
    const qlTargetQ = windowScaled(t.ql)
    const leadsTargetQ = windowScaled(t.leads)
    const newConvTargetQ = windowScaled(t.newConv)
    const spendTargetQ = windowScaled(t.spendInr)
    // Null, never 0, whenever spend or the denominator is absent — mirrors lib/buyer/derive.ts's
    // divTarget and lib/seller/costs.ts's costPer (a real 0 target would read as "spend nothing
    // and still hit it").
    const divTarget = (n: number | null, d: number | null): number | null => (n != null && n > 0 && d != null && d > 0 ? n / d : null)
    const qTargetsFull: Record<string, number | null> = {
        'Total Leads': leadsTargetQ,
        'Total Qualified Seller Leads': qlTargetQ,
        'LTQL %': safeRatio(qlTargetQ, leadsTargetQ),
        'Qualified Property Leads': leadsTargetQ == null ? null : leadsTargetQ * QUALIFIED_PROPERTY_LEADS_TARGET_MULTIPLIER,
        'Unique Seller Total Visits': windowScaled(t.totalVisits),
        'Unique Seller New Visits': newVisitsTargetQ,
        'Unique Seller Old Visits': windowScaled(t.oldVisits),
        'QLTV %': safeRatio(newVisitsTargetQ, qlTargetQ),
        // No grid column exists for Property Visits or Pipeline — null throughout, per the user.
        'Total Property Visits': null,
        'New Property Visits': null,
        'Old Property Visits': null,
        'Visits in Pipeline': null,
        'Total Conversions': windowScaled(t.totalConv),
        'New Conversions': windowScaled(t.newConv),
        'Old Conversions': windowScaled(t.oldConv),
        // Spend and the four cost-per targets, from the target grid's own spendInr column
        // (Truva_JAS26_Planning_ChannelLevel.xlsx, "MM-WISE View (Seller)") — divided by the
        // SAME window-scaled targets the achieved cost figures divide by, mirroring
        // lib/buyer/derive.ts's own CPL/CPQL/CPV/CAC target derivation exactly.
        Spend: spendTargetQ,
        CPL: divTarget(spendTargetQ, leadsTargetQ),
        CPQL: divTarget(spendTargetQ, qlTargetQ),
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
    function lagFor(metric: string, target: number | null, achieved: number | null): number | null {
        if (target == null || achieved == null) return null
        // Positive means behind. For a cost-per row that is achieved ABOVE target, so the
        // subtraction flips — otherwise overspending would render green.
        const diff = LOWER_IS_BETTER.has(metric) ? achieved - target : target - achieved
        return Math.round(diff * 1000) / 1000
    }

    // Weekly Pace Needed — mirrors lib/buyer/derive.ts's own weeklyPaceNeededFor exactly: what's
    // required per week for the rest of the REAL quarter (not the Time filter's window) to land
    // on the full target. Replaces the old hand-typed "Next 2wk Target".
    const realWeeksRemaining = Math.max(0, (quarterEnd.getTime() - now.getTime()) / DAY_MS) / 7
    function weeklyPaceNeededFor(metric: string): number | null {
        const qTargetFull = qTargetsFull[metric] ?? null
        const qAchieved = qActualsRow[metric] ?? null
        if (qTargetFull == null || qAchieved == null) return null
        if (RATE_METRICS.has(metric)) return null
        if (realWeeksRemaining <= 0) return null
        return Math.round((Math.max(0, qTargetFull - qAchieved) / realWeeksRemaining) * 1000) / 1000
    }

    const targetVsAchieved: TwoWeekRow[] = METRIC_ORDER.map((metric) => {
        const qTarget = pacedQTarget(metric)
        const qAchieved = qActualsRow[metric] ?? null
        const w2Target = w2TargetFor(metric)
        const w2Achieved = w2ActualsRow[metric] ?? null
        return {
            metric,
            unit: UNITS[metric]!,
            qTarget,
            qAchieved,
            qLag: lagFor(metric, qTarget, qAchieved),
            w2Target,
            w2Achieved,
            w2Lag: lagFor(metric, w2Target, w2Achieved),
            weeklyPaceNeeded: weeklyPaceNeededFor(metric),
        }
    })

    // "Total Conversions (Channel Partner + Direct)" — the Overall Funnel's extra float box.
    // Direct total is New+Old UNCONDITIONALLY (not gated by the conversionScope pill) plus every
    // in-window, in-micromarket Channel Partner conversion. Still ignores channel/source and the
    // visit/conversion scope pills — see computeChannelPartnerConversions's doc comment. Still
    // respects the selected time window (funnelStart/funnelEnd), same as everything else on the
    // funnel.
    const channelPartnerConversions = computeChannelPartnerConversions(
        facts.channelPartnerProducts,
        facts.channelPartnerPlaces,
        filters,
        funnelStart.getTime(),
        funnelEnd.getTime()
    )
    const directConversionsTotal = actuals.conversionsNew + actuals.conversionsOld
    const totalConversionsWithChannelPartner = directConversionsTotal + channelPartnerConversions

    const ltqlPct = ratioPct(actuals.qualified, actuals.leads)
    const qltvPct = ratioPct(actuals.visits, actuals.qualified)
    const convRatePct = ratioPct(actuals.conversions, actuals.visits)

    // Rate targets — ratios of the target grid's own values, not independently entered.
    // Mirrors lib/buyer/derive.ts's LTQL %/QL-V % target computation exactly.
    const ltqlTarget = safeRatio(targetFor.QL ?? null, targetFor.Leads ?? null)
    const qltvTarget = safeRatio(targetFor['Seller Visits'] ?? null, targetFor.QL ?? null)
    const convRateTarget = safeRatio(targetFor['Seller Conversions'] ?? null, targetFor['Seller Visits'] ?? null)

    // The Overview section's funnel diagram — see components/seller/OverallFunnel.tsx for how
    // the two float boxes are positioned and labelled.
    const overallFunnel: SellerReportData['overallFunnel'] = {
        uniqueLeads: { actual: actuals.leads, target: targetFor.Leads ?? null },
        qualified: { actual: actuals.qualified, target: targetFor.QL ?? null },
        uniqueSellerVisits: { actual: actuals.visits, target: targetFor['Seller Visits'] ?? null },
        conversions: { actual: actuals.conversions, target: targetFor['Seller Conversions'] ?? null },
        qualifiedSellerProperties: actuals.qualifiedSellerProperties,
        qualifyingProperties: actuals.qualifyingProperties,
        pipelineCount: actuals.pipelineCount,
        directConversionsTotal,
        totalConversionsWithChannelPartner,
        ltqlPct,
        qltvPct,
        convRatePct,
        ltqlTarget,
        qltvTarget,
        convRateTarget,
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
        leadsByChannel,
        qualifiedLeadsByChannel,
        leadsByStatus,
        qualifiedPropertiesByChannel,
        sellerVisitsByChannel,
        propertyVisitsByChannel,
        sellerVisitsByChannelCreatedWeek,
        propertyVisitsByChannelCreatedWeek,
        cplByWeek,
        cpqlByWeek,
        cpvByWeek,
        notQualifiedReasons,
        notTruvaApprovedSubReasons,
        pipelineByCluster,
        qualifiedLeadsByMicromarketQuarter,
        qualifiedVisitsByMicromarketQuarter,
        qualifiedLeadsByMicromarket,
        sellerVisitsByMicromarket,
        sellersById: listItems,
    }
}
