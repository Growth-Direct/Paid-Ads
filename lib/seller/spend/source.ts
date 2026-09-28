import type { SellerSpendFact, SellerSpendIngest } from '../facts'
import { ledgerConfigured } from '@/lib/buyer/spend/ledger'
import { fetchSellerLedgerSpend } from './ledger'
import { fetchSellerLiveSheetSpend, sellerLiveSheetConfigured } from './liveSheet'
import { fetchMetaSellerSpend, metaDirectConfigured } from './meta'
import { EMPTY_SELLER_SPEND_INGEST } from './parse'
import snapshot from './spend-jas26.json'

// Where seller spend comes from — the same two-source boundary the buyer tab has, behind the
// same environment gate.
//
// The growth activity ledger, when it is configured: `GROWTH_LEDGER_ENABLED` is not switched
// off AND `GROWTH_LEDGER_BASE_URL` + `GROWTH_LEDGER_API_KEY` are both set. One flag governs
// both tabs on purpose — a deployment where buyer reads the ledger and seller reads a committed
// file is the divergence the ledger exists to remove, and it is invisible from the UI.
//
// The committed snapshot otherwise — the "Seller side spends" tab exported to CSV and built by
// scripts/build-seller-spend.ts. Kept rather than deleted, because it is the only source of
// pre-ledger history and because an unconfigured environment should still render.
//
// As with buyer, a ledger ERROR does not fall back to the snapshot. Once the ledger is
// configured it is the source of truth, and quietly serving stale numbers from a committed file
// is exactly the divergence this is meant to remove — a failed read surfaces as a visible gap.

export interface SellerSpendSnapshot {
    facts: SellerSpendFact[]
    ingest: SellerSpendIngest
}

export async function loadSellerSpend(windowStart: string, windowEnd: string): Promise<SellerSpendSnapshot> {
    const base = sellerLiveSheetConfigured()
        ? await fetchSellerLiveSheetSpend(windowStart, windowEnd)
        : ledgerConfigured()
          ? await fetchSellerLedgerSpend(windowStart, windowEnd)
          : fromSnapshot()
    if (!metaDirectConfigured()) return base
    return overlayMetaSpend(base, await fetchMetaSellerSpend(windowStart, windowEnd))
}

/** Mirrors lib/buyer/spend/source.ts's overlayMetaSpend exactly — see its own doc comment. */
export function overlayMetaSpend(base: SellerSpendSnapshot, meta: Awaited<ReturnType<typeof fetchMetaSellerSpend>>): SellerSpendSnapshot {
    if (meta.ingest.status !== 'ok') {
        const note = `Live Meta pull failed: ${meta.ingest.error ?? 'unknown error'} — showing ${base.ingest.origin}'s own Meta figures instead`
        return { ...base, ingest: { ...base.ingest, error: [base.ingest.error, note].filter(Boolean).join('. ') } }
    }
    const nonMeta = base.facts.filter((f) => f.rawSource !== 'meta')
    const notes = [base.ingest.error, meta.ingest.error].filter((n): n is string => !!n)
    return {
        facts: [...nonMeta, ...meta.facts],
        ingest: {
            ...base.ingest,
            error: notes.length > 0 ? notes.join('. ') : null,
            metaLiveAsOf: meta.ingest.builtAt,
        },
    }
}

function fromSnapshot(): SellerSpendSnapshot {
    // Through `unknown`: the committed JSON predates `origin`, which fromSnapshot stamps below.
    const snap = snapshot as unknown as SellerSpendSnapshot
    // Defensive: a truncated or hand-edited JSON must degrade to "no spend", which renders as
    // dashes everywhere, rather than throwing and taking the whole seller tab down.
    if (!snap || !Array.isArray(snap.facts)) {
        return {
            facts: [],
            ingest: { ...EMPTY_SELLER_SPEND_INGEST, error: 'Seller spend snapshot missing or malformed' },
        }
    }
    // Stamped on read rather than trusted from the file, for the reason the buyer path is: the
    // committed snapshot predates this field.
    return { ...snap, ingest: { ...snap.ingest, origin: 'snapshot' } }
}
