import { parseCsv } from '@/lib/spend/sheet'
import type { SellerSpendIngest } from '../facts'
import { parseSellerAdPlatformSpendTable } from './parse'
import type { SellerSpendSnapshot } from './source'

// Live seller spend, read straight from the growth team's "Spends" Google Sheet's Seller tab —
// the seller-side sibling of lib/buyer/spend/liveSheet.ts. Same public-CSV, no-credential read;
// see that file's doc comment for the shape this replaces.

const TIMEOUT_MS = 20_000

function config(): { sheetId: string; gid: string } | null {
    const sheetId = process.env.SPEND_SHEET_ID
    const gid = process.env.SELLER_SPEND_SHEET_GID
    if (!sheetId || !gid) return null
    return { sheetId, gid }
}

export function sellerLiveSheetConfigured(): boolean {
    return config() !== null
}

function unavailable(error: string): SellerSpendSnapshot {
    const ingest: SellerSpendIngest = {
        status: 'unavailable',
        error,
        rowsRead: 0,
        rowsKept: 0,
        droppedBadDate: 0,
        droppedBadSpend: 0,
        slashOrder: null,
        unallocatedInr: 0,
        unmappedSources: [],
        unknownMicromarkets: [],
        origin: 'sheet-live',
        builtAt: null,
    }
    return { facts: [], ingest }
}

/** Seller spend for the facts window, pulled live. `builtAt` is the pull time, so the footer
 *  reads "pulled just now" rather than a stale-looking snapshot date. */
export async function fetchSellerLiveSheetSpend(windowStart: string, windowEnd: string): Promise<SellerSpendSnapshot> {
    const cfg = config()
    if (!cfg) return unavailable('Spend sheet is not configured (SPEND_SHEET_ID / SELLER_SPEND_SHEET_GID)')

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
    const { facts, report } = parseSellerAdPlatformSpendTable(rows[0]!, rows.slice(1), builtAt, windowStart, windowEnd)
    return { facts, ingest: report }
}
