import type { SellerSpendFact, SellerSpendIngest } from '../facts'
import { mapSellerChannel } from '../shared'
import { fetchLedgerRaw } from '@/lib/buyer/spend/ledger'
import { resolveSellerMicromarket } from './parse'

// Seller spend read from the growth activity ledger.
//
// The mapping deliberately reuses `mapSellerChannel` and `resolveSellerMicromarket` — the exact
// functions the sheet parser uses — so that switching source cannot itself move a number. That
// is the same reason scripts/reconcile-spend.ts imports them: a comparison that applied two
// different taxonomies would report a difference it had created itself.
//
// `fetchLedgerRaw` is imported from the buyer module because the transport is not buyer-specific
// (it takes `purpose`), and duplicating the config/timeout/error handling here would mean two
// places to fix when the ledger's contract moves. It belongs in lib/spend/ eventually; it is
// left where it is so that wiring the seller tab up changes nothing on the buyer path.

const IS_DAY = /^\d{4}-\d{2}-\d{2}$/

/** The seller fact table keys on a full IST-midnight instant, not a YYYY-MM-DD key, because
 *  lib/seller/costs.ts parses it with `new Date(iso)`. The ledger speaks bare days, so a bare
 *  day would be read as UTC and land 5.5 hours early — which moves a midnight-adjacent activity
 *  into the previous day, and with it into the previous week's cost-per metric. */
const istInstant = (day: string) => `${day}T00:00:00+05:30`

function unavailable(error: string): { facts: SellerSpendFact[]; ingest: SellerSpendIngest } {
    return {
        facts: [],
        ingest: {
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
            origin: 'ledger',
            builtAt: null,
        },
    }
}

export async function fetchSellerLedgerSpend(
    from: string,
    to: string
): Promise<{ facts: SellerSpendFact[]; ingest: SellerSpendIngest }> {
    const raw = await fetchLedgerRaw(from, to, 'SELLER')
    if ('error' in raw) return unavailable(raw.error)
    const payload = raw.payload

    const agg = new Map<string, SellerSpendFact>()
    const unmapped = new Set<string>()
    const unknownMm = new Set<string>()
    let droppedBadDate = 0
    let kept = 0
    let unallocatedInr = 0

    for (const row of payload.facts) {
        if (!IS_DAY.test(row.date ?? '')) {
            droppedBadDate++
            continue
        }

        // A source outside the seller DRR scope maps to null. That is money that was still
        // spent, so it is kept under Unmapped and named, never dropped — dropping it
        // understates spend, which is the direction that flatters every cost-per metric.
        const rawSource = (row.source ?? '').trim()
        const channel = mapSellerChannel(rawSource) ?? 'Unmapped'
        if (channel === 'Unmapped' && rawSource) unmapped.add(rawSource)

        const place = resolveSellerMicromarket(row.micromarket)
        if (place.unknown && row.micromarket) unknownMm.add(row.micromarket.trim())
        if (place.micromarket === null) unallocatedInr += row.spendInr

        // Summed on collision, never replaced: two ledger sources can fold onto one channel and
        // one label, and replacing would silently lose one of them.
        const key = `${row.date}|${channel}|${place.micromarket ?? ''}|${rawSource.toLowerCase()}`
        const existing = agg.get(key)
        if (existing) {
            existing.spendInr += row.spendInr
            existing.impressions += row.impressions
            existing.clicks += row.clicks
        } else {
            agg.set(key, {
                date: istInstant(row.date),
                channel,
                micromarket: place.micromarket,
                rawSource: rawSource.toLowerCase(),
                spendInr: row.spendInr,
                impressions: row.impressions,
                clicks: row.clicks,
            })
        }
        kept += row.rows ?? 1
    }

    // `failedSources` is grouped over EVERY ingest run in the requested window, so it means "at
    // least one run for this source failed somewhere in this period" — not "the most recent run
    // failed", and not that anything is missing: a failed run is usually retried and succeeds.
    // Measured 18 Sep 2026: a single failed run on ~15 Sep put both ad sources in this list for
    // every window containing that day, while 17-18 Sep alone returned []. Ad spend had landed
    // on all of those days. Wording it as a live outage turned a recovered blip into a standing
    // alarm, which is the state a signal stops being read in.
    const failed = payload.ingest?.failedSources ?? []
    const truncated = payload.ingest?.truncated ?? false
    const notes = [
        failed.length > 0 ? `An ingest run failed for ${failed.join(', ')} during this period` : null,
        truncated ? 'Ledger response was truncated — the range is too wide' : null,
    ].filter((n): n is string => n !== null)

    return {
        facts: [...agg.values()],
        ingest: {
            status: 'ok',
            error: notes.length > 0 ? notes.join('. ') : null,
            rowsRead: payload.ingest?.rowsRead ?? kept,
            rowsKept: kept,
            droppedBadDate,
            droppedBadSpend: 0,
            // No slash dates are involved in a ledger read: the ledger stores real dates, so
            // there is no order to prove. Null says "not applicable", not "unknown".
            slashOrder: null,
            unallocatedInr,
            unmappedSources: [...unmapped].slice(0, 20),
            unknownMicromarkets: [...unknownMm].slice(0, 20),
            // When the ledger last pulled, not when this page rendered.
            origin: 'ledger',
            builtAt: payload.ingest?.lastRunAt ?? null,
        },
    }
}
