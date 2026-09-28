import { parseCsv } from '@/lib/spend/sheet'
import type { SpendIngest } from '../facts'
import { parseAdPlatformSpendTable } from './parse'
import type { SpendSnapshot } from './source'

// Live buyer spend, read straight from the growth team's "Spends" Google Sheet on every call —
// no committed snapshot, no growth ledger. The sheet is shared "anyone with the link can view",
// so this needs no credential: the CSV export endpoint is public.
//
// Full replacement for the old day x channel x micromarket x source workbook, per the growth
// team (2026-09-28) — this is now the one source of buyer spend truth, not a second pipeline
// alongside the snapshot.

const TIMEOUT_MS = 20_000

function config(): { sheetId: string; gid: string } | null {
    const sheetId = process.env.SPEND_SHEET_ID
    const gid = process.env.BUYER_SPEND_SHEET_GID
    // No default gid: the sheet was restructured into separate tabs on 2026-09-29 and gid 0
    // no longer holds buyer data, so guessing a tab here risks silently reading the wrong one.
    if (!sheetId || !gid) return null
    return { sheetId, gid }
}

export function liveSheetConfigured(): boolean {
    return config() !== null
}

function unavailable(error: string): SpendSnapshot {
    const ingest: SpendIngest = {
        status: 'unavailable',
        error,
        rowsRead: 0,
        rowsKept: 0,
        droppedBadDate: 0,
        droppedBadSpend: 0,
        unmappedSources: [],
        unknownMicromarkets: [],
        origin: 'sheet-live',
        builtAt: null,
    }
    return { facts: [], ingest }
}

/** Buyer spend for the facts window, pulled live. `builtAt` is set to the pull time (not a
 *  build time — there is nothing to build), so the footer reads "pulled just now" rather than
 *  a stale-looking snapshot date. */
export async function fetchLiveSheetSpend(windowStart: string, windowEnd: string): Promise<SpendSnapshot> {
    const cfg = config()
    if (!cfg) return unavailable('Spend sheet is not configured (SPEND_SHEET_ID)')

    const url = `https://docs.google.com/spreadsheets/d/${cfg.sheetId}/export?format=csv&gid=${cfg.gid}`
    let text: string
    try {
        const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), cache: 'no-store' })
        if (!res.ok) return unavailable(`Spend sheet responded ${res.status} — check it is still shared "anyone with the link"`)
        text = await res.text()
    } catch (error) {
        return unavailable(error instanceof Error ? error.message : 'Spend sheet unreachable')
    }

    const rows = parseCsv(text)
    if (rows.length < 2) return unavailable('Spend sheet has no data rows')

    const builtAt = new Date().toISOString()
    const { facts, report } = parseAdPlatformSpendTable(rows[0]!, rows.slice(1), builtAt, windowStart, windowEnd)
    return { facts, ingest: report }
}
