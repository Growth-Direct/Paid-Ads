import { micromarketFromCampaignName, parseAdPlatformSpendTable } from '@/lib/buyer/spend/parse'
import { describe, expect, it } from 'vitest'

describe('micromarketFromCampaignName', () => {
    it('resolves a campaign naming exactly one micromarket', () => {
        expect(micromarketFromCampaignName('Meta_TOF_Lead_Buyer_Glasgow_SpecificBudget_Above4Cr_290725')).toBe('Glasgow')
    })

    it('resolves a two-word micromarket name', () => {
        expect(micromarketFromCampaignName('Meta_TOF_Lead_Buyer_HongKong_SpecificArea_010926')).toBe('Hong Kong')
    })

    it('applies the same Ibizi/Glassgow typo fixes as MICROMARKET_FIX', () => {
        expect(micromarketFromCampaignName('Meta_TOF_Lead_Buyer_Ibizi_SpecificArea_010926')).toBe('Ibiza')
        expect(micromarketFromCampaignName('Meta_TOF_Lead_Buyer_Glassgow_SpecificArea_010926')).toBe('Glasgow')
    })

    it('returns null for a cluster-level campaign naming no specific micromarket', () => {
        // BABU is a cluster of Boston/Barcelona/Singapore, not a micromarket — splitting its
        // spend across the three would be inventing an allocation rule.
        expect(micromarketFromCampaignName('Meta_TOF_Lead_Buyer_Babu_190626')).toBeNull()
        expect(micromarketFromCampaignName('Meta_TOF_Lead_Buyer_BABU_Catalog_SpecificMM_230926')).toBeNull()
    })

    it('returns null for a fully generic/retargeting campaign', () => {
        expect(micromarketFromCampaignName('Meta_TOF_Lead_Buyer_Retargeting_SpecificMM_290726')).toBeNull()
    })

    it('returns null when a campaign names more than one micromarket', () => {
        expect(micromarketFromCampaignName('Meta_TOF_Lead_Buyer_Glasgow_Powai_Combined_010926')).toBeNull()
    })

    it('still resolves the one real micromarket when a cluster name is also present', () => {
        expect(micromarketFromCampaignName('Meta_TOF_Lead_Buyer_Babu_Singapore_SpecificArea_230926')).toBe('Singapore')
        expect(micromarketFromCampaignName('Meta_TOF_Lead_Buyer_Helsinki_Habibi_SpecificArea_190926')).toBe('Helsinki')
    })
})

const HEADER = ['Date', 'Month', 'week', 'Lead Source', 'Platform', 'Campaign name', 'Campaign ID', 'Ad Set Name', 'Ad set ID', 'Ad name', 'Ad ID', 'Impr', 'Clicks', 'Cost']

function row(overrides: Partial<Record<string, string>>): string[] {
    const base: Record<string, string> = {
        Date: '5-Aug-26',
        Month: 'Aug-26',
        week: 'Week 32 2026',
        'Lead Source': 'Meta',
        Platform: 'facebook',
        'Campaign name': 'Meta_TOF_Lead_Buyer_Glasgow_SpecificBudget_Above4Cr_290725',
        'Campaign ID': '1',
        'Ad Set Name': 'Aud_Test',
        'Ad set ID': '2',
        'Ad name': 'Ad_Test',
        'Ad ID': '3',
        Impr: '100',
        Clicks: '10',
        Cost: '500',
    }
    return HEADER.map((h) => overrides[h] ?? base[h] ?? '')
}

describe('parseAdPlatformSpendTable', () => {
    it('hard-errors, naming the column, when a required header is missing', () => {
        const r = parseAdPlatformSpendTable(['Date', 'Lead Source', 'Cost'], [], null)
        expect(r.report.status).toBe('schema-error')
        expect(r.report.error).toContain('campaign name')
    })

    it('stamps origin sheet-live', () => {
        const r = parseAdPlatformSpendTable(HEADER, [row({})], null)
        expect(r.report.origin).toBe('sheet-live')
    })

    it('maps Lead Source through the same CHANNEL_MAP the old sheet used', () => {
        const r = parseAdPlatformSpendTable(
            HEADER,
            [row({ 'Lead Source': 'Meta' }), row({ 'Lead Source': 'Google Ads' }), row({ 'Lead Source': 'google_ads' }), row({ 'Lead Source': 'LinkedIn' })],
            null
        )
        expect(r.facts.map((f) => f.channel).sort()).toEqual(['Paid Ads', 'Paid Ads', 'Paid Ads', 'Paid Ads'])
    })

    it('names an unmapped source rather than dropping its spend', () => {
        const r = parseAdPlatformSpendTable(HEADER, [row({ 'Lead Source': 'Some New Platform' })], null)
        expect(r.facts[0]!.channel).toBe('Unmapped')
        expect(r.report.unmappedSources).toContain('Some New Platform')
    })

    it('resolves micromarket from the campaign name, and names the campaign when it cannot', () => {
        const r = parseAdPlatformSpendTable(
            HEADER,
            [row({ 'Campaign name': 'Meta_TOF_Lead_Buyer_Glasgow_SpecificBudget_Above4Cr_290725' }), row({ 'Campaign name': 'Meta_TOF_Lead_Buyer_Babu_190626' })],
            null
        )
        expect(r.facts.find((f) => f.micromarket === 'Glasgow')).toBeTruthy()
        expect(r.facts.find((f) => f.micromarket === null)).toBeTruthy()
        expect(r.report.unknownMicromarkets).toContain('Meta_TOF_Lead_Buyer_Babu_190626')
    })

    it('sums duplicate (date, channel, micromarket, source) rows rather than deduping', () => {
        const rows = [row({ Cost: '100', Impr: '10', Clicks: '1' }), row({ Cost: '50', Impr: '5', Clicks: '0' })]
        const r = parseAdPlatformSpendTable(HEADER, rows, null)
        expect(r.facts).toHaveLength(1)
        expect(r.facts[0]!.spendInr).toBe(150)
        expect(r.facts[0]!.impressions).toBe(15)
        expect(r.facts[0]!.clicks).toBe(1)
    })

    it('drops a row with an unreadable date or amount, and counts it', () => {
        const r = parseAdPlatformSpendTable(HEADER, [row({ Date: 'not-a-date' }), row({ Cost: 'n/a' })], null)
        expect(r.facts).toHaveLength(0)
        expect(r.report.droppedBadDate).toBe(1)
        expect(r.report.droppedBadSpend).toBe(1)
    })

    it('filters rows to the given window', () => {
        const rows = [row({ Date: '1-Jul-26' }), row({ Date: '15-Aug-26' }), row({ Date: '1-Oct-26' })]
        const r = parseAdPlatformSpendTable(HEADER, rows, null, '2026-08-01T00:00:00+05:30', '2026-09-01T00:00:00+05:30')
        expect(r.facts).toHaveLength(1)
        expect(r.facts[0]!.date).toBe('2026-08-15T00:00:00+05:30')
    })
})
