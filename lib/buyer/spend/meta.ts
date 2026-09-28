import type { SpendFact, SpendIngest } from '../facts'
import { mapChannel } from '../shared'
import { fetchMetaCampaignSpend, metaDirectConfigured, metaDirectEnabled } from '@/lib/shared/metaAds'

export { metaDirectConfigured, metaDirectEnabled }

export interface MetaSpendOverlay {
    facts: SpendFact[]
    ingest: SpendIngest
}

/** Every campaign this classifies neither Buyer nor Seller (or both, ambiguously) is excluded
 *  from both dashboards' totals rather than guessed into one — see metaAds.ts's own doc
 *  comment. Matched on the campaign NAME, case-insensitively; verified live 2026-09-28 against
 *  Truva's real campaign list, where the overwhelming majority say one or the other
 *  explicitly (`Meta_TOF_Lead_Buyer_...`, `Meta_Leads_Seller_...`). Brand/traffic campaigns
 *  with neither word (`Brand_InstaFollower_Traffic_Campaign`, `Meta_WebTraffic_BrandAd_...`,
 *  "New Leads Campaign", "Truva - Lead Gen") are real spend, just not attributable to one
 *  dashboard from the name alone — reported in the ingest note, not silently dropped. */
function isBuyerCampaign(name: string): boolean {
    const n = name.toLowerCase()
    return n.includes('buyer') && !n.includes('seller')
}

function unavailable(error: string): MetaSpendOverlay {
    return {
        facts: [],
        ingest: {
            status: 'unavailable',
            error,
            rowsRead: 0,
            rowsKept: 0,
            droppedBadDate: 0,
            droppedBadSpend: 0,
            unmappedSources: [],
            unknownMicromarkets: [],
            origin: 'ledger',
            builtAt: null,
        },
    }
}

/** Live Meta spend for [from, to] (same bare YYYY-MM-DD, both-inclusive window every other
 *  spend source here uses), classified to Buyer campaigns only, in this dashboard's own
 *  channel taxonomy — NOT split by micromarket (see metaAds.ts's doc comment for why). One
 *  SpendFact per date (rawSource 'meta', micromarket null), summed across every campaign and
 *  every configured ad account. Merged into the ledger/snapshot read by source.ts's
 *  loadSpend(), which replaces just the existing 'meta'-sourced rows with these fresher ones. */
export async function fetchMetaSpend(from: string, to: string): Promise<MetaSpendOverlay> {
    const result = await fetchMetaCampaignSpend(from, to)
    if ('error' in result) return unavailable(result.error)

    const channel = mapChannel('meta') ?? 'Unmapped'
    const byDate = new Map<string, SpendFact>()
    let excludedRows = 0
    let excludedInr = 0

    for (const row of result.rows) {
        if (!isBuyerCampaign(row.campaignName)) {
            excludedRows++
            excludedInr += row.spendInr
            continue
        }
        const existing = byDate.get(row.date)
        if (existing) {
            existing.spendInr += row.spendInr
            existing.impressions += row.impressions
            existing.clicks += row.clicks
        } else {
            byDate.set(row.date, {
                date: row.date,
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
            unmappedSources: [],
            unknownMicromarkets: [],
            origin: 'ledger',
            builtAt: new Date().toISOString(),
        },
    }
}
