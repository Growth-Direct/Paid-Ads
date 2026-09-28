// Live Meta (Facebook/Instagram) ad spend, pulled directly from the Graph API's Marketing
// Insights endpoint — added 2026-09-28, per an explicit growth-team request to make the
// Spend/CPL/CPQL/CPV figures reflect today's actual Meta cost rather than whatever the growth
// activity ledger's own (currently stalled) platform-pull last landed.
//
// Shared between lib/buyer/spend/meta.ts and lib/seller/spend/meta.ts — the low-level Graph
// API mechanics (auth, pagination, per-account fan-out) are identical for both; only the
// Buyer/Seller campaign classification and the eventual SpendFact/SellerSpendFact shape
// differ, and that split lives in each side's own meta.ts.
//
// **Scope, confirmed with the growth team 2026-09-28:**
//  - Channel-level only. This does NOT attempt to parse a campaign's micromarket from its
//    name — real campaign names are inconsistent for that (`Retargeting_SpecificMM`,
//    `PanMumbai`, `Habibi_SpecificArea` naming a whole CLUSTER not one micromarket, and a long
//    tail of pre-2026 campaigns named after the property being sold, not a market at all).
//    Guessing there would put a fabricated number in front of leadership. Every live-Meta
//    SpendFact/SellerSpendFact row therefore carries `micromarket: null` (the same
//    "unallocated" bucket the ledger/sheet already use for spend with no place attached) —
//    by-micromarket Spend keeps reading from the ledger/snapshot until a real per-campaign
//    micromarket convention is agreed.
//  - Seven ad accounts, all under Truva's own Meta Business (id 394939327028996), confirmed
//    live via the ads_get_ad_accounts/ads_get_ad_entities tools during that same
//    conversation — NOT "Truva - Loans" (a different product line), and NOT any account
//    belonging to a different business (RubyX Estate, Beyond Realty, Sakura, "Dilip Mehta" —
//    all real advertisers sharing the same ad-tech setup, none of them Truva).
//  - The main "Truva" account mixes Buyer and Seller campaigns together (verified live: e.g.
//    `Meta_TOF_Lead_Buyer_Vegas_...` and `Meta_Leads_Bangalore_AllMM_Seller_...` both showed up
//    in the same account's campaign list), so this module fetches at CAMPAIGN level, not
//    account level, and each side's meta.ts classifies every campaign by name
//    (`classifyMetaCampaignPurpose`-style keyword match) — account identity alone cannot tell
//    Buyer spend from Seller spend.

const GRAPH_VERSION = 'v21.0'
const PAGE_LIMIT = 500
const MAX_PAGES_PER_ACCOUNT = 40 // ~20k campaign-day rows/account — a generous ceiling, not a real cap in practice

export interface MetaCampaignDayRow {
    accountId: string
    campaignName: string
    /** YYYY-MM-DD, IST — Meta's own `date_start` for a daily-incremented insights row. */
    date: string
    spendInr: number
    impressions: number
    clicks: number
}

/** Read at call time, not module load — a missing var must degrade this one block, not throw
 *  during import and take the whole page down. Mirrors lib/buyer/spend/ledger.ts's config(). */
function config(): { accessToken: string; accountIds: string[] } | null {
    const accessToken = process.env.META_ACCESS_TOKEN
    const accountIds = (process.env.META_AD_ACCOUNT_IDS ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    if (!accessToken || accountIds.length === 0) return null
    return { accessToken, accountIds }
}

/** Kill switch, same spelling/default convention as GROWTH_LEDGER_ENABLED: only these four
 *  values turn it off, an unrecognised value leaves it on so a typo can't silently change
 *  where money comes from. Default ON once configured. */
const OFF = new Set(['false', '0', 'off', 'no'])

export function metaDirectEnabled(): boolean {
    const flag = process.env.META_DIRECT_ENABLED?.trim().toLowerCase()
    return !(flag && OFF.has(flag))
}

export function metaDirectConfigured(): boolean {
    return metaDirectEnabled() && config() !== null
}

interface GraphInsightsRow {
    campaign_name?: string
    spend?: string
    impressions?: string
    clicks?: string
    date_start?: string
}
interface GraphInsightsPage {
    data: GraphInsightsRow[]
    paging?: { next?: string }
}

async function fetchAccountCampaignSpend(
    accountId: string,
    accessToken: string,
    from: string,
    to: string
): Promise<MetaCampaignDayRow[]> {
    const rows: MetaCampaignDayRow[] = []
    let url =
        `https://graph.facebook.com/${GRAPH_VERSION}/act_${accountId}/insights` +
        `?level=campaign&time_increment=1&fields=campaign_name,spend,impressions,clicks,date_start` +
        `&time_range=${encodeURIComponent(JSON.stringify({ since: from, until: to }))}` +
        `&limit=${PAGE_LIMIT}&access_token=${encodeURIComponent(accessToken)}`

    for (let page = 0; page < MAX_PAGES_PER_ACCOUNT; page++) {
        // Bounded per page, same 15s ceiling lib/buyer/spend/ledger.ts uses — a hung Graph API
        // call must not hold the whole facts build open.
        const res = await fetch(url, { signal: AbortSignal.timeout(15_000), cache: 'no-store' })
        if (!res.ok) {
            const body = await res.text().catch(() => '')
            throw new Error(`Meta Graph API responded ${res.status} for act_${accountId}: ${body.slice(0, 200)}`)
        }
        const payload = (await res.json()) as GraphInsightsPage
        if (!Array.isArray(payload?.data)) throw new Error(`Meta Graph API returned an unexpected shape for act_${accountId}`)

        for (const row of payload.data) {
            if (!row.date_start || !row.campaign_name) continue
            rows.push({
                accountId,
                campaignName: row.campaign_name,
                date: row.date_start,
                spendInr: Number(row.spend ?? 0),
                impressions: Number(row.impressions ?? 0),
                clicks: Number(row.clicks ?? 0),
            })
        }

        if (!payload.paging?.next) break
        url = payload.paging.next
    }

    return rows
}

/** Every campaign-day spend row across every configured ad account, for the window
 *  [from, to] inclusive (Meta's own time_range convention) — undifferentiated by Buyer/Seller
 *  purpose or micromarket; each side's meta.ts applies its own classification on top. Returns
 *  a discriminated result rather than throwing, same convention as fetchLedgerRaw: every
 *  caller here turns a failure into a visible gap in the spend block, never an exception that
 *  takes the whole page down.
 *
 *  Accounts are fetched SEQUENTIALLY, not via Promise.all — mirrors this repo's own
 *  COQL-concurrency finding (lib/buyer/aggregate.ts's comment on why Zoho calls are
 *  sequential): no evidence yet that Meta's API has the same issue, but there is also no
 *  latency budget here that concurrency would meaningfully help, and sequential keeps one
 *  slow/failing account from being indistinguishable from a systemic outage. */
export async function fetchMetaCampaignSpend(from: string, to: string): Promise<{ rows: MetaCampaignDayRow[] } | { error: string }> {
    const cfg = config()
    if (!cfg) return { error: 'Meta direct pull is not configured (META_ACCESS_TOKEN / META_AD_ACCOUNT_IDS)' }

    const rows: MetaCampaignDayRow[] = []
    try {
        for (const accountId of cfg.accountIds) {
            const accountRows = await fetchAccountCampaignSpend(accountId, cfg.accessToken, from, to)
            rows.push(...accountRows)
        }
        return { rows }
    } catch (error) {
        return { error: error instanceof Error ? error.message : 'Meta Graph API unreachable' }
    }
}
