import { describe, expect, it } from 'vitest'
import { mapSellerChannel } from '@/lib/seller/shared'
import { parseSellerAdPlatformSpendTable, sellerMicromarketFromCampaignName } from '@/lib/seller/spend/parse'

describe('sellerMicromarketFromCampaignName', () => {
    it('resolves a campaign naming exactly one micromarket', () => {
        expect(sellerMicromarketFromCampaignName('Meta_Leads_Bangalore_AllMM_Seller_LAL_LP_220926')).toEqual({
            micromarket: null,
            unknown: false,
        })
        expect(sellerMicromarketFromCampaignName('Glasgow_Seller_Lead_Ad_Raj_240925')).toEqual({ micromarket: 'Glasgow', unknown: false })
    })

    it('treats AllMM as the intentional-unallocated marker, not an anomaly', () => {
        // Verified live 2026-09-29: 13 of 15 distinct campaigns on the sheet name AllMM.
        expect(sellerMicromarketFromCampaignName('Meta_Leads_Seller_AllMM_LP_020426')).toEqual({ micromarket: null, unknown: false })
    })

    it('flags a campaign naming no micromarket and no AllMM marker as a real anomaly', () => {
        expect(sellerMicromarketFromCampaignName('Google_GMB_Leads_Seller_LP_220526')).toEqual({ micromarket: null, unknown: true })
    })

    it('applies the same Glassgow/Anthens typo fixes as SELLER_MICROMARKET_FIX', () => {
        expect(sellerMicromarketFromCampaignName('Meta_Seller_Glassgow_LP_010926')).toEqual({ micromarket: 'Glasgow', unknown: false })
        expect(sellerMicromarketFromCampaignName('Meta_Seller_Anthens_LP_010926')).toEqual({ micromarket: 'Athens', unknown: false })
    })
})

describe('mapSellerChannel', () => {
    it('maps the live sheet\'s bare "Google" the same as "Google Ads"', () => {
        expect(mapSellerChannel('Google')).toBe('Paid Ads')
    })
})

const HEADER = ['Date', 'Month', 'Lead Source', 'Campaign name', 'Campaign ID', 'Ad set name', 'Ad set ID', 'Ad name', 'Ad ID', 'Platform', 'Impressions', 'Link clicks', 'Amount spent (INR)']

function row(overrides: Partial<Record<string, string>>): string[] {
    const base: Record<string, string> = {
        Date: '5-Aug-26',
        Month: 'Aug-26',
        'Lead Source': 'Meta',
        'Campaign name': 'Meta_Leads_Seller_AllMM_LP_020426',
        'Campaign ID': '1',
        'Ad set name': 'Aud_Test',
        'Ad set ID': '2',
        'Ad name': 'Ad_Test',
        'Ad ID': '3',
        Platform: 'facebook',
        Impressions: '100',
        'Link clicks': '10',
        'Amount spent (INR)': '500',
    }
    return HEADER.map((h) => overrides[h] ?? base[h] ?? '')
}

describe('parseSellerAdPlatformSpendTable', () => {
    it('hard-errors, naming the column, when a required header is missing', () => {
        const r = parseSellerAdPlatformSpendTable(['Date', 'Lead Source'], [], null)
        expect(r.report.status).toBe('schema-error')
        expect(r.report.error).toContain('campaign name')
    })

    it('stamps origin sheet-live', () => {
        const r = parseSellerAdPlatformSpendTable(HEADER, [row({})], null)
        expect(r.report.origin).toBe('sheet-live')
    })

    it('maps bare Google and Meta through SELLER_CHANNEL_MAP', () => {
        const r = parseSellerAdPlatformSpendTable(HEADER, [row({ 'Lead Source': 'Google' }), row({ 'Lead Source': 'Meta' })], null)
        expect(r.facts.map((f) => f.channel).sort()).toEqual(['Paid Ads', 'Paid Ads'])
    })

    it('puts an AllMM campaign in the unallocated bucket without flagging it', () => {
        const r = parseSellerAdPlatformSpendTable(HEADER, [row({ 'Campaign name': 'Meta_Leads_Seller_AllMM_LP_020426', 'Amount spent (INR)': '500' })], null)
        expect(r.facts[0]!.micromarket).toBeNull()
        expect(r.report.unallocatedInr).toBe(500)
        expect(r.report.unknownMicromarkets).toHaveLength(0)
    })

    it('flags a genuinely unattributable campaign and still counts its spend as unallocated', () => {
        const r = parseSellerAdPlatformSpendTable(HEADER, [row({ 'Campaign name': 'Google_GMB_Leads_Seller_LP_220526', 'Amount spent (INR)': '300' })], null)
        expect(r.facts[0]!.micromarket).toBeNull()
        expect(r.report.unallocatedInr).toBe(300)
        expect(r.report.unknownMicromarkets).toContain('Google_GMB_Leads_Seller_LP_220526')
    })

    it('resolves a real micromarket and does not add it to unallocated', () => {
        const r = parseSellerAdPlatformSpendTable(HEADER, [row({ 'Campaign name': 'Glasgow_Seller_Lead_Ad_Raj_240925', 'Amount spent (INR)': '200' })], null)
        expect(r.facts[0]!.micromarket).toBe('Glasgow')
        expect(r.report.unallocatedInr).toBe(0)
    })

    it('sums duplicate (date, channel, micromarket, source) rows rather than deduping', () => {
        const rows = [row({ 'Amount spent (INR)': '100', Impressions: '10', 'Link clicks': '1' }), row({ 'Amount spent (INR)': '50', Impressions: '5', 'Link clicks': '0' })]
        const r = parseSellerAdPlatformSpendTable(HEADER, rows, null)
        expect(r.facts).toHaveLength(1)
        expect(r.facts[0]!.spendInr).toBe(150)
    })

    it('filters rows to the given window', () => {
        const rows = [row({ Date: '1-Jul-26' }), row({ Date: '15-Aug-26' }), row({ Date: '1-Oct-26' })]
        const r = parseSellerAdPlatformSpendTable(HEADER, rows, null, '2026-08-01T00:00:00+05:30', '2026-09-01T00:00:00+05:30')
        expect(r.facts).toHaveLength(1)
        expect(r.facts[0]!.date).toBe('2026-08-15T00:00:00+05:30')
    })
})
