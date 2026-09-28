import type { SellerSpendFact, SellerSpendIngest } from '../facts'
import { mapSellerChannel } from '../shared'
import { fetchMetaCampaignSpend, metaDirectConfigured, metaDirectEnabled } from '@/lib/shared/metaAds'

export { metaDirectConfigured, metaDirectEnabled }

export interface MetaSellerSpendOverlay {
    facts: SellerSpendFact[]
    ingest: SellerSpendIngest
}

/** Mirrors lib/buyer/spend/meta.ts's isBuyerCampaign — same classification, same reasoning
 *  (a campaign naming neither or both is excluded from both dashboards, not guessed). */
function isSellerCampaign(name: string): boolean {
    const n = name.toLowerCase()
    return n.includes('seller') && !n.includes('buyer')
}

function unavailable(error: string): MetaSellerSpendOverlay {
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

/** Live Meta spend for [from, to], classified to Seller campaigns only. See
 *  lib/buyer/spend/meta.ts's doc comment for the full rationale (shared with the buyer side):
 *  channel-level only, no micromarket split, every row lands in the unallocated bucket. */
export async function fetchMetaSellerSpend(from: string, to: string): Promise<MetaSellerSpendOverlay> {
    const result = await fetchMetaCampaignSpend(from, to)
    if ('error' in result) return unavailable(result.error)

    const channel = mapSellerChannel('meta') ?? 'Unmapped'
    const byDate = new Map<string, SellerSpendFact>()
    let excludedRows = 0
    let excludedInr = 0

    for (const row of result.rows) {
        if (!isSellerCampaign(row.campaignName)) {
            excludedRows++
            excludedInr += row.spendInr
            continue
        }
        // SellerSpendFact keys on a full IST-midnight instant, not a bare date — see its own
        // doc comment; lib/seller/costs.ts parses it with `new Date(iso)`.
        const iso = `${row.date}T00:00:00+05:30`
        const existing = byDate.get(iso)
        if (existing) {
            existing.spendInr += row.spendInr
            existing.impressions += row.impressions
            existing.clicks += row.clicks
        } else {
            byDate.set(iso, {
                date: iso,
                channel,
                micromarket: null,
                rawSource: 'meta',
                spendInr: row.spendInr,
                impressions: row.impressions,
                clicks: row.clicks,
            })
        }
    }

    return {
        facts: [...byDate.values()],
        ingest: {
            status: 'ok',
            error:
                excludedRows > 0
                    ? `${excludedRows} live Meta campaign-day row(s) (₹${Math.round(excludedInr).toLocaleString('en-IN')}) had no clear Buyer/Seller tag in the campaign name and were excluded from both dashboards`
                    : null,
            rowsRead: result.rows.length,
            rowsKept: result.rows.length - excludedRows,
            droppedBadDate: 0,
            droppedBadSpend: 0,
            slashOrder: null,
            unallocatedInr: 0,
            unmappedSources: [],
            unknownMicromarkets: [],
            origin: 'ledger',
            builtAt: new Date().toISOString(),
        },
    }
}
