import type { SpendFact, SpendIngest } from '../facts'
import { fetchLedgerSpend, ledgerConfigured } from './ledger'
import snapshot from './spend-jas26.json'

// Where buyer spend comes from.
//
// Two things have to be true for the ledger to be read: `GROWTH_LEDGER_ENABLED` is not switched
// off, and `GROWTH_LEDGER_BASE_URL` + `GROWTH_LEDGER_API_KEY` are both set. Either one missing
// serves the committed snapshot instead. The flag defaults to on, so the only way to reach the
// snapshot in a configured environment is to ask for it — see `ledgerEnabled()`.
//
// The growth activity ledger, when it is configured — one row per activity with its cost,
// written by the daily platform pulls and by the growth team logging offline and 3P cost in
// Growth Activities. That makes the ledger the only source of growth spend, which is the
// whole point of TECH-1227: two pipelines reading the same platforms will diverge, and every
// divergence costs a reconciliation nobody has time for.
//
// The committed snapshot otherwise — the growth team's ~95K-row sheet summed to
// (day × channel × micromarket × source) by scripts/build-spend.ts. Kept as the fallback
// rather than deleted, because it is the only source of pre-ledger history and because an
// unconfigured environment should still render.
//
// The boundary was always here for this swap; both paths return the same { facts, ingest }
// shape, and nothing downstream of loadSpend() changed.

export interface SpendSnapshot {
    facts: SpendFact[]
    ingest: SpendIngest
}

function fromSnapshot(): SpendSnapshot {
    // Through `unknown`: the committed JSON predates `origin`, which fromSnapshot stamps below.
    const snap = snapshot as unknown as SpendSnapshot
    if (!snap || !Array.isArray(snap.facts)) {
        return {
            facts: [],
            ingest: {
                status: 'unavailable',
                error: 'Spend snapshot missing or malformed',
                rowsRead: 0,
                rowsKept: 0,
                droppedBadDate: 0,
                droppedBadSpend: 0,
                unmappedSources: [],
                unknownMicromarkets: [],
                origin: 'snapshot',
                builtAt: null,
            },
        }
    }
    // Stamped on read rather than trusted from the file: the committed snapshots predate this
    // field, so a JSON without it would leave `origin` undefined while the type promises a value.
    return { ...snap, ingest: { ...snap.ingest, origin: 'snapshot' } }
}

/**
 * Buyer spend for the facts window.
 *
 * Async now, because the ledger is a network read. `fetchBuyerFacts` already awaited
 * everything else it assembles, so this changed one line at the call site.
 *
 * A ledger ERROR does not fall back to the snapshot. Once the ledger is configured it is the
 * source of truth, and quietly serving stale numbers from a committed file is precisely the
 * divergence this endpoint exists to remove — someone would read a chart, see plausible
 * spend, and never learn the pull had been failing for a week. The error rides in the ingest
 * block and the dashboard shows a gap, which is the honest answer.
 */
export async function loadSpend(windowStart: string, windowEnd: string): Promise<SpendSnapshot> {
    if (!ledgerConfigured()) return fromSnapshot()
    return fetchLedgerSpend(windowStart, windowEnd)
}
