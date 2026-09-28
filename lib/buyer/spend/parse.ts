import type { SpendFact, SpendIngest } from '../facts'
import { VALID_MICROMARKETS, fixMicromarket, mapChannel } from '../shared'
import { norm, parseCount, parseInr, parseSheetDate } from '@/lib/spend/sheet'

// Token lookup for deriving a micromarket out of a campaign NAME, for the live ad-platform
// sheet (day x campaign x ad set x ad, no micromarket column of its own). Built from
// VALID_MICROMARKETS plus the campaign-naming typos already known elsewhere (MICROMARKET_FIX's
// `Ibizi` -> `Ibiza`, `Glassgow` -> `Glasgow`) so the two lists cannot drift apart.
const MICROMARKET_TOKEN_ALIASES: Record<string, string> = (() => {
    const map: Record<string, string> = {}
    for (const mm of VALID_MICROMARKETS) map[mm.toLowerCase().replace(/[^a-z0-9]/g, '')] = mm
    map['ibizi'] = 'Ibiza'
    map['glassgow'] = 'Glasgow'
    return map
})()

/** A campaign name resolves to a micromarket only when it names EXACTLY one. Zero matches
 *  (a generic/retargeting campaign) and more than one (a cluster-level campaign like
 *  `Meta_TOF_Lead_Buyer_Babu_190626` — BABU is a cluster of three micromarkets, not one; or a
 *  campaign naming two micromarkets at once) both return null rather than guess, matching how
 *  this dashboard treats every other unattributable row: visible as Unknown, never split or
 *  allocated by an invented rule. Tokens are split on anything non-alphanumeric and matched
 *  both singly and as adjacent pairs, so a two-word micromarket (`Hong Kong` -> `hongkong`)
 *  matches the same way a one-word one does. */
export function micromarketFromCampaignName(campaignName: string): string | null {
    const tokens = campaignName.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
    const found = new Set<string>()
    for (const t of tokens) {
        const mm = MICROMARKET_TOKEN_ALIASES[t]
        if (mm) found.add(mm)
    }
    for (let i = 0; i < tokens.length - 1; i++) {
        const mm = MICROMARKET_TOKEN_ALIASES[tokens[i]! + tokens[i + 1]!]
        if (mm) found.add(mm)
    }
    return found.size === 1 ? [...found][0]! : null
}

// Pure aggregation: the growth team's spend sheet (~95K rows at day × campaign × adset ×
// ad × micromarket) collapsed to one SpendFact per (day × channel × micromarket × source).
// Shared by scripts/build-spend.ts (committed snapshot) and, later, the live reader.
//
// Columns are matched by NORMALISED HEADER TEXT, never position — the growth team adds
// and reorders columns. A missing required header is a hard, named error, because
// guessing by position is how you chart Impressions as Spends.
//
// The format primitives (dates, CSV, rupee strings) moved to lib/spend/sheet.ts when the
// seller tab needed them too. Re-exported here so existing buyer imports and
// __tests__/spend-parse.test.ts keep working unchanged.
export { parseCsv, parseInr, parseSheetDate } from '@/lib/spend/sheet'

const REQUIRED = ['date', 'utm source', 'utm micromarket', 'spends (in inr)'] as const

// The buyer tab's slash dates are M/D — proved against the file: the first component never
// exceeds 12 while the second reaches 31. Named at the call site rather than left to
// parseSheetDate's default, so the assumption is visible where it is relied on.
const BUYER_SLASH_ORDER = 'MDY' as const

export interface ParseResult {
    facts: SpendFact[]
    report: SpendIngest
}

export function parseSpendTable(header: string[], rows: string[][], builtAt: string | null = null): ParseResult {
    const idx = new Map(header.map((h, i) => [norm(h), i]))
    const missing = REQUIRED.filter((r) => !idx.has(r))
    if (missing.length > 0) {
        return {
            facts: [],
            report: {
                origin: 'snapshot',
                status: 'schema-error',
                error: `Missing required column(s): ${missing.join(', ')}`,
                rowsRead: rows.length,
                rowsKept: 0,
                droppedBadDate: 0,
                droppedBadSpend: 0,
                unmappedSources: [],
                unknownMicromarkets: [],
                builtAt,
            },
        }
    }

    const col = (row: string[], key: string) => (row[idx.get(key)!] ?? '').trim()
    const agg = new Map<string, SpendFact>()
    const unmapped = new Set<string>()
    const unknownMm = new Set<string>()
    let droppedBadDate = 0
    let droppedBadSpend = 0
    let kept = 0

    for (const row of rows) {
        const date = parseSheetDate(col(row, 'date'), BUYER_SLASH_ORDER)
        if (!date) {
            droppedBadDate++
            continue
        }
        const spend = parseInr(col(row, 'spends (in inr)'))
        if (spend === null) {
            droppedBadSpend++
            continue
        }

        const rawSource = col(row, 'utm source')
        // mapChannel returns null only for excluded sources (Channel Partner / Builder /
        // Seller Referral), which do not appear in spend; keep any such row visible under
        // Unmapped rather than dropping the money.
        const channel = mapChannel(rawSource) ?? 'Unmapped'
        if (channel === 'Unmapped' && rawSource) unmapped.add(rawSource)

        const rawMm = col(row, 'utm micromarket')
        const fixed = fixMicromarket(rawMm)
        let micromarket: string | null = null
        if (VALID_MICROMARKETS.has(fixed)) micromarket = fixed
        else if (rawMm) unknownMm.add(rawMm)

        const impressions = idx.has('impressions') ? parseCount(col(row, 'impressions')) : 0
        const clicks = idx.has('clicks') ? parseCount(col(row, 'clicks')) : 0

        const key = `${date}|${channel}|${micromarket ?? ''}|${rawSource.toLowerCase()}`
        const existing = agg.get(key)
        if (existing) {
            // Duplicate keys are SUMMED, never deduped: two rows for one ad on one day is
            // legitimate, and dropping one understates spend — the direction that flatters CPL.
            existing.spendInr += spend
            existing.impressions += impressions
            existing.clicks += clicks
        } else {
            agg.set(key, { date, channel, micromarket, rawSource: rawSource.toLowerCase(), spendInr: spend, impressions, clicks })
        }
        kept++
    }

    return {
        facts: [...agg.values()],
        report: {
            origin: 'snapshot',
            status: 'ok',
            error: null,
            rowsRead: rows.length,
            rowsKept: kept,
            droppedBadDate,
            droppedBadSpend,
            unmappedSources: [...unmapped].slice(0, 20),
            unknownMicromarkets: [...unknownMm].slice(0, 20),
            builtAt,
        },
    }
}

// Column names the growth team has used for spend, in the order tried. The sheet was
// restructured into separate Buyer/Seller tabs on 2026-09-29 and "Cost" became "Amount spent
// (INR)" in the move (the earlier "Spends" single-tab export used "Cost") — both are accepted
// rather than picking one, so a future rename doesn't silently zero out every row until
// someone notices the dashboard is empty and reads the diff. Impr/Clicks tolerate the same
// drift; being optional, a total mismatch there degrades to 0 rather than a hard error.
const SPEND_COLUMN_ALIASES = ['amount spent (inr)', 'cost']
const IMPRESSIONS_COLUMN_ALIASES = ['impressions', 'impr']
const CLICKS_COLUMN_ALIASES = ['link clicks', 'clicks']

function firstPresentKey(idx: Map<string, number>, aliases: string[]): string | null {
    return aliases.find((a) => idx.has(a)) ?? null
}

const AD_PLATFORM_REQUIRED = ['date', 'lead source', 'campaign name'] as const

/** The growth team's live ad-platform export (the "Spends" Google Sheet's Buyer tab, one row
 *  per day x campaign x ad set x ad) — replaces the old day x channel x micromarket x source
 *  workbook this dashboard used to read. Dates here are always `D-Mon-YY`/`D-Mon-YYYY`
 *  (verified live 2026-09-28; no slash-form dates observed), so `parseSheetDate` needs no
 *  slash order. `Lead Source` already matches CHANNEL_MAP's keys exactly (`Meta`, `Google Ads`,
 *  `google_ads`, `LinkedIn`) — no new channel logic. Micromarket comes from the campaign name
 *  via `micromarketFromCampaignName`; a campaign that resolves to none is named under
 *  `unknownMicromarkets` (by campaign name, since there is no raw micromarket value to show).
 *
 *  `windowStart`/`windowEnd` (ISO, half-open) filter rows before aggregating — the sheet is
 *  fetched whole (224K+ rows as of 2026-09-28) and callers only ever need one dashboard window
 *  of it. */
export function parseAdPlatformSpendTable(
    header: string[],
    rows: string[][],
    builtAt: string | null,
    windowStart?: string,
    windowEnd?: string
): ParseResult {
    const idx = new Map(header.map((h, i) => [norm(h), i]))
    const missing: string[] = AD_PLATFORM_REQUIRED.filter((r) => !idx.has(r))
    const spendKey = firstPresentKey(idx, SPEND_COLUMN_ALIASES)
    if (!spendKey) missing.push(`one of: ${SPEND_COLUMN_ALIASES.join(', ')}`)
    if (missing.length > 0) {
        return {
            facts: [],
            report: {
                origin: 'sheet-live',
                status: 'schema-error',
                error: `Missing required column(s): ${missing.join(', ')}`,
                rowsRead: rows.length,
                rowsKept: 0,
                droppedBadDate: 0,
                droppedBadSpend: 0,
                unmappedSources: [],
                unknownMicromarkets: [],
                builtAt,
            },
        }
    }

    const col = (row: string[], key: string) => (row[idx.get(key)!] ?? '').trim()
    const impressionsKey = firstPresentKey(idx, IMPRESSIONS_COLUMN_ALIASES)
    const clicksKey = firstPresentKey(idx, CLICKS_COLUMN_ALIASES)
    const startMs = windowStart ? new Date(windowStart).getTime() : -Infinity
    const endMs = windowEnd ? new Date(windowEnd).getTime() : Infinity
    const agg = new Map<string, SpendFact>()
    const unmapped = new Set<string>()
    const unknownMm = new Set<string>()
    let droppedBadDate = 0
    let droppedBadSpend = 0
    let kept = 0

    for (const row of rows) {
        const date = parseSheetDate(col(row, 'date'), null)
        if (!date) {
            droppedBadDate++
            continue
        }
        const dateMs = new Date(date).getTime()
        if (dateMs < startMs || dateMs >= endMs) continue

        const spend = parseInr(col(row, spendKey!))
        if (spend === null) {
            droppedBadSpend++
            continue
        }

        const rawSource = col(row, 'lead source')
        const channel = mapChannel(rawSource) ?? 'Unmapped'
        if (channel === 'Unmapped' && rawSource) unmapped.add(rawSource)

        const campaignName = col(row, 'campaign name')
        const micromarket = micromarketFromCampaignName(campaignName)
        if (!micromarket && campaignName) unknownMm.add(campaignName)

        const impressions = impressionsKey ? parseCount(col(row, impressionsKey)) : 0
        const clicks = clicksKey ? parseCount(col(row, clicksKey)) : 0

        const key = `${date}|${channel}|${micromarket ?? ''}|${rawSource.toLowerCase()}`
        const existing = agg.get(key)
        if (existing) {
            existing.spendInr += spend
            existing.impressions += impressions
            existing.clicks += clicks
        } else {
            agg.set(key, { date, channel, micromarket, rawSource: rawSource.toLowerCase(), spendInr: spend, impressions, clicks })
        }
        kept++
    }

    return {
        facts: [...agg.values()],
        report: {
            origin: 'sheet-live',
            status: 'ok',
            error: null,
            rowsRead: rows.length,
            rowsKept: kept,
            droppedBadDate,
            droppedBadSpend,
            unmappedSources: [...unmapped].slice(0, 20),
            unknownMicromarkets: [...unknownMm].slice(0, 20),
            builtAt,
        },
    }
}

export const EMPTY_SPEND_INGEST: SpendIngest = {
    status: 'unavailable',
    error: 'No spend snapshot loaded',
    rowsRead: 0,
    rowsKept: 0,
    droppedBadDate: 0,
    droppedBadSpend: 0,
    unmappedSources: [],
    unknownMicromarkets: [],
    origin: 'snapshot',
    builtAt: null,
}
