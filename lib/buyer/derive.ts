import { computeSpendByWeek, computeSpendForWindow } from './costs'
import type { BidSourceFact, BuyerFacts, LeadFact } from './facts'
import { type BuyerFilters, leadMatches, soldBidMatches, visitMatches } from './filters'
import {
    ATTRIBUTION_NOT_APPLICABLE,
    ATTRIBUTION_UNMAPPED_PROPERTY,
    IST_OFFSET_MS,
    VALID_MICROMARKETS,
    buildBuckets,
    dateKey,
    micromarketsForClusters,
    mondayOfIST,
} from './shared'
import { funnelTargetsFor } from './targets'
import {
    type AttributionExtra,
    type BuyerReportData,
    type CostWeekPoint,
    type FrtWeekPoint,
    type HouseWarmPoint,
    type LeadListItem,
    type MicromarketPoint,
    type OverallFunnelData,
    type ReasonPoint,
    type TwoWeekRow,
    type WeekSeriesPoint,
    QUALIFIED_STATUSES,
    QUARTER_LABEL,
    TOTAL_VISITS_RAW_TARGET_MULTIPLIER,
} from './types'

// Every card is derived here, from the fact table alone. No Zoho access and no clock
// beyond what is passed in, so this runs identically on the server and in the browser.

export interface DeriveOptions {
    /** The quarter the funnel overview is pinned to, whatever the time filter says. */
    quarterStart: Date
    quarterEnd: Date
    now: Date
    filters: BuyerFilters
}

function emptySeries(
    starts: Date[],
    label: (d: Date) => string,
    incomplete: boolean[] = [],
    partialStart: boolean[] = []
): WeekSeriesPoint[] {
    return starts.map((s, i) => ({
        weekStart: dateKey(s),
        weekLabel: label(s),
        counts: {},
        leadIds: {},
        incomplete: incomplete[i] === true,
        partialStart: partialStart[i] === true,
    }))
}

function bump(point: WeekSeriesPoint, key: string, id: string) {
    point.counts[key] = (point.counts[key] ?? 0) + 1
    ;(point.leadIds[key] ??= []).push(id)
}


// Campaign/Ad Set/Ad/Property names are far higher-cardinality than Source/Cluster/
// Micromarket — a single quarter's live data has been observed with 100+ distinct
// campaign names alone (each dated/targeted individually), unlike the small, bounded enum
// every other WoW-by-X chart stacks on. Rendering every one of them as its own stacked-bar
// series made the page unresponsive in manual testing (2026-09-23) — hundreds of series
// across several weeks is thousands of SVG elements per chart. Cap each of those four
// dimensions to its top MAX_ATTRIBUTION_SERIES values by total volume, folding the long
// tail into one "Other ..." bucket — same "never let it vanish" principle as the rest of
// this file, just bounded so the chart (and the browser rendering it) stays usable. Not
// applied to Micromarket, whose cardinality is already small and bounded
// (VALID_MICROMARKETS).
const MAX_ATTRIBUTION_SERIES = 15

function topSeriesKeys(points: WeekSeriesPoint[], keepAlways: Set<string>, max: number): Set<string> {
    const totals = new Map<string, number>()
    for (const p of points) for (const [k, n] of Object.entries(p.counts)) totals.set(k, (totals.get(k) ?? 0) + (n ?? 0))
    const ranked = [...totals.keys()]
        .filter((k) => !keepAlways.has(k))
        .sort((a, b) => (totals.get(b) ?? 0) - (totals.get(a) ?? 0))
    return new Set([...keepAlways, ...ranked.slice(0, max)])
}

function foldIntoOther(points: WeekSeriesPoint[], keep: Set<string>, otherLabel: string): WeekSeriesPoint[] {
    const allKeys = new Set(points.flatMap((p) => Object.keys(p.counts)))
    if ([...allKeys].every((k) => keep.has(k))) return points // nothing over the cap
    return points.map((p) => {
        const counts: Partial<Record<string, number>> = {}
        const leadIds: Partial<Record<string, string[]>> = {}
        for (const [k, n] of Object.entries(p.counts)) {
            const bucket = keep.has(k) ? k : otherLabel
            counts[bucket] = (counts[bucket] ?? 0) + (n ?? 0)
        }
        for (const [k, ids] of Object.entries(p.leadIds)) {
            const bucket = keep.has(k) ? k : otherLabel
            ;(leadIds[bucket] ??= []).push(...(ids ?? []))
        }
        return { ...p, counts, leadIds }
    })
}

// Caps a Leads-by-X / Qualified-by-X pair to the SAME top-N keys (ranked by the Leads
// series' own volume) so the two charts stay directly comparable — a campaign folded into
// "Other" on one is folded into "Other" on the other, never split differently.
function capAttributionPair(
    leadsSeries: WeekSeriesPoint[],
    qualifiedSeries: WeekSeriesPoint[],
    keepAlways: Set<string>,
    otherLabel: string
): [WeekSeriesPoint[], WeekSeriesPoint[]] {
    const keep = topSeriesKeys(leadsSeries, keepAlways, MAX_ATTRIBUTION_SERIES)
    return [foldIntoOther(leadsSeries, keep, otherLabel), foldIntoOther(qualifiedSeries, keep, otherLabel)]
}

function ratio(n: number, d: number): number | null {
    return d > 0 ? Math.round((n / d) * 1000) / 10 : null
}
function safeRatio(n: number | null, d: number | null): number | null {
    return n == null || d == null ? null : ratio(n, d)
}

// === Direct % of Bids (vs Channel Partner) — see docs/metric-skill/references/metric-definitions.md ===
// Company-wide by design: unlike every other Target vs Actuals row, this one does NOT run
// through leadMatches/visitMatches or any BuyerFilters predicate — the growth team's own ask was
// to see the true overall Direct-vs-CP split regardless of which Channel/Micromarket/Source is
// selected in the filter bar. Bids with no Lead_Source (~17 of ~10,933 over 24 months) are
// excluded from both sides rather than guessed at, same null-safe spirit as the rest of this file.
function directShare(bids: BidSourceFact[], start: Date, end: Date): number | null {
    let direct = 0
    let channelPartner = 0
    for (const b of bids) {
        if (!b.createdAt) continue
        const t = new Date(b.createdAt).getTime()
        if (t < start.getTime() || t >= end.getTime()) continue
        const source = (b.leadSource ?? '').trim().toLowerCase()
        if (source === 'direct') direct++
        else if (source === 'channel partner') channelPartner++
    }
    return ratio(direct, direct + channelPartner)
}

// === First Response Time — working-hours leads only ===
// FRT = EE_Response_Time minus Created_Time, in minutes. Per the user, a non-working-hours
// lead isn't held to the same response-time expectation (the team can't be expected to
// respond within the target while nobody's staffing), so those leads are excluded from the
// calculation entirely rather than measured on a different clock.
const FRT_WORK_START_HOUR = 9
const FRT_WORK_END_HOUR = 19 // 7:00 PM. Working hours is [9, 19) IST; 7:00 PM itself is excluded.
export const FRT_TARGET_MINUTES = 15

// Lead_Source values excluded from FRT specifically (not from the rest of the dashboard —
// these leads still count as leads/qualified/visits everywhere else). "Channel Partner",
// "Builder" and "Seller Referral" are already dropped from the whole population by
// EXCLUDED_SOURCES in shared.ts; listed again here so this set is self-documenting and
// doesn't silently break if that changes. Exact live Zoho picklist value is "Society
// Partners" (plural) — verified live, not "Society Partner" as commonly said.
const FRT_EXCLUDED_SOURCES = new Set([
    'channel partner',
    'builder',
    'society partners',
    'referral',
    'seller referral',
])

function frtEligible(lead: LeadFact): boolean {
    if (FRT_EXCLUDED_SOURCES.has(lead.rawSource.trim().toLowerCase())) return false
    if ((lead.utmChannel ?? '').trim().toLowerCase() === 'whatsapp') return false
    if (!lead.acefoneLeadId) return false
    return true
}

function istHourOfDay(d: Date): number {
    const ist = new Date(d.getTime() + IST_OFFSET_MS)
    return ist.getUTCHours() + ist.getUTCMinutes() / 60
}

function isWorkingHours(d: Date): boolean {
    const h = istHourOfDay(d)
    return h >= FRT_WORK_START_HOUR && h < FRT_WORK_END_HOUR
}

// Minutes from Created Time to first response, for a working-hours-created lead only.
// Returns null for a non-working-hours lead (excluded per the user), a lead with no
// response yet, or a negative duration (a data-quality edge case — excluded rather than
// shown as a misleading negative number).
function frtMinutes(createdAt: string, responseAt: string | null): number | null {
    if (!responseAt) return null
    const created = new Date(createdAt)
    const responded = new Date(responseAt)
    if (Number.isNaN(created.getTime()) || Number.isNaN(responded.getTime())) return null
    if (!isWorkingHours(created)) return null

    const minutes = (responded.getTime() - created.getTime()) / 60000
    return minutes < 0 ? null : minutes
}

// Linear-interpolation percentile (the common convention — same as numpy's default). `p`
// is 0-100; `sorted` must already be sorted ascending.
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

interface FunnelActuals {
    totalLeads: number
    /** Every Lead_Source_History touch (any Serial_Number) in the window, windowed on the
     *  touch's own Timestamp rather than the lead's Created_Time. Always >= totalLeads —
     *  a lead that re-enquires produces a second touch here but is still one row in
     *  `leads`. No established target exists for it. */
    totalLeadsRaw: number
    /** Same touch table as totalLeadsRaw, restricted to touches whose Lead_Status AT THAT
     *  TOUCH is in QUALIFIED_STATUSES — backs the small "Qualified (LSH)" box beside the
     *  funnel's "Total Leads" tile. Not deduped by lead, same as totalLeadsRaw. */
    qualifiedLeadsRaw: number
    qualifiedLeads: number
    newVisits: number
    oldVisits: number
    totalVisits: number
    /** Raw completed-visit count, NOT deduped by lead — a lead visiting twice counts
     *  twice. Different from totalVisits above, which is one visit per lead. */
    totalVisitsRaw: number
    everWarmLeads: number
    newConversions: number
    oldConversions: number
    totalConversions: number
    /** Every property sold in the window — MoU signed OR blocking received — one count per
     *  bid, with no source exclusion and no lead-population requirement. Unlike
     *  totalConversions above, which is Direct-only (excluded at bid level AND by its lead
     *  having to survive EXCLUDED_SOURCES), MoU-only, and deduped to one per buyer. Backs the
     *  Overall Funnel's "Total Conversions" tile: "how many properties did we sell
     *  altogether." Sourced from facts.soldBids. */
    totalConversionsRaw: number
}

// Same actuals the Quarter Overview funnel uses, generalised to an arbitrary window — New
// vs Old still hinges on the lead's creation QUARTER (fixed), only the observation window
// (which leads/visits/conversions get counted) varies. Used both for the quarter itself and
// for the Two-Week table's narrower window.
function computeFunnelActuals(
    facts: BuyerFacts,
    filters: BuyerFilters,
    leadById: Map<string, LeadFact>,
    windowStart: Date,
    windowEnd: Date,
    quarterStart: Date
): FunnelActuals {
    const inWindow = (iso: string): boolean => {
        const d = new Date(iso)
        return !Number.isNaN(d.getTime()) && d >= windowStart && d < windowEnd
    }

    // isPrimary is what makes a lead one PERSON rather than one Zoho record — two records
    // sharing a phone contribute one lead here. Every count below that is meant to be
    // "unique leads" therefore runs off windowLeads.
    const windowLeads = facts.leads.filter(
        (l) => l.isPrimary && l.inPopulation && inWindow(l.createdAt) && leadMatches(l, filters)
    )
    const qualifiedLeads = windowLeads.filter((l) => l.isQualified).length

    let totalLeadsRaw = 0
    let qualifiedLeadsRaw = 0
    for (const t of facts.lshTouches) {
        if (!inWindow(t.timestamp)) continue
        const lead = leadById.get(t.leadId)
        if (!lead || !leadMatches(lead, filters)) continue
        totalLeadsRaw++
        if ((QUALIFIED_STATUSES as readonly string[]).includes(t.leadStatus)) qualifiedLeadsRaw++
    }

    // Unique visits are per PERSON, so the map is keyed on the lead's dedupKey (phone) —
    // one human visiting under two Zoho records is one unique visit. totalVisitsRaw stays
    // undeduped, which is what makes the funnel's visit duplication ratio meaningful.
    const visitFirstCreatedByLead = new Map<string, Date>()
    let totalVisitsRaw = 0
    for (const v of facts.visits) {
        if (!inWindow(v.startAt)) continue
        const lead = leadById.get(v.leadId)
        if (!visitMatches(v, lead, filters)) continue
        totalVisitsRaw++
        const created = new Date(v.leadCreatedAt)
        if (Number.isNaN(created.getTime())) continue
        const key = lead?.dedupKey ?? `id:${v.leadId}`
        const existing = visitFirstCreatedByLead.get(key)
        if (!existing || created < existing) visitFirstCreatedByLead.set(key, created)
    }
    let newVisits = 0
    let oldVisits = 0
    for (const created of visitFirstCreatedByLead.values()) {
        if (created >= quarterStart) newVisits++
        else oldVisits++
    }

    const warmLeads = new Set<string>()
    for (const l of windowLeads) if (l.hasWarmBid) warmLeads.add(l.id)

    // Conversions are counted per PERSON, not per bid: the spec is "count unique of unique
    // leads that have bid stage Closed-won". Before dedupKey existed this looped straight
    // over ConversionFacts, so a lead closing two bids in the window counted twice.
    const conversionFirstCreated = new Map<string, Date>()
    for (const c of facts.conversions) {
        if (!inWindow(c.mouDate)) continue
        const lead = leadById.get(c.leadId)
        if (!lead || !leadMatches(lead, filters)) continue
        const created = new Date(c.leadCreatedAt)
        if (Number.isNaN(created.getTime())) continue
        const key = lead.dedupKey
        const existing = conversionFirstCreated.get(key)
        if (!existing || created < existing) conversionFirstCreated.set(key, created)
    }
    let newConversions = 0
    let oldConversions = 0
    for (const created of conversionFirstCreated.values()) {
        if (created >= quarterStart) newConversions++
        else oldConversions++
    }

    // "How many properties did we sell altogether" — every bid in the window that signed its
    // MoU or took a blocking, counted once each. Reads its OWN fact array rather than the
    // conversions above, because those are narrowed several times over (Channel Partner
    // buyers, a lead that survived the population's source exclusions, MoU only) and then
    // deduped per buyer. Still no dedupe and no source exclusion here — but it DOES answer
    // the filter bar as of 2026-09-16, through the buyer dimensions SoldBidFact carries;
    // see soldBidMatches. Unfiltered it remains a true "everything we sold" total.
    let totalConversionsRaw = 0
    for (const b of facts.soldBids) if (inWindow(b.soldAt) && soldBidMatches(b, filters)) totalConversionsRaw++

    return {
        totalLeads: windowLeads.length,
        totalLeadsRaw,
        qualifiedLeadsRaw,
        qualifiedLeads,
        newVisits,
        oldVisits,
        totalVisits: newVisits + oldVisits,
        totalVisitsRaw,
        everWarmLeads: warmLeads.size,
        newConversions,
        oldConversions,
        totalConversions: newConversions + oldConversions,
        totalConversionsRaw,
    }
}

export function deriveReport(facts: BuyerFacts, opts: DeriveOptions): Omit<BuyerReportData, 'cachedAt'> {
    const { quarterStart, quarterEnd, now, filters } = opts

    // The axis spans the earliest to the latest selected period, with gaps between
    // non-adjacent periods dropped rather than drawn empty. Shared with costs.ts so both
    // bucket identically; the golden test proves this extraction moved no funnel number.
    const periods = filters.periods
    const { bucketStarts, labelOf, bucketOf, bucketIncomplete, bucketPartialStart, rangeStart, rangeEnd } = buildBuckets(
        periods,
        filters.grain,
        quarterStart,
        quarterEnd,
        now
    )

    const leadListItems: Record<string, LeadListItem> = {}
    const record = (l: LeadFact) => {
        leadListItems[l.id] = { id: l.id, name: l.name, status: l.status, source: l.channel, createdAt: l.createdAt }
    }

    // === 1-3, 10: by lead-created bucket ===
    const leadsBySource = emptySeries(bucketStarts, labelOf, bucketIncomplete, bucketPartialStart)
    const leadsByStatus = emptySeries(bucketStarts, labelOf, bucketIncomplete, bucketPartialStart)
    const qualifiedBySource = emptySeries(bucketStarts, labelOf, bucketIncomplete, bucketPartialStart)
    const qualifiedByCluster = emptySeries(bucketStarts, labelOf, bucketIncomplete, bucketPartialStart)
    const reasonMap = new Map<string, { count: number; leadIds: string[] }>()

    // FRT (First Response Time), also bucketed by the lead's created week, same population
    // gate as everything else above.
    const frtMinutesByBucket: number[][] = bucketStarts.map(() => [])

    for (const lead of facts.leads) {
        // isPrimary keeps these cards summing to the funnel's Unique Leads — without it a
        // person with two Zoho records would stack twice here but once there.
        if (!lead.isPrimary || !lead.inPopulation || !leadMatches(lead, filters)) continue
        const idx = bucketOf(lead.createdAt)
        if (idx === undefined) continue

        record(lead)
        // By SOURCE, not channel — "99Acres" rather than "3P". palette.ts gives each
        // channel a hue family so the stack still reads as its channel at a glance.
        bump(leadsBySource[idx]!, lead.sourceLabel, lead.id)
        bump(leadsByStatus[idx]!, lead.statusFolded, lead.id)

        if (lead.isQualified) {
            bump(qualifiedBySource[idx]!, lead.sourceLabel, lead.id)
            // One bucket per lead so the stack height equals the real figure. A lead in
            // two clusters lands in its first; the second surfaces it by filtering.
            bump(qualifiedByCluster[idx]!, lead.clusterPrimary, lead.id)
        }

        if (lead.status === 'Not Qualified') {
            const reason = lead.notQualifiedReason || 'No Reason Given'
            const entry = reasonMap.get(reason) ?? { count: 0, leadIds: [] }
            entry.count += 1
            entry.leadIds.push(lead.id)
            reasonMap.set(reason, entry)
        }

        if (frtEligible(lead)) {
            const frt = frtMinutes(lead.createdAt, lead.responseAt)
            if (frt != null) frtMinutesByBucket[idx]!.push(frt)
        }
    }

    const notQualifiedReasons: ReasonPoint[] = [...reasonMap.entries()]
        .map(([reason, v]) => ({ reason, count: v.count, leadIds: v.leadIds }))
        .sort((a, b) => b.count - a.count)

    const frtByWeek: FrtWeekPoint[] = bucketStarts.map((s, i) => ({
        weekStart: dateKey(s),
        weekLabel: labelOf(s),
        ...summarizeFrt(frtMinutesByBucket[i]!),
    }))

    // === NEW 2026-09-23: Leads/Qualified Leads by Campaign, Ad Set, Ad, Property,
    // Micromarket. A second, separate pass over facts.leads — deliberately NOT merged into
    // the loop above. That loop computes the twelve cards derive.golden.test.ts locks
    // byte-for-byte, and its fixture explicitly documents that those twelve must never read
    // LeadFact's attributed* fields (a second, parallel attribution used elsewhere only by
    // the cost block) because they're reconciled against Metabase on Truva_Micromarket/
    // Lead_Source and switching sources would break that silently. This block reads
    // attributedCampaign/attributedAdSet/attributedAd/attributedProperty for five BRAND NEW
    // cards instead — keeping it a separate loop keeps that boundary visible in the diff,
    // not just in a comment. Same population/eligibility gate as the original loop, so
    // "Leads"/"Qualified Leads" mean exactly what they mean everywhere else on this tab.
    // Micromarket here is the lead's own micromarketPrimary (same field/convention
    // qualifiedByCluster already uses for clusters) — independently available and already
    // verified for every lead, not LSH attribution, which only covers the first touch.
    const leadsByCampaign = emptySeries(bucketStarts, labelOf, bucketIncomplete, bucketPartialStart)
    const qualifiedByCampaign = emptySeries(bucketStarts, labelOf, bucketIncomplete, bucketPartialStart)
    const leadsByAdSet = emptySeries(bucketStarts, labelOf, bucketIncomplete, bucketPartialStart)
    const qualifiedByAdSet = emptySeries(bucketStarts, labelOf, bucketIncomplete, bucketPartialStart)
    const leadsByAd = emptySeries(bucketStarts, labelOf, bucketIncomplete, bucketPartialStart)
    const qualifiedByAd = emptySeries(bucketStarts, labelOf, bucketIncomplete, bucketPartialStart)
    const leadsByProperty = emptySeries(bucketStarts, labelOf, bucketIncomplete, bucketPartialStart)
    const qualifiedByProperty = emptySeries(bucketStarts, labelOf, bucketIncomplete, bucketPartialStart)
    const leadsByMicromarket = emptySeries(bucketStarts, labelOf, bucketIncomplete, bucketPartialStart)
    const qualifiedByMicromarket = emptySeries(bucketStarts, labelOf, bucketIncomplete, bucketPartialStart)

    for (const lead of facts.leads) {
        if (!lead.isPrimary || !lead.inPopulation || !leadMatches(lead, filters)) continue
        const idx = bucketOf(lead.createdAt)
        if (idx === undefined) continue

        const campaign = lead.attributedCampaign || ATTRIBUTION_NOT_APPLICABLE
        const adSet = lead.attributedAdSet || ATTRIBUTION_NOT_APPLICABLE
        const ad = lead.attributedAd || ATTRIBUTION_NOT_APPLICABLE
        const property = lead.attributedProperty || ATTRIBUTION_UNMAPPED_PROPERTY
        const micromarket = lead.micromarketPrimary || 'Unknown'

        bump(leadsByCampaign[idx]!, campaign, lead.id)
        bump(leadsByAdSet[idx]!, adSet, lead.id)
        bump(leadsByAd[idx]!, ad, lead.id)
        bump(leadsByProperty[idx]!, property, lead.id)
        bump(leadsByMicromarket[idx]!, micromarket, lead.id)

        if (lead.isQualified) {
            bump(qualifiedByCampaign[idx]!, campaign, lead.id)
            bump(qualifiedByAdSet[idx]!, adSet, lead.id)
            bump(qualifiedByAd[idx]!, ad, lead.id)
            bump(qualifiedByProperty[idx]!, property, lead.id)
            bump(qualifiedByMicromarket[idx]!, micromarket, lead.id)
        }
    }

    // Cap the four high-cardinality dimensions to their top MAX_ATTRIBUTION_SERIES values
    // (see capAttributionPair's own comment) — Micromarket is left uncapped, its cardinality
    // already bounded by VALID_MICROMARKETS.
    const [leadsByCampaignCapped, qualifiedByCampaignCapped] = capAttributionPair(
        leadsByCampaign,
        qualifiedByCampaign,
        new Set([ATTRIBUTION_NOT_APPLICABLE]),
        'Other Campaigns'
    )
    const [leadsByAdSetCapped, qualifiedByAdSetCapped] = capAttributionPair(
        leadsByAdSet,
        qualifiedByAdSet,
        new Set([ATTRIBUTION_NOT_APPLICABLE]),
        'Other Ad Sets'
    )
    const [leadsByAdCapped, qualifiedByAdCapped] = capAttributionPair(
        leadsByAd,
        qualifiedByAd,
        new Set([ATTRIBUTION_NOT_APPLICABLE]),
        'Other Ads'
    )
    const [leadsByPropertyCapped, qualifiedByPropertyCapped] = capAttributionPair(
        leadsByProperty,
        qualifiedByProperty,
        new Set([ATTRIBUTION_UNMAPPED_PROPERTY]),
        'Other Properties'
    )

    // === 5: Visit pipeline — a live snapshot of current statuses. Deliberately outside
    // the time filter: "what is queued right now" has no time dimension to slice.
    const mmMap = new Map<string, MicromarketPoint>()
    for (const lead of facts.leads) {
        if (!lead.inPipeline || !leadMatches(lead, filters)) continue
        record(lead)
        const mm = lead.micromarketPrimary || 'Unknown'
        if (!mmMap.has(mm)) mmMap.set(mm, { micromarket: mm, counts: {}, leadIds: {} })
        const point = mmMap.get(mm)!
        point.counts[lead.status] = (point.counts[lead.status] ?? 0) + 1
        ;(point.leadIds[lead.status] ??= []).push(lead.id)
    }
    const totalOf = (p: MicromarketPoint) => Object.values(p.counts).reduce((s: number, n) => s + (n ?? 0), 0)
    const visitPipeline = [...mmMap.values()].sort((a, b) => totalOf(b) - totalOf(a))

    // === 8, 9: visits. Uniqueness is at the grain of the bucket — a person visiting twice
    // in one bucket counts once, and counts again in a later one. Deduped on the lead's
    // dedupKey (phone), so two Zoho records for one person collapse here too.
    //
    // Unique Gross Visits (dashboard-only addition, 2026-09-15) is the same grain but keyed on
    // (person, property) instead of person alone — the same buyer revisiting the SAME flat still
    // counts once, but a different flat counts again. See VisitFact.propertyId's comment for
    // where the property comes from and its live-Zoho caveat; metric-definitions.md has the full
    // definition.
    //
    // WoW Bids Ever Warm (dashboard-only addition, 2026-09-15) splits this same per-week/per-person
    // dedup into "Ever Warm" vs "Not Warm" by `lead.hasWarmBid`. This deliberately does NOT
    // reconcile against the Target vs Actuals table's own "Ever Warm %" row — that row's
    // numerator is windowed on lead-created date and its denominator on visit date (two different
    // populations stitched together, an existing quirk of computeFunnelActuals, not introduced
    // here), where this chart cleanly buckets by visit week throughout. See
    // metric-definitions.md for the full note. Also: hasWarmBid is a live snapshot with no
    // history of *when* a lead went warm (same as HouseWarmBar/the Overall Funnel elsewhere in
    // this file), so a past week's bar can still shift on a later rebuild if that lead places a
    // bid afterward — not a new inconsistency, just worth knowing.
    const uniqueVisitsBySource = emptySeries(bucketStarts, labelOf, bucketIncomplete, bucketPartialStart)
    const uniqueGrossVisitsBySource = emptySeries(bucketStarts, labelOf, bucketIncomplete, bucketPartialStart)
    const everWarmByWeek = emptySeries(bucketStarts, labelOf, bucketIncomplete, bucketPartialStart)
    const totalVisitsByMicromarket = emptySeries(bucketStarts, labelOf, bucketIncomplete, bucketPartialStart)
    const seenLeadBucket = new Set<string>()
    const seenLeadPropertyBucket = new Set<string>()
    const seenLeadBucketMicromarket = new Set<string>()
    const leadById = new Map(facts.leads.map((l) => [l.id, l]))

    // === Added 2026-09-23: "Non-Unique Count" + "Lead Status" extra info for the Campaign/
    // AdSet/Ad/Property/Micromarket cuts above. EXTRA CONTEXT, not part of the funnel —
    // counts every Lead_Source_History touch (any Serial_Number) in the SAME window the
    // WoW charts on this tab are currently showing (rangeStart/rangeEnd, i.e. whatever the
    // time filter picks), so it does NOT dedupe by lead the way every other number on this
    // tab does — a lead who re-enquired 3 times counts 3 times. See AttributionExtra's own
    // doc comment and metric-definitions.md.
    function bumpExtra(map: Record<string, AttributionExtra>, key: string, status: string) {
        const entry = (map[key] ??= { nonUniqueCount: 0, statusBreakdown: {} })
        entry.nonUniqueCount += 1
        entry.statusBreakdown[status] = (entry.statusBreakdown[status] ?? 0) + 1
    }
    const lshExtraByDimension: BuyerReportData['lshExtraByDimension'] = {
        campaign: {},
        adSet: {},
        ad: {},
        property: {},
        micromarket: {},
    }
    for (const t of facts.lshTouches) {
        const ts = new Date(t.timestamp)
        if (Number.isNaN(ts.getTime()) || ts < rangeStart || ts >= rangeEnd) continue
        const lead = leadById.get(t.leadId)
        if (!lead || !leadMatches(lead, filters)) continue
        const status = t.leadStatus || 'Unknown'
        bumpExtra(lshExtraByDimension.campaign, t.campaign || ATTRIBUTION_NOT_APPLICABLE, status)
        bumpExtra(lshExtraByDimension.adSet, t.adSet || ATTRIBUTION_NOT_APPLICABLE, status)
        bumpExtra(lshExtraByDimension.ad, t.ad || ATTRIBUTION_NOT_APPLICABLE, status)
        bumpExtra(lshExtraByDimension.property, t.property || ATTRIBUTION_UNMAPPED_PROPERTY, status)
        bumpExtra(lshExtraByDimension.micromarket, t.micromarket || 'Unknown', status)
    }

    // === Added 2026-09-26: "WoW Leads (LSH)" / "WoW Qualified Leads (LSH)" — same touch
    // table and same "status at time of touch" reading as totalLeadsRaw/qualifiedLeadsRaw
    // (computeFunnelActuals, above) and the lshExtraByDimension block just above, bucketed by
    // week instead of summed once. Single series each — no dimension split.
    const LSH_COUNT_KEY = 'Leads (LSH)'
    const LSH_QUALIFIED_KEY = 'Qualified (LSH)'
    const lshCountByWeek = emptySeries(bucketStarts, labelOf, bucketIncomplete, bucketPartialStart)
    const lshQualifiedByWeek = emptySeries(bucketStarts, labelOf, bucketIncomplete, bucketPartialStart)
    for (const t of facts.lshTouches) {
        const lead = leadById.get(t.leadId)
        if (!lead || !leadMatches(lead, filters)) continue
        const idx = bucketOf(t.timestamp)
        if (idx === undefined) continue
        bump(lshCountByWeek[idx]!, LSH_COUNT_KEY, t.leadId)
        if ((QUALIFIED_STATUSES as readonly string[]).includes(t.leadStatus)) {
            bump(lshQualifiedByWeek[idx]!, LSH_QUALIFIED_KEY, t.leadId)
        }
    }

    for (const v of facts.visits) {
        const lead = leadById.get(v.leadId)
        if (!visitMatches(v, lead, filters)) continue
        const idx = bucketOf(v.startAt)
        if (idx === undefined) continue

        const person = lead?.dedupKey ?? `id:${v.leadId}`

        if (VALID_MICROMARKETS.has(v.eventMicromarket)) {
            const key = `${idx}|${v.eventMicromarket}|${person}`
            if (!seenLeadBucketMicromarket.has(key)) {
                seenLeadBucketMicromarket.add(key)
                bump(totalVisitsByMicromarket[idx]!, v.eventMicromarket, v.leadId)
            }
        }

        const key = `${idx}|${person}`
        if (!seenLeadBucket.has(key)) {
            seenLeadBucket.add(key)
            if (lead) record(lead)
            bump(uniqueVisitsBySource[idx]!, v.sourceLabel, v.leadId)
            bump(everWarmByWeek[idx]!, lead?.hasWarmBid ? 'Ever Warm' : 'Not Warm', v.leadId)
        }

        const propertyKey = `${idx}|${person}|${v.propertyId}`
        if (!seenLeadPropertyBucket.has(propertyKey)) {
            seenLeadPropertyBucket.add(propertyKey)
            bump(uniqueGrossVisitsBySource[idx]!, v.sourceLabel, v.leadId)
        }
    }

    // === Added 2026-09-26: "(Visit based on created time)" variants — the exact same
    // dedup/filter rules as uniqueVisitsBySource/uniqueGrossVisitsBySource just above
    // (visitMatches, dedupKey-based person identity, person-vs-person+property grain), the
    // only change being the bucket index comes from the LEAD's created week
    // (v.leadCreatedAt) instead of the visit's own week (v.startAt). Separate Set instances
    // so this pass's dedup never shares state with the visit-week pass above.
    const uniqueVisitsByLeadCreatedWeek = emptySeries(bucketStarts, labelOf, bucketIncomplete, bucketPartialStart)
    const uniqueGrossVisitsByLeadCreatedWeek = emptySeries(bucketStarts, labelOf, bucketIncomplete, bucketPartialStart)
    const seenLeadCreatedBucket = new Set<string>()
    const seenLeadPropertyCreatedBucket = new Set<string>()
    for (const v of facts.visits) {
        const lead = leadById.get(v.leadId)
        if (!visitMatches(v, lead, filters)) continue
        const idx = bucketOf(v.leadCreatedAt)
        if (idx === undefined) continue

        const person = lead?.dedupKey ?? `id:${v.leadId}`

        const key = `${idx}|${person}`
        if (!seenLeadCreatedBucket.has(key)) {
            seenLeadCreatedBucket.add(key)
            bump(uniqueVisitsByLeadCreatedWeek[idx]!, v.sourceLabel, v.leadId)
        }

        const propertyKey = `${idx}|${person}|${v.propertyId}`
        if (!seenLeadPropertyCreatedBucket.has(propertyKey)) {
            seenLeadPropertyCreatedBucket.add(propertyKey)
            bump(uniqueGrossVisitsByLeadCreatedWeek[idx]!, v.sourceLabel, v.leadId)
        }
    }

    // === Added 2026-09-26: WoW CPL/CPQL/CPV — weekly Spend divided by that week's Lead
    // Count / Qualified Lead Count / Unique Visits (by lead created week). Null whenever
    // that week's denominator is 0, same null-safe convention as every other cost-per-X
    // figure on this tab (a 0 denominator would read as "free", not "no data"). A local
    // divide rather than reusing the Last-2-Week table's own `divRaw` below, since that
    // const isn't declared yet at this point in the function.
    function sumCounts(p: WeekSeriesPoint): number {
        return Object.values(p.counts).reduce((s: number, n) => s + (n ?? 0), 0)
    }
    const divWeek = (n: number, d: number): number | null => (n > 0 && d > 0 ? n / d : null)
    const weeklySpend = computeSpendByWeek(facts, filters, bucketStarts, bucketOf)
    function costWeekSeries(denominatorOf: (i: number) => number): CostWeekPoint[] {
        return bucketStarts.map((s, i) => ({
            weekStart: dateKey(s),
            weekLabel: labelOf(s),
            value: divWeek(weeklySpend[i]!, denominatorOf(i)),
        }))
    }
    const cplByWeek = costWeekSeries((i) => sumCounts(leadsBySource[i]!))
    const cpqlByWeek = costWeekSeries((i) => sumCounts(qualifiedBySource[i]!))
    const cpvByWeek = costWeekSeries((i) => sumCounts(uniqueVisitsByLeadCreatedWeek[i]!))

    // Visits split by the BID's own source, Channel Partner included. Reads facts.visitSplit,
    // not facts.visits — the latter is Direct-only by construction (see VisitSplitFact's own
    // comment). One count per visit EVENT, not per person, and deliberately NOT filtered by
    // leadMatches/visitMatches: a CP visit has no eligible lead to match on, so applying the
    // Cluster/Micromarket/Source filters would erase the whole CP series the moment one was
    // touched. The time window still applies, through bucketOf.
    const visitsByBidSource = emptySeries(bucketStarts, labelOf, bucketIncomplete, bucketPartialStart)
    for (const v of facts.visitSplit) {
        const idx = bucketOf(v.startAt)
        if (idx === undefined) continue
        // No leadIds: there is no lead to drill into, so the chart is not clickable.
        const key = v.isChannelPartner ? 'Channel Partner' : 'Direct'
        const point = visitsByBidSource[idx]!
        point.counts[key] = (point.counts[key] ?? 0) + 1
    }

    // === 11: live houses. A property carries a cluster but no channel and no lead-level
    // micromarket, so this card answers to cluster and, through the cluster tree, to
    // micromarket. A source filter leaves it alone.
    const houseMms = filters.micromarkets.length > 0 ? new Set(filters.micromarkets) : null
    const visitedByEverWarm: HouseWarmPoint[] = facts.houses
        .filter((h) => filters.clusters.length === 0 || h.clusters.some((c) => filters.clusters.includes(c)))
        .filter((h) => !houseMms || h.clusters.some((c) => micromarketsForClusters([c]).some((m) => houseMms.has(m))))
        .map((h) => ({
            house: h.house,
            uniqueVisits: h.uniqueVisits,
            everWarmYes: h.everWarmYes,
            everWarmNo: Math.max(0, h.uniqueVisits - h.everWarmYes),
        }))
        .sort((a, b) => b.uniqueVisits - a.uniqueVisits)

    // === 6: Funnel + Last-2-Week actuals. These FOLLOW the selected time window: with no
    // time filter they are the reporting quarter; pick another quarter (or a custom range)
    // and they show that window's own actuals — the actual numbers are always real, never
    // a 0 from filtering the loaded facts against a window they don't overlap.
    // Targets exist only for the reporting quarter's grid, so under a time filter they are
    // null and the funnel shows actuals with blank targets, which is the honest state.
    const timeFiltered = filters.periods.length > 0
    const funnelStart = timeFiltered ? rangeStart : quarterStart
    const funnelEnd = timeFiltered ? rangeEnd : quarterEnd
    const quarterActuals = computeFunnelActuals(facts, filters, leadById, funnelStart, funnelEnd, funnelStart)
    const { totalLeads, qualifiedLeads, newVisits, oldVisits, everWarmLeads, newConversions, oldConversions } =
        quarterActuals

    // Targets come from the reporting quarter's grid, so they apply only to a window that
    // sits inside that quarter. A window equal to the quarter — the default, or that same
    // quarter picked explicitly in the time filter — shows the full target; a month or custom
    // range inside it shows that slice's day-pro-rata share (the same proration the pace table
    // uses); a window outside the quarter (a past quarter we have no grid for, or a
    // multi-quarter span) shows blank targets rather than a number that doesn't apply to it.
    const DAY_MS = 86400000
    const quarterDays = (quarterEnd.getTime() - quarterStart.getTime()) / DAY_MS
    const insideQuarter =
        funnelStart.getTime() >= quarterStart.getTime() - DAY_MS &&
        funnelEnd.getTime() <= quarterEnd.getTime() + DAY_MS
    const windowFraction = insideQuarter
        ? Math.min(1, (funnelEnd.getTime() - funnelStart.getTime()) / DAY_MS / quarterDays)
        : 0
    const fullTargets = funnelTargetsFor({
        channels: filters.channels,
        micromarkets: [...new Set([...filters.micromarkets, ...micromarketsForClusters(filters.clusters)])],
    })
    const targets: Record<string, number> | null =
        fullTargets == null || windowFraction <= 0
            ? null
            : windowFraction >= 0.999
              ? fullTargets
              : Object.fromEntries(Object.entries(fullTargets).map(([metric, v]) => [metric, v * windowFraction]))

    const daysElapsed = (now.getTime() - funnelStart.getTime()) / 86400000
    const daysTotal = (funnelEnd.getTime() - funnelStart.getTime()) / 86400000
    const expectedPctOfTarget = Math.round(((100 * Math.min(Math.max(daysElapsed, 0), daysTotal)) / daysTotal) * 10) / 10

    // === Last 2-Week table — same actuals helper as the quarter block above, windowed to
    // the last 2 complete Monday-Sunday IST weeks, plus the cost rows the old separate
    // Cost/Quarter Overview cards used to carry (removed per the user — one consolidated
    // table now). Two different kinds of proration, per the user:
    //  - Volume metrics (Spend, every count) — the Quarter Target column itself is paced
    //    by days elapsed (what should be true TODAY, not by quarter-end), and the Last
    //    2-Week Target is a 14-day pro-rata share of the FULL (unpaced) quarter target —
    //    those are two independent slices of the same full target, not compounded.
    //  - Rate metrics (every "%" row, and every cost-per-X row) don't shrink with either
    //    window — a 32% expected qualify rate, or a ₹1,000 target CPL, is the same
    //    expectation on day 1 as on day 90.
    const thisWeekStart = mondayOfIST(now)
    const twoWkStart = new Date(thisWeekStart.getTime() - 14 * 86400000)
    const w2Actuals = computeFunnelActuals(facts, filters, leadById, twoWkStart, thisWeekStart, quarterStart)

    // The QTD spend window is capped at `now` — the growth team's spend sheet is committed
    // for the whole quarter up front (verified live 2026-09-09: it carries rows through Sep
    // 30, weeks past `now`), not filled in day by day, so summing the raw window counts
    // not-yet-incurred spend as if it already happened. Mirrors lib/seller/derive.ts's own
    // fix, reported the same day against 3P specifically but applying to every channel. The
    // Last 2-Week window never needs this: `thisWeekStart` is always <= `now`.
    const spendCutoff = new Date(Math.min(Math.max(now.getTime(), funnelStart.getTime()), funnelEnd.getTime()))
    const qSpend = computeSpendForWindow(facts, filters, funnelStart, spendCutoff)
    const w2Spend = computeSpendForWindow(facts, filters, twoWkStart, thisWeekStart)
    // Null, not zero, whenever spend or the denominator is absent — a 0 would read as free.
    const divRaw = (n: number, d: number): number | null => (n > 0 && d > 0 ? n / d : null)

    const NO_TARGET_METRICS = new Set(['Total Leads (LSH)', 'Direct % of Bids'])
    const RATE_METRICS = new Set(['LTQL %', 'QL-V %', 'Visit Duplication Rate', 'Ever Warm %', 'CPL', 'CPQL', 'CPV', 'CAC'])
    // Lower is better for a cost-per-X metric — overspending is the "behind" direction,
    // the opposite of every other row where more is better.
    const LOWER_IS_BETTER = new Set(['CPL', 'CPQL', 'CPV', 'CAC'])
    type Unit = 'count' | '%' | 'currency' | 'x'
    const UNITS: Record<string, Unit> = {
        Spend: 'currency',
        'Total Leads (LSH)': 'count',
        'Total Unique Leads': 'count',
        CPL: 'currency',
        // Under "Qualified Leads", not "Total Unique Leads" — per an explicit growth-team
        // request, since it reads as the rate that gets you there, not a Total-Unique-Leads
        // child metric. Object key ORDER is what places it in the table (TWO_WEEK_METRIC_ORDER
        // below is Object.keys(UNITS)), so this is a pure reorder, not a formula change.
        'Qualified Leads': 'count',
        'LTQL %': '%',
        CPQL: 'currency',
        'QL-V %': '%',
        'Total Unique Visits': 'count',
        'Total Overall Visits': 'count',
        'Visit Duplication Rate': '%',
        'Old Visits': 'count',
        'New Visits': 'count',
        CPV: 'currency',
        'Ever Warm %': '%',
        'Total Conversions': 'count',
        'Old Conversions': 'count',
        'New Conversions': 'count',
        CAC: 'currency',
        // Appended last, not part of the funnel chain above it — see the directShare() comment.
        'Direct % of Bids': '%',
    }
    const TWO_WEEK_METRIC_ORDER = Object.keys(UNITS)

    const uniqueVisitsTargetQ = targets?.['Total Visits'] ?? null
    const totalVisitsRawTargetQ =
        uniqueVisitsTargetQ != null
            ? Math.round(uniqueVisitsTargetQ * TOTAL_VISITS_RAW_TARGET_MULTIPLIER * 100) / 100
            : null

    function actualsRow(a: FunnelActuals, spend: number, isQuarterColumn: boolean): Record<string, number | null> {
        return {
            Spend: spend,
            'Total Leads (LSH)': a.totalLeadsRaw,
            'Total Unique Leads': a.totalLeads,
            CPL: divRaw(spend, a.totalLeads),
            'LTQL %': ratio(a.qualifiedLeads, a.totalLeads),
            'Qualified Leads': a.qualifiedLeads,
            CPQL: divRaw(spend, a.qualifiedLeads),
            'QL-V %': ratio(a.newVisits, a.qualifiedLeads),
            'Total Unique Visits': a.totalVisits,
            'Total Overall Visits': a.totalVisitsRaw,
            'Visit Duplication Rate': ratio(a.totalVisits, a.totalVisitsRaw),
            'Old Visits': a.oldVisits,
            'New Visits': a.newVisits,
            CPV: divRaw(spend, a.newVisits),
            'Ever Warm %': ratio(a.everWarmLeads, a.totalVisits),
            'Total Conversions': a.totalConversions,
            'Old Conversions': a.oldConversions,
            'New Conversions': a.newConversions,
            // CAC lags spend by months — meaningless over a 2-week slice, only ever shown
            // for the quarter column.
            CAC: isQuarterColumn ? divRaw(spend, a.newConversions) : null,
        }
    }
    const qActualsRow = actualsRow(quarterActuals, qSpend, true)
    const w2ActualsRow = actualsRow(w2Actuals, w2Spend, false)
    // Not part of actualsRow()/FunnelActuals — a different population (bids, not leads) and
    // deliberately unfiltered (see directShare()'s comment), so it's computed straight from the
    // raw fact table and merged in afterward rather than threaded through the funnel-actuals path.
    qActualsRow['Direct % of Bids'] = directShare(facts.bidSources, funnelStart, funnelEnd)
    w2ActualsRow['Direct % of Bids'] = directShare(facts.bidSources, twoWkStart, thisWeekStart)

    // The FULL (unpaced) quarter target for every row — the single source every other
    // number below is prorated from.
    const qTargetsFull: Record<string, number | null> = {
        Spend: targets?.['Spend'] ?? null,
        'Total Leads (LSH)': null,
        'Total Unique Leads': targets?.['Total Leads'] ?? null,
        CPL: targets?.['CPL'] ?? null,
        'LTQL %': safeRatio(targets?.['Qualified Leads'] ?? null, targets?.['Total Leads'] ?? null),
        'Qualified Leads': targets?.['Qualified Leads'] ?? null,
        CPQL: targets?.['CPQL'] ?? null,
        'QL-V %': safeRatio(targets?.['New Visits'] ?? null, targets?.['Qualified Leads'] ?? null),
        'Total Unique Visits': uniqueVisitsTargetQ,
        'Total Overall Visits': totalVisitsRawTargetQ,
        'Visit Duplication Rate': safeRatio(uniqueVisitsTargetQ, totalVisitsRawTargetQ),
        'Old Visits': targets?.['Old Visits'] ?? null,
        'New Visits': targets?.['New Visits'] ?? null,
        CPV: targets?.['CPV'] ?? null,
        'Ever Warm %': safeRatio(targets?.['Every Warm Leads'] ?? null, uniqueVisitsTargetQ),
        'Total Conversions': targets?.['Total Conversions'] ?? null,
        'Old Conversions': targets?.['Old Conversions'] ?? null,
        'New Conversions': targets?.['New Conversions'] ?? null,
        CAC: targets?.['CAC'] ?? null,
        // No target grid entry exists for this — nobody's set a target split yet.
        'Direct % of Bids': null,
    }

    // Quarter Target column: paced by days elapsed for volume metrics, flat for rate
    // metrics (a rate target does not shrink just because less of the quarter has passed).
    const paceShare = daysTotal > 0 ? Math.min(1, Math.max(0, daysElapsed / daysTotal)) : 0
    function pacedQTarget(metric: string): number | null {
        const full = qTargetsFull[metric] ?? null
        if (full == null) return null
        if (NO_TARGET_METRICS.has(metric) || RATE_METRICS.has(metric)) return full
        return Math.round(full * paceShare * 1000) / 1000
    }
    const qTargetsRow: Record<string, number | null> = Object.fromEntries(
        TWO_WEEK_METRIC_ORDER.map((m) => [m, pacedQTarget(m)])
    )

    // Last 2-Week Target: a 14-day pro-rata share of the FULL quarter target — a
    // separate slice from the pacing above, not compounded with it.
    const w2Share = daysTotal > 0 ? 14 / daysTotal : 0
    function w2TargetFor(metric: string): number | null {
        const full = qTargetsFull[metric] ?? null
        if (full == null) return null
        if (NO_TARGET_METRICS.has(metric) || RATE_METRICS.has(metric)) return full
        return Math.round(full * w2Share * 1000) / 1000
    }

    // Lag/gap: positive always means "behind" (colored red), negative "ahead" (green) —
    // for a normal metric that's target minus achieved, but for a cost-per-X metric more
    // spend-per-unit is the bad direction, so the subtraction flips.
    function lagFor(metric: string, target: number | null, achieved: number | null): number | null {
        if (target == null || achieved == null) return null
        const diff = LOWER_IS_BETTER.has(metric) ? achieved - target : target - achieved
        return Math.round(diff * 1000) / 1000
    }

    // Weekly Pace Needed: replaces the old hand-typed "Next 2wk Target" (2026-09-29, per the
    // growth team) — instead of someone typing in a number that goes stale the moment the pace
    // changes, this computes what's actually required. Always measured against the REAL
    // quarter (today through quarterEnd), never the Time filter's window — a filter narrows
    // which leads count (channel/micromarket/source), which this correctly reflects through
    // qTargetFull/qAchieved, but "weeks left" always means weeks left in the real quarter.
    // Null for rate metrics (a % or cost-per-X doesn't accumulate) and once the quarter's over.
    const realWeeksRemaining = Math.max(0, (quarterEnd.getTime() - now.getTime()) / DAY_MS) / 7
    function weeklyPaceNeededFor(metric: string, qTargetFull: number | null, qAchieved: number | null): number | null {
        if (qTargetFull == null || qAchieved == null) return null
        if (NO_TARGET_METRICS.has(metric) || RATE_METRICS.has(metric)) return null
        if (realWeeksRemaining <= 0) return null
        return Math.round((Math.max(0, qTargetFull - qAchieved) / realWeeksRemaining) * 1000) / 1000
    }

    const twoWeekTable: TwoWeekRow[] = TWO_WEEK_METRIC_ORDER.map((metric) => {
        const qTarget = qTargetsRow[metric] ?? null
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
            // compares against the paced (days-elapsed) target instead.
            qPctCompleted: safeRatio(qAchieved, qTargetFull),
            w2Target,
            w2Achieved,
            w2Lag: lagFor(metric, w2Target, w2Achieved),
            weeklyPaceNeeded: weeklyPaceNeededFor(metric, qTargetFull, qAchieved),
        }
    })

    // === Overall Funnel diagram (5.1). "Total Visits" here is the raw completed-visit
    // count, NOT deduped by lead — different from "Total Visits" everywhere else in this
    // file, which is one visit per lead. That lead-deduped figure belongs in this funnel's
    // "Unique Visits" block; this funnel's own "Total Visits" wants the rawer count.
    // Both raw counts (totalLeadsRaw, totalVisitsRaw) come straight off quarterActuals —
    // computeFunnelActuals computes them for whatever window it's given.
    const totalVisitEventsRaw = quarterActuals.totalVisitsRaw
    const totalLeadsRaw = quarterActuals.totalLeadsRaw
    // Same targets the Last 2-Week table computes above, for the quarter column.
    const uniqueVisitsTarget = uniqueVisitsTargetQ
    const totalVisitsRawTarget = totalVisitsRawTargetQ

    const overallFunnel: OverallFunnelData = {
        blocks: [
            { label: 'Total Leads', target: null, actual: totalLeadsRaw },
            { label: 'Unique Leads', target: targets?.['Total Leads'] ?? null, actual: totalLeads },
            { label: 'Qualified Leads', target: targets?.['Qualified Leads'] ?? null, actual: qualifiedLeads },
            { label: 'Unique Visits', target: uniqueVisitsTarget, actual: newVisits + oldVisits },
            { label: 'Total Visits', target: totalVisitsRawTarget, actual: totalVisitEventsRaw },
            { label: 'Total Conversions', target: null, actual: quarterActuals.totalConversionsRaw },
            {
                // Renamed from 'Conversions' — the Target vs Actuals table already has its own
                // (differently-scoped, Direct-only, per-buyer-deduped) "Total Conversions" row,
                // so this pairs with the new float tile above without the same label meaning
                // two different numbers on the same tab. See docs/metric-skill/references/
                // metric-definitions.md for the full explanation.
                label: 'Unique Conversions',
                target: targets?.['Total Conversions'] ?? null,
                actual: newConversions + oldConversions,
            },
        ],
        // EXTRA CONTEXT for the "Total Leads" tile above, not a funnel stage — see
        // OverallFunnelData.lshQualifiedLeads's own doc comment.
        lshQualifiedLeads: quarterActuals.qualifiedLeadsRaw,
        arrows: [
            {
                label: 'Duplicate Ratio',
                unit: 'x',
                target: null,
                achieved: totalLeads > 0 ? Math.round((totalLeadsRaw / totalLeads) * 100) / 100 : null,
            },
            {
                label: 'LTQL %',
                unit: '%',
                target: safeRatio(targets?.['Qualified Leads'] ?? null, targets?.['Total Leads'] ?? null),
                achieved: ratio(qualifiedLeads, totalLeads),
            },
            {
                label: 'QLTV %',
                unit: '%',
                target: safeRatio(targets?.['New Visits'] ?? null, targets?.['Qualified Leads'] ?? null),
                achieved: ratio(newVisits, qualifiedLeads),
            },
            {
                // Target is always exactly TOTAL_VISITS_RAW_TARGET_MULTIPLIER by
                // construction — totalVisitsRawTarget is derived FROM uniqueVisitsTarget x
                // that multiplier, not a separately computed ratio.
                label: 'Duplicate Ratio',
                unit: 'x',
                target: uniqueVisitsTarget != null ? TOTAL_VISITS_RAW_TARGET_MULTIPLIER : null,
                achieved:
                    newVisits + oldVisits > 0
                        ? Math.round((totalVisitEventsRaw / (newVisits + oldVisits)) * 100) / 100
                        : null,
            },
            {
                // Every Warm Leads ÷ Unique Visits (person-deduped), same definition the
                // Two-Week table uses — target is exactly 20% by construction, since
                // funnelTargetsFor derives the Every-Warm-Leads target as 20% of the
                // Total-Visits target. Positioned before Conversions for context even
                // though it isn't literally the Total-Visits-to-Conversions step.
                label: 'Ever Warm %',
                unit: '%',
                target: safeRatio(targets?.['Every Warm Leads'] ?? null, uniqueVisitsTarget),
                achieved: ratio(everWarmLeads, newVisits + oldVisits),
            },
        ],
    }

    return {
        quarterLabel: QUARTER_LABEL,
        expectedPctOfTarget,
        windowWeeks: bucketStarts.length,
        leadsBySource,
        leadsByStatus,
        qualifiedBySource,
        notQualifiedReasons,
        visitPipeline,
        twoWeekTable,
        overallFunnel,
        frtByWeek,
        uniqueVisitsBySource,
        uniqueGrossVisitsBySource,
        visitsByBidSource,
        everWarmByWeek,
        totalVisitsByMicromarket,
        qualifiedByCluster,
        visitedByEverWarm,
        leadsByCampaign: leadsByCampaignCapped,
        qualifiedByCampaign: qualifiedByCampaignCapped,
        leadsByAdSet: leadsByAdSetCapped,
        qualifiedByAdSet: qualifiedByAdSetCapped,
        leadsByAd: leadsByAdCapped,
        qualifiedByAd: qualifiedByAdCapped,
        leadsByProperty: leadsByPropertyCapped,
        qualifiedByProperty: qualifiedByPropertyCapped,
        leadsByMicromarket,
        qualifiedByMicromarket,
        lshExtraByDimension,
        lshCountByWeek,
        lshQualifiedByWeek,
        uniqueVisitsByLeadCreatedWeek,
        uniqueGrossVisitsByLeadCreatedWeek,
        cplByWeek,
        cpqlByWeek,
        cpvByWeek,
        leadsById: leadListItems,
        spendIngest: facts.spendIngest,
    }
}
