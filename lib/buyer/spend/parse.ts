import type { SpendFact, SpendIngest } from '../facts'
import { VALID_MICROMARKETS, fixMicromarket, mapChannel } from '../shared'
import { norm, parseCount, parseInr, parseSheetDate } from '@/lib/spend/sheet'

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
