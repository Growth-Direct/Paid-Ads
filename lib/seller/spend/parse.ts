import type { SellerSpendFact, SellerSpendIngest } from '../facts'
import { mapSellerChannel } from '../shared'
import { SELLER_MICROMARKETS } from '../types'
import { type SlashOrder, norm, parseCount, parseInr, parseSheetDate } from '@/lib/spend/sheet'

// Pure aggregation for the "Seller side spends" tab of Spends_Structure.xlsx: ~21.8K rows at
// day × campaign × adset × ad × micromarket, collapsed to one SellerSpendFact per
// (day × channel × micromarket × raw source). Shared by scripts/build-seller-spend.ts and,
// if the sheet ever becomes a live read, by that reader too.
//
// Deliberately a sibling of lib/buyer/spend/parse.ts rather than a shared generic: the two
// tabs agree on their column headers and on nothing else. They differ in date order (D/M here
// vs M/D there), channel taxonomy, valid micromarket list, and what an unrecognised
// micromarket means. Only the format primitives are shared, via lib/spend/sheet.ts.
//
// Columns are matched by NORMALISED HEADER TEXT, never position — the growth team adds and
// reorders columns. A missing required header is a hard, named error, because guessing by
// position is how you chart Impressions as Spends.

const REQUIRED = ['date', 'utm source', 'utm micromarket', 'spends (in inr)'] as const

const VALID_MICROMARKETS = new Set<string>(SELLER_MICROMARKETS)

// Casing/typo corrections only, applied before the valid-micromarket check. `Anthens` is a
// live misspelling of Athens on this tab (₹917 as of the 2026-09-08 export) — without the fix
// that money falls into the unallocated bucket and disappears from every micromarket view.
// Seller-specific on purpose: buyer's MICROMARKET_FIX corrects a different set of typos.
const SELLER_MICROMARKET_FIX: Record<string, string> = {
    Anthens: 'Athens',
    Glassgow: 'Glasgow',
    VEGAS: 'Vegas',
    'Andheri (E)': 'Athens',
}

// Sheet values that legitimately mean "this spend is not attributable to one micromarket".
// These go to the unallocated bucket WITHOUT being reported as unknown: `All MM` is the tab's
// most expensive single value (14.6% of spend), so listing it as an anomaly would train the
// growth team to ignore the anomaly list. A blank cell means the same thing.
const UNALLOCATED_MICROMARKET_VALUES = new Set(['', 'all mm'])

/** A sheet or ledger micromarket string resolved to this dashboard's seller taxonomy.
 *
 *  `micromarket` is null for the unallocated bucket, and `unknown` says whether that null is a
 *  data-entry problem worth naming. `All MM` and a blank cell mean "not attributable to one
 *  micromarket" on purpose, so they are unallocated WITHOUT being flagged — `All MM` is the
 *  tab's single most expensive value, and listing it as an anomaly trains everyone to ignore
 *  the anomaly list. Anything else unrecognised is flagged.
 *
 *  Exported so scripts/reconcile-spend.ts maps the ledger's micromarkets exactly the way the
 *  sheet parser maps the sheet's. A reconciliation that applied two different rules would
 *  report a difference it had created itself. */
export function resolveSellerMicromarket(raw: string | null | undefined): {
    micromarket: string | null
    unknown: boolean
} {
    const trimmed = (raw ?? '').trim()
    const fixed = SELLER_MICROMARKET_FIX[trimmed] ?? trimmed
    if (VALID_MICROMARKETS.has(fixed)) return { micromarket: fixed, unknown: false }
    return { micromarket: null, unknown: !UNALLOCATED_MICROMARKET_VALUES.has(trimmed.toLowerCase()) }
}

export interface SellerParseResult {
    facts: SellerSpendFact[]
    report: SellerSpendIngest
}

/** `slashOrder` is required, not defaulted: the two tabs of this one workbook disagree on it,
 *  so inheriting a default is how you transpose every day and month. Callers derive it from
 *  the data with inferSlashOrder() and refuse to build when it can't be proved. */
export function parseSellerSpendTable(
    header: string[],
    rows: string[][],
    slashOrder: SlashOrder | null,
    builtAt: string | null = null
): SellerParseResult {
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
                slashOrder,
                unallocatedInr: 0,
                unmappedSources: [],
                unknownMicromarkets: [],
                builtAt,
            },
        }
    }

    const col = (row: string[], key: string) => (row[idx.get(key)!] ?? '').trim()
    const agg = new Map<string, SellerSpendFact>()
    const unmapped = new Set<string>()
    const unknownMm = new Set<string>()
    let droppedBadDate = 0
    let droppedBadSpend = 0
    let unallocatedInr = 0
    let kept = 0

    for (const row of rows) {
        const date = parseSheetDate(col(row, 'date'), slashOrder)
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
        // mapSellerChannel returns null only for an EXCLUDED source (Channel Partner /
        // Society Partners), which shouldn't appear on this tab. Keep any such row visible
        // under Unmapped rather than dropping the money.
        const channel = mapSellerChannel(rawSource) ?? 'Unmapped'
        if (channel === 'Unmapped' && rawSource) unmapped.add(rawSource)

        const rawMm = col(row, 'utm micromarket')
        const resolved = resolveSellerMicromarket(rawMm)
        const micromarket = resolved.micromarket
        if (!micromarket) {
            unallocatedInr += spend
            // Anything not in the known "means unallocated" set is a data-entry problem worth
            // naming — a cluster typed into the micromarket column (`Habibi`), or a new
            // micromarket nobody told the dashboard about. Either way the growth team should
            // see it rather than have the money quietly absorbed.
            if (resolved.unknown) unknownMm.add(rawMm)
        }

        const impressions = idx.has('impressions') ? parseCount(col(row, 'impressions')) : 0
        const clicks = idx.has('clicks') ? parseCount(col(row, 'clicks')) : 0

        const key = `${date}|${channel}|${micromarket ?? ''}|${rawSource.toLowerCase()}`
        const existing = agg.get(key)
        if (existing) {
            // Duplicate keys are SUMMED, never deduped: several ads for one source on one day
            // is the normal shape of this tab, and dropping one understates spend — the
            // direction that flatters every cost-per metric.
            existing.spendInr += spend
            existing.impressions += impressions
            existing.clicks += clicks
        } else {
            agg.set(key, {
                date,
                channel,
                micromarket,
                rawSource: rawSource.toLowerCase(),
                spendInr: spend,
                impressions,
                clicks,
            })
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
            slashOrder,
            unallocatedInr,
            unmappedSources: [...unmapped].slice(0, 20),
            unknownMicromarkets: [...unknownMm].slice(0, 20),
            builtAt,
        },
    }
}

export const EMPTY_SELLER_SPEND_INGEST: SellerSpendIngest = {
    status: 'unavailable',
    error: 'No seller spend snapshot loaded',
    rowsRead: 0,
    rowsKept: 0,
    droppedBadDate: 0,
    droppedBadSpend: 0,
    slashOrder: null,
    unallocatedInr: 0,
    unmappedSources: [],
    unknownMicromarkets: [],
    origin: 'snapshot',
    builtAt: null,
}
