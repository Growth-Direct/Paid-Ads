import type { Channel } from './types'

// Pure helpers shared by the fact builder (aggregate.ts) and the aggregation layer
// (derive.ts). Nothing here touches Zoho or the network.

// Telephony dispositions the Acefone webhook writes into Lead_Status — never real
// statuses, always folded into Attempted to Contact rather than dropped or shown raw.
// See truva-growth-reporting skill, known-traps.md #7/#16.
export const TELEPHONY_JUNK_STATUSES = new Set([
    'Open - Disconnected',
    'Network Issue',
    'Customer Network Issue',
    'Call Rejected',
    'Not Reachable',
    'Unallocated Number',
    'Receiver is busy',
    'System Failure',
    'Channel Issue',
])

// Buyer channel taxonomy from the truva-growth-reporting skill's metric-definitions.md,
// lowercased for case-insensitive matching against known junk casings (known-traps.md #5).
//
// EXCLUDED_SOURCES below has DIVERGED from Metabase deliberately and no longer matches its
// leads_eligible CTE, which runs only
// `lower(Lead_Source) NOT IN ('channel partner', 'builder', 'seller referral')`.
// The divergence now runs BOTH ways. We additionally exclude NoBroker and Society Partners
// (Metabase counts NoBroker as 3P; buyer-side direct reporting never does), but since
// 2026-09-16 we no longer exclude Seller Referral, which Metabase still drops. Our lead
// counts therefore sit slightly ABOVE Metabase's on seller-referral volume and below it on
// NoBroker/Society Partners — both gaps are the rule, not a bug, and they do not cancel out.
export const CHANNEL_MAP: Record<string, Channel> = {
    meta: 'Paid Ads',
    'google ads': 'Paid Ads',
    google_ads: 'Paid Ads',
    google: 'Paid Ads',
    linkedin: 'Paid Ads',
    'paid ads (unattributed)': 'Paid Ads',
    fb: 'Paid Ads',
    '99acres': '3P',
    housing: '3P',
    magicbricks: '3P',
    'offline branding': 'Offline Branding',
    'society wa groups': 'Society WA Groups & Management Apps',
    'society management app': 'Society WA Groups & Management Apps',
    'society data': 'Society WA Groups & Management Apps',
    website: 'Organic',
    instagram: 'Organic',
    ig: 'Organic', // known-traps.md #24: lowercase junk, fold into Instagram -> Organic
    whatsapp: 'Organic',
    organic: 'Organic',
    'word of mouth': 'Referral & WOM',
    referral: 'Referral & WOM',
    // Brought back into the population 2026-09-16 at the growth team's decision — it had been
    // excluded outright, so these leads were missing from EVERY buyer metric, not merely
    // uncategorised. Grouped with Word of Mouth and Referral because that channel already
    // carries a target; a channel of its own would have no grid entry and render blank.
    'seller referral': 'Referral & WOM',
}
// NoBroker was previously mapped to 3P alongside 99acres/Housing/MagicBricks, matching
// the seller taxonomy. Per the user, buyer-side direct channel reporting never includes
// NoBroker — excluded from the DRR population entirely, same as Channel Partner/Builder/
// Seller Referral, not just left out of the 3P bucket.
//
// 'society partners' is PLURAL — verified live against 24 months of Lead_Source values
// (2 leads, 2024-09..2026-09). The singular "Society Partner" does not exist and would
// have silently excluded nothing. It is a partner-sourced channel and is NOT the same as
// the direct 'Society WA Groups' / 'Society Management App' / 'Society Data' sources,
// which stay in the population as the Society WA Groups & Management Apps channel.
// 'seller referral' was removed from this set on 2026-09-16, per the growth team: a seller
// referral is direct demand, not partner-sourced. Note Metabase still excludes it, so our
// lead counts now run ABOVE Metabase's rather than below — the reconciliation gap flipped
// direction, and older quarters are not comparable on this metric without recomputing.
// First Response Time keeps excluding it separately (FRT_EXCLUDED_SOURCES in derive.ts).
export const EXCLUDED_SOURCES = new Set(['channel partner', 'builder', 'nobroker', 'society partners'])

// Virtual/demo micromarkets — live values are "Airport (Virtual)", "Mainland (Virtual)",
// "Viceport (Virtual)" and "Leaf Links (Virtual)". Matched on the "(virtual)" substring
// rather than a fixed list: the names are free-form and new ones keep appearing, while no
// real micromarket contains the word (verified across 12 months of lead and event values).
// These are excluded from the population entirely — leads, qualified leads, visits and
// conversions alike — not merely omitted from the per-micromarket charts, which is all
// VALID_MICROMARKETS ever did.
export function isVirtualMicromarket(m: string | null | undefined): boolean {
    return (m ?? '').toLowerCase().includes('(virtual)')
}

// Casing/typo corrections only. Athens is the canonical micromarket name — it is the
// internal codename, consistent with Powai, Vegas, Glasgow and the rest. Metabase
// relabels it "Andheri (E)"; we do not, so that one axis label differs from Metabase
// while the counts behind it are identical.
export const MICROMARKET_FIX: Record<string, string> = {
    VEGAS: 'Vegas',
    Glassgow: 'Glasgow',
    'Andheri (E)': 'Athens',
    // The spend sheet spells the Bangalore micromarket `Ibizi`; Zoho and the growth ledger
    // both say `Ibiza`. One place, so one spelling.
    Ibizi: 'Ibiza',
}

export const VALID_CLUSTERS = new Set(['PAV', 'GLAM', 'BABU', 'HABIBI'])

// The named live micromarkets. Junk and virtual market strings ("Outside MM",
// "Unrecognised yet", "Leaf Links (Virtual)" and friends) are deliberately absent
// and get dropped from micromarket views.
export const VALID_MICROMARKETS = new Set([
    'Powai',
    'Vegas',
    'Athens',
    'Glasgow',
    'Amsterdam',
    'Boston',
    'Barcelona',
    'Singapore',
    'Berlin',
    'Hong Kong',
    'Helsinki',
    // Added 2026-09-16: a new HABIBI (Bangalore) micromarket. It has no row of its own in
    // either target grid, which lump HABIBI as a single `Bangalore` row — see
    // CLUSTER_TARGET_ALIAS. Leads, visits and spend for it are real and counted; only its
    // target comes from the cluster. Anything off this list is DROPPED from the micromarket
    // charts, so Ibiza's data was invisible rather than zero before it was added.
    'Ibiza',
    'Bangalore',
])

// Raw Zoho Lead_Source (lowercased) to the display spelling the by-source charts show.
// Same key space as CHANNEL_MAP, so the two stay in step — every key here should map to a
// channel there. This exists because the raw values carry casing junk that would otherwise
// split one source into several legend entries: `ig` alongside `Instagram`, lowercase
// `meta`/`google` alongside the proper ones, and Zoho's `Magicbricks` vs the brand's
// `MagicBricks`. `fb` folds into Meta — same advertiser, old name.
export const SOURCE_LABEL: Record<string, string> = {
    meta: 'Meta',
    fb: 'Meta',
    'google ads': 'Google Ads',
    google_ads: 'Google Ads',
    google: 'Google Ads',
    linkedin: 'LinkedIn',
    'paid ads (unattributed)': 'Paid Ads (Unattributed)',
    '99acres': '99Acres',
    housing: 'Housing',
    magicbricks: 'MagicBricks',
    'offline branding': 'Offline Branding',
    'society wa groups': 'Society WA Groups',
    'society management app': 'Society Management App',
    'society data': 'Society Data',
    website: 'Website',
    instagram: 'Instagram',
    ig: 'Instagram',
    whatsapp: 'WhatsApp',
    organic: 'Organic',
    'word of mouth': 'Word of Mouth',
    referral: 'Referral',
    'seller referral': 'Seller Referral',
}

/** Display name for a raw Lead_Source. Unrecognised values are kept verbatim rather than
 *  dropped — a new source has to announce itself on the chart, same rule as `Unmapped`
 *  in mapChannel. A blank source is 'Unmapped'. */
export function sourceLabel(source: string | null | undefined): string {
    const raw = (source ?? '').trim()
    if (!raw) return 'Unmapped'
    return SOURCE_LABEL[raw.toLowerCase()] ?? raw
}

export function mapChannel(source: string | null | undefined): Channel | null {
    if (!source) return 'Unmapped'
    const lower = source.trim().toLowerCase()
    if (EXCLUDED_SOURCES.has(lower)) return null // out of DRR scope entirely
    return CHANNEL_MAP[lower] ?? 'Unmapped'
}

export function foldStatus(status: string | null | undefined): string {
    const s = (status ?? '').trim()
    if (!s) return 'Unknown'
    return TELEPHONY_JUNK_STATUSES.has(s) ? 'Attempted to Contact' : s
}

/** Truva_Cluster, Truva_Micromarket and UTM_Micromarket are multiselect picklists; a plain
 *  string can still come back depending on the field's live configuration. Normalise to an
 *  array.
 *
 *  COQL returns a multiselect as ONE semicolon-joined string, so the split matters: without
 *  it, values like "Powai;Vegas" and "Powai; Glasgow" were kept whole, matched no
 *  micromarket filter, and drew their own junk bars on the micromarket charts. Only ';' is
 *  split — it is Zoho's delimiter. Free-text junk using other separators ("Glasgow /
 *  Amsterdam") is left alone rather than guessed at. */
export function toList(raw: string[] | string | null | undefined): string[] {
    const values = Array.isArray(raw) ? raw : [raw]
    return values
        .flatMap((v) => (v ?? '').split(';'))
        .map((v) => v.trim())
        .filter(Boolean)
}

export function firstCluster(raw: string[] | string | null | undefined): string {
    return toList(raw)[0] ?? ''
}

/** VCV is a test cluster. Null-safe: a lead with no cluster is never VCV, so it survives.
 *  Reads the first value only, matching Metabase. A record tagged VCV in second position
 *  therefore survives — see isVcvAny, which is the stricter reading we have not adopted
 *  because it would silently move numbers away from the reconciled baseline. */
export function isVcv(raw: string[] | string | null | undefined): boolean {
    return firstCluster(raw).toUpperCase() === 'VCV'
}

/** Stricter: true if VCV appears anywhere in the multiselect. Not used yet. */
export function isVcvAny(raw: string[] | string | null | undefined): boolean {
    return toList(raw).some((c) => c.toUpperCase() === 'VCV')
}

/** Historical reading: validate the FIRST value only, so a record whose first cluster is
 *  unrecognised lands in Unknown even when a later value is valid. */
export function clusterPrimary(raw: string[] | string | null | undefined): string {
    const c = firstCluster(raw).toUpperCase()
    return VALID_CLUSTERS.has(c) ? c : 'Unknown'
}

/** Every valid cluster on the record. Used once counting moves to count-in-both. */
export function cleanClusters(raw: string[] | string | null | undefined): string[] {
    const out = toList(raw)
        .map((c) => c.toUpperCase())
        .filter((c) => VALID_CLUSTERS.has(c))
    return out.length > 0 ? out : ['Unknown']
}

/** Applies the casing/codename fixes but does NOT drop unrecognised values — the two
 *  micromarket cards disagree on what to do with them. The visit-pipeline card keeps
 *  them (as "Unknown"), the visits-by-micromarket card drops them to match Metabase's
 *  explicit whitelist. Callers decide, using VALID_MICROMARKETS. */
export function fixMicromarkets(raw: string[] | string | null | undefined): string[] {
    return toList(raw).map((m) => MICROMARKET_FIX[m] ?? m)
}

export function fixMicromarket(raw: string | null | undefined): string {
    const m = (raw ?? '').trim()
    return MICROMARKET_FIX[m] ?? m
}

export const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000

/** Monday 00:00 IST of the week containing `d`. */
export function mondayOfIST(d: Date): Date {
    const ist = new Date(d.getTime() + IST_OFFSET_MS)
    const day = ist.getUTCDay()
    const diff = day === 0 ? -6 : 1 - day
    const mon = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() + diff))
    return new Date(mon.getTime() - IST_OFFSET_MS)
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function weekLabel(monday: Date): string {
    const ist = new Date(monday.getTime() + IST_OFFSET_MS)
    return `${ist.getUTCDate()} ${MONTHS[ist.getUTCMonth()]}`
}

export function dateKey(d: Date): string {
    const ist = new Date(d.getTime() + IST_OFFSET_MS)
    return ist.toISOString().slice(0, 10)
}

export function toZohoDateTime(d: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T00:00:00+05:30`
}

/** First of the month, 00:00 IST, for the month containing `d`. */
export function monthOfIST(d: Date): Date {
    const ist = new Date(d.getTime() + IST_OFFSET_MS)
    const first = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), 1))
    return new Date(first.getTime() - IST_OFFSET_MS)
}

export function monthLabel(first: Date): string {
    const ist = new Date(first.getTime() + IST_OFFSET_MS)
    return `${MONTHS[ist.getUTCMonth()]} ${String(ist.getUTCFullYear()).slice(2)}`
}

// Cluster to micromarket, from Knowledge/truva/truva-overview.md. Zoho models these as
// two independent multiselect picklists with no relationship between them, so the tree
// cannot be read from the CRM. MM Admin (apps/mm-admin) is the real registry; this is a
// transcription of the documented grouping and will drift if micromarkets are regrouped.
export const CLUSTER_TREE: Record<string, string[]> = {
    PAV: ['Powai', 'Vegas', 'Athens'],
    GLAM: ['Glasgow', 'Amsterdam'],
    BABU: ['Boston', 'Barcelona', 'Singapore'],
    HABIBI: ['Helsinki', 'Berlin', 'Hong Kong', 'Ibiza'],
}

/** The target grid holds Bangalore as one lumped row rather than its three
 *  micromarkets, so a HABIBI selection has to resolve to it. */
export const CLUSTER_TARGET_ALIAS: Record<string, string[]> = {
    HABIBI: ['Bangalore'],
}

export function micromarketsForClusters(clusters: string[]): string[] {
    return clusters.flatMap((c) => CLUSTER_TARGET_ALIAS[c] ?? CLUSTER_TREE[c] ?? [])
}

/** Quarter boundaries in IST. Quarters are Jan-Mar, Apr-Jun, Jul-Sep, Oct-Dec. */
export function quarterStartOfIST(d: Date): Date {
    const ist = new Date(d.getTime() + IST_OFFSET_MS)
    const q = Math.floor(ist.getUTCMonth() / 3)
    return new Date(Date.UTC(ist.getUTCFullYear(), q * 3, 1) - IST_OFFSET_MS)
}

export function quarterEndOfIST(d: Date): Date {
    const s = quarterStartOfIST(d)
    const ist = new Date(s.getTime() + IST_OFFSET_MS)
    return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth() + 3, 1) - IST_OFFSET_MS)
}

const QUARTER_NAMES = ['JFM', 'AMJ', 'JAS', 'OND']

export function quarterLabelOf(d: Date): string {
    const ist = new Date(d.getTime() + IST_OFFSET_MS)
    return `${QUARTER_NAMES[Math.floor(ist.getUTCMonth() / 3)]} ${ist.getUTCFullYear()}`
}

/** Splits [start, end) into calendar-month slices. COQL caps a single query at 10,000
 *  rows including the offset, and one query cannot page past it, so a window wider than
 *  roughly two quarters has to be fetched a month at a time. */
export function monthSlices(start: Date, end: Date): Array<[Date, Date]> {
    const out: Array<[Date, Date]> = []
    let cursor = monthOfIST(start)
    if (cursor < start) cursor = start
    while (cursor < end) {
        const nextMonth = monthOfIST(new Date(cursor.getTime() + 32 * 86400000))
        const sliceEnd = nextMonth < end ? nextMonth : end
        out.push([cursor, sliceEnd])
        cursor = sliceEnd
    }
    return out
}

/** One slice for a window up to a quarter, month slices beyond that. Keeps the common
 *  case at a single round trip. */
export function fetchSlices(start: Date, end: Date): Array<[Date, Date]> {
    const days = (end.getTime() - start.getTime()) / 86400000
    return days <= 100 ? [[start, end]] : monthSlices(start, end)
}

// Bucketing shared by derive.ts (the twelve cards) and costs.ts, so both honour the
// week/month grain and the multi-period gaps identically. Extracted from derive.ts; the
// golden test proves the extraction did not move any funnel number.
export interface Period {
    start: string
    end: string
}

export interface Buckets {
    bucketStarts: Date[]
    labelOf: (d: Date) => string
    /** Bucket index for an ISO instant, or undefined when it falls outside every
     *  selected period (or the range). */
    bucketOf: (iso: string) => number | undefined
    /** Per-bucket: is this bucket still in progress (its end is in the future)? The loop
     *  below admits a bucket as soon as its START is before now, so the current week or month
     *  always appears holding only the days elapsed so far. Rendered at the same visual weight
     *  as a complete bucket it reads as a collapse — with six WoW charts on the Seller tab that
     *  is six identical false cliffs — so charts hatch these bars instead of hiding them.
     *  Hiding would be worse: the current week is the one people most want to see. */
    bucketIncomplete: boolean[]
    /** Per-bucket: does this bucket START before the selected range, so it holds only its
     *  tail end? Only ever true for the first bucket, and only when the range begins
     *  mid-week — a quarter starting on a Wednesday leaves a 5-day stub under a Monday-start
     *  bucket. Charts that pair weeks into fortnights leave such a stub standing alone, so
     *  every pair after it begins on the first FULL week and the grouping stays put as the
     *  quarter fills in. Unlike bucketIncomplete this does NOT hatch the bar or change its
     *  label — the days it holds are real and final, there are just fewer of them. */
    bucketPartialStart: boolean[]
    rangeStart: Date
    rangeEnd: Date
}

function inPeriods(periods: Period[], d: Date): boolean {
    if (periods.length === 0) return true
    return periods.some((p) => d >= new Date(p.start) && d < new Date(p.end))
}

export function buildBuckets(
    periods: Period[],
    grain: 'week' | 'month',
    quarterStart: Date,
    quarterEnd: Date,
    now: Date
): Buckets {
    const rangeStart = periods.length
        ? new Date(Math.min(...periods.map((p) => new Date(p.start).getTime())))
        : quarterStart
    const rangeEnd = periods.length
        ? new Date(Math.max(...periods.map((p) => new Date(p.end).getTime())))
        : quarterEnd
    const byMonth = grain === 'month'
    const startOf = byMonth ? monthOfIST : mondayOfIST
    const labelOf = byMonth ? monthLabel : weekLabel

    const bucketStarts: Date[] = []
    for (let b = startOf(rangeStart); b < now && b < rangeEnd; ) {
        const next = byMonth ? startOf(new Date(b.getTime() + 32 * 86400000)) : new Date(b.getTime() + 7 * 86400000)
        if (periods.length === 0 || inPeriods(periods, b) || inPeriods(periods, new Date(next.getTime() - 1))) {
            bucketStarts.push(b)
        }
        b = next
    }
    const idx = new Map(bucketStarts.map((b, i) => [dateKey(b), i]))
    const bucketOf = (iso: string): number | undefined => {
        const d = new Date(iso)
        if (Number.isNaN(d.getTime())) return undefined
        if (d < rangeStart || d >= rangeEnd) return undefined
        if (!inPeriods(periods, d)) return undefined
        return idx.get(dateKey(startOf(d)))
    }
    // A bucket is incomplete when its end runs past now, or past the selected range/period
    // (a quarter filter can clip the final week mid-way just as today can).
    const hardEnd = Math.min(now.getTime(), rangeEnd.getTime())
    const bucketIncomplete = bucketStarts.map((b) => {
        const next = byMonth ? startOf(new Date(b.getTime() + 32 * 86400000)) : new Date(b.getTime() + 7 * 86400000)
        return next.getTime() > hardEnd
    })
    const bucketPartialStart = bucketStarts.map((b) => b.getTime() < rangeStart.getTime())
    return { bucketStarts, labelOf, bucketOf, bucketIncomplete, bucketPartialStart, rangeStart, rangeEnd }
}
