import { fetchMetaCampaignSpend, metaDirectConfigured, metaDirectEnabled } from '@/lib/shared/metaAds'
import { fetchMetaSpend } from '@/lib/buyer/spend/meta'
import { overlayMetaSpend as overlayBuyerMetaSpend, type SpendSnapshot } from '@/lib/buyer/spend/source'
import { fetchMetaSellerSpend } from '@/lib/seller/spend/meta'
import { overlayMetaSpend as overlaySellerMetaSpend, type SellerSpendSnapshot } from '@/lib/seller/spend/source'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Coverage for the live Meta (Graph API) spend overlay added 2026-09-28 — see
// lib/shared/metaAds.ts's own doc comment for the full rationale (channel-level only, no
// micromarket split, Buyer/Seller split by campaign NAME since accounts mix both).

function graphPage(rows: { campaign_name: string; spend: string; date_start: string; impressions?: string; clicks?: string }[], next?: string) {
    return { ok: true, status: 200, json: async () => ({ data: rows, paging: next ? { next } : undefined }) }
}

const EMPTY_BUYER_INGEST = {
    status: 'ok' as const,
    error: null,
    rowsRead: 0,
    rowsKept: 0,
    droppedBadDate: 0,
    droppedBadSpend: 0,
    unmappedSources: [],
    unknownMicromarkets: [],
    origin: 'snapshot' as const,
    builtAt: null,
}
const EMPTY_SELLER_INGEST = {
    ...EMPTY_BUYER_INGEST,
    slashOrder: null as null,
    unallocatedInr: 0,
}

beforeEach(() => {
    vi.unstubAllEnvs()
})
afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
})

describe('metaAds config gating', () => {
    it('is unconfigured with neither env var set', () => {
        expect(metaDirectConfigured()).toBe(false)
    })

    it('is configured once both META_ACCESS_TOKEN and META_AD_ACCOUNT_IDS are set', () => {
        vi.stubEnv('META_ACCESS_TOKEN', 'token123')
        vi.stubEnv('META_AD_ACCOUNT_IDS', '111,222')
        expect(metaDirectConfigured()).toBe(true)
    })

    it('the kill switch only recognises false/0/off/no, leaving a typo ON', () => {
        vi.stubEnv('META_DIRECT_ENABLED', 'false')
        expect(metaDirectEnabled()).toBe(false)
        vi.stubEnv('META_DIRECT_ENABLED', 'nope') // not one of the four spellings
        expect(metaDirectEnabled()).toBe(true)
    })
})

describe('fetchMetaCampaignSpend', () => {
    it('errors out (not throws) when unconfigured', async () => {
        const result = await fetchMetaCampaignSpend('2026-07-01', '2026-07-02')
        expect('error' in result).toBe(true)
    })

    it('fans out across every configured account, sequentially, and follows pagination', async () => {
        vi.stubEnv('META_ACCESS_TOKEN', 'token123')
        vi.stubEnv('META_AD_ACCOUNT_IDS', '111,222')
        const fetchMock = vi
            .fn()
            // account 111: two pages
            .mockResolvedValueOnce(graphPage([{ campaign_name: 'Meta_TOF_Lead_Buyer_Powai', spend: '100', date_start: '2026-07-01' }], 'https://graph/next-page'))
            .mockResolvedValueOnce(graphPage([{ campaign_name: 'Meta_TOF_Lead_Buyer_Powai', spend: '50', date_start: '2026-07-02' }]))
            // account 222: one page
            .mockResolvedValueOnce(graphPage([{ campaign_name: 'Meta_Leads_Seller_AllMM', spend: '75', date_start: '2026-07-01' }]))
        vi.stubGlobal('fetch', fetchMock)

        const result = await fetchMetaCampaignSpend('2026-07-01', '2026-07-02')
        if ('error' in result) throw new Error(result.error)
        expect(result.rows).toHaveLength(3)
        expect(fetchMock).toHaveBeenCalledTimes(3)
        expect(result.rows.filter((r) => r.accountId === '111')).toHaveLength(2)
        expect(result.rows.filter((r) => r.accountId === '222')).toHaveLength(1)
    })

    it('returns an error, not a throw, when the Graph API responds non-ok', async () => {
        vi.stubEnv('META_ACCESS_TOKEN', 'token123')
        vi.stubEnv('META_AD_ACCOUNT_IDS', '111')
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => 'Invalid OAuth access token' })
        )
        const result = await fetchMetaCampaignSpend('2026-07-01', '2026-07-02')
        expect('error' in result).toBe(true)
        if ('error' in result) expect(result.error).toContain('401')
    })
})

describe('lib/buyer/spend/meta.ts — fetchMetaSpend (Buyer-only classification)', () => {
    beforeEach(() => {
        vi.stubEnv('META_ACCESS_TOKEN', 'token123')
        vi.stubEnv('META_AD_ACCOUNT_IDS', '111')
    })

    it('keeps Buyer campaigns, excludes Seller and unclassified ones, and reports the exclusion', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue(
                graphPage([
                    { campaign_name: 'Meta_TOF_Lead_Buyer_Powai_Catalog', spend: '1000', date_start: '2026-07-01' },
                    { campaign_name: 'Meta_TOF_Lead_Buyer_Vegas_Catalog', spend: '500', date_start: '2026-07-01' },
                    { campaign_name: 'Meta_Leads_Seller_AllMM_LP', spend: '2000', date_start: '2026-07-01' },
                    { campaign_name: 'Brand_InstaFollower_Traffic_Campaign', spend: '300', date_start: '2026-07-01' },
                ])
            )
        )
        const result = await fetchMetaSpend('2026-07-01', '2026-07-01')
        expect(result.ingest.status).toBe('ok')
        expect(result.facts).toHaveLength(1) // one date, both Buyer campaigns summed
        expect(result.facts[0]).toMatchObject({ date: '2026-07-01', channel: 'Paid Ads', micromarket: null, rawSource: 'meta', spendInr: 1500 })
        expect(result.ingest.error).toContain('2 live Meta campaign-day row')
        expect(result.ingest.error).toContain('2,300') // 2000 + 300 excluded
    })

    it('degrades to unavailable, not a throw, when the underlying fetch errors', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => '' }))
        const result = await fetchMetaSpend('2026-07-01', '2026-07-01')
        expect(result.ingest.status).toBe('unavailable')
        expect(result.facts).toEqual([])
    })
})

describe('lib/seller/spend/meta.ts — fetchMetaSellerSpend (Seller-only classification)', () => {
    beforeEach(() => {
        vi.stubEnv('META_ACCESS_TOKEN', 'token123')
        vi.stubEnv('META_AD_ACCOUNT_IDS', '111')
    })

    it('keeps Seller campaigns only, and formats the date as a full IST-midnight instant', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue(
                graphPage([
                    { campaign_name: 'Meta_Leads_Seller_AllMM_LP', spend: '2000', date_start: '2026-07-01' },
                    { campaign_name: 'Meta_TOF_Lead_Buyer_Powai_Catalog', spend: '1000', date_start: '2026-07-01' },
                ])
            )
        )
        const result = await fetchMetaSellerSpend('2026-07-01', '2026-07-01')
        expect(result.facts).toHaveLength(1)
        expect(result.facts[0]).toMatchObject({ date: '2026-07-01T00:00:00+05:30', spendInr: 2000, micromarket: null, rawSource: 'meta' })
    })
})

describe('overlayMetaSpend — Buyer', () => {
    const base: SpendSnapshot = {
        facts: [
            { date: '2026-07-01', channel: '3P', micromarket: 'Powai', rawSource: '99acres', spendInr: 500, impressions: 0, clicks: 0 },
            { date: '2026-07-01', channel: 'Paid Ads', micromarket: null, rawSource: 'meta', spendInr: 111, impressions: 0, clicks: 0 }, // stale
        ],
        ingest: { ...EMPTY_BUYER_INGEST, origin: 'ledger' },
    }

    it('replaces only the stale meta row, leaves every other source untouched, and stamps metaLiveAsOf', () => {
        const meta = {
            facts: [{ date: '2026-07-01', channel: 'Paid Ads' as const, micromarket: null, rawSource: 'meta', spendInr: 999, impressions: 0, clicks: 0 }],
            ingest: { ...EMPTY_BUYER_INGEST, builtAt: '2026-09-28T10:00:00Z' },
        }
        const result = overlayBuyerMetaSpend(base, meta)
        expect(result.facts).toHaveLength(2)
        expect(result.facts.find((f) => f.rawSource === '99acres')?.spendInr).toBe(500)
        expect(result.facts.find((f) => f.rawSource === 'meta')?.spendInr).toBe(999)
        expect(result.ingest.metaLiveAsOf).toBe('2026-09-28T10:00:00Z')
    })

    it('falls back to the base\'s own meta rows, unchanged, when the live pull fails', () => {
        const meta = { facts: [], ingest: { ...EMPTY_BUYER_INGEST, status: 'unavailable' as const, error: 'timed out' } }
        const result = overlayBuyerMetaSpend(base, meta)
        expect(result.facts).toEqual(base.facts) // stale meta row (111) survives
        expect(result.ingest.error).toContain('Live Meta pull failed: timed out')
        expect(result.ingest.metaLiveAsOf).toBeUndefined()
    })
})

describe('overlayMetaSpend — Seller', () => {
    it('mirrors the Buyer merge semantics', () => {
        const base: SellerSpendSnapshot = {
            facts: [{ date: '2026-07-01T00:00:00+05:30', channel: 'Offline Branding', micromarket: null, rawSource: 'offline', spendInr: 500, impressions: 0, clicks: 0 }],
            ingest: { ...EMPTY_SELLER_INGEST, origin: 'ledger' },
        }
        const meta = {
            facts: [{ date: '2026-07-01T00:00:00+05:30', channel: 'Paid Ads' as const, micromarket: null, rawSource: 'meta', spendInr: 777, impressions: 0, clicks: 0 }],
            ingest: { ...EMPTY_SELLER_INGEST, builtAt: '2026-09-28T10:00:00Z' },
        }
        const result = overlaySellerMetaSpend(base, meta)
        expect(result.facts).toHaveLength(2)
        expect(result.facts.find((f) => f.rawSource === 'meta')?.spendInr).toBe(777)
        expect(result.ingest.metaLiveAsOf).toBe('2026-09-28T10:00:00Z')
    })
})
