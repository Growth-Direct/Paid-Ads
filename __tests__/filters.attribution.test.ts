import { ATTRIBUTION_NOT_APPLICABLE, ATTRIBUTION_UNMAPPED_PROPERTY } from '@/lib/buyer/shared'
import type { LeadFact, SoldBidFact, VisitFact } from '@/lib/buyer/facts'
import { EMPTY_FILTERS, leadMatches, soldBidMatches, visitMatches } from '@/lib/buyer/filters'
import { describe, expect, it } from 'vitest'

// Coverage for the Campaign/AdSet/Ad/Property filter dimensions added 2026-09-23. No
// dedicated filters test file existed before this — see plan for context.

let seq = 0
function lead(p: Partial<LeadFact> = {}): LeadFact {
    seq += 1
    const id = p.id ?? `L${seq}`
    return {
        id,
        name: `Lead ${id}`,
        status: 'Qualified',
        statusFolded: 'Qualified',
        rawSource: 'Meta',
        sourceLabel: 'Meta',
        channel: 'Paid Ads',
        createdAt: '2026-07-05T09:00:00+05:30',
        clusters: ['PAV'],
        clusterPrimary: 'PAV',
        micromarkets: ['Powai'],
        micromarketPrimary: 'Powai',
        notQualifiedReason: null,
        isQualified: true,
        hasWarmBid: false,
        responseAt: null,
        utmChannel: null,
        acefoneLeadId: null,
        phoneKey: '',
        dedupKey: `id:${id}`,
        isPrimary: true,
        inPopulation: true,
        inPipeline: false,
        attributedSource: '',
        attributedChannel: null,
        attributedMicromarket: null,
        attributedAt: null,
        hasAttribution: false,
        attributedCampaign: '',
        attributedAdSet: '',
        attributedAd: '',
        attributedProperty: '',
        ...p,
    }
}

function visit(p: Partial<VisitFact> = {}): VisitFact {
    seq += 1
    return {
        eventId: `E${seq}`,
        startAt: '2026-07-10T09:00:00+05:30',
        eventMicromarket: 'Powai',
        leadId: 'L1',
        channel: 'Paid Ads',
        sourceLabel: 'Meta',
        leadClusters: ['PAV'],
        leadMicromarkets: ['Powai'],
        leadCreatedAt: '2026-07-05T09:00:00+05:30',
        propertyId: 'PROP-A',
        ...p,
    }
}

function soldBid(p: Partial<SoldBidFact> = {}): SoldBidFact {
    seq += 1
    return {
        dealId: `D${seq}`,
        soldAt: '2026-08-01T09:00:00+05:30',
        viaBlocking: false,
        isChannelPartner: false,
        clusters: ['PAV'],
        micromarkets: ['Powai'],
        channel: 'Paid Ads',
        rawSource: 'Meta',
        sourceLabel: 'Meta',
        attributedCampaign: '',
        attributedAdSet: '',
        attributedAd: '',
        attributedProperty: '',
        ...p,
    }
}

describe('leadMatches — Campaign/AdSet/Ad/Property', () => {
    it('matches a lead whose attributed campaign is in the filter', () => {
        const l = lead({ attributedCampaign: 'CampaignA' })
        expect(leadMatches(l, { ...EMPTY_FILTERS, campaigns: ['CampaignA'] })).toBe(true)
        expect(leadMatches(l, { ...EMPTY_FILTERS, campaigns: ['CampaignB'] })).toBe(false)
    })

    it('matches ad set and ad independently of campaign', () => {
        const l = lead({ attributedAdSet: 'AdSetA', attributedAd: 'AdA' })
        expect(leadMatches(l, { ...EMPTY_FILTERS, adSets: ['AdSetA'] })).toBe(true)
        expect(leadMatches(l, { ...EMPTY_FILTERS, ads: ['AdA'] })).toBe(true)
        expect(leadMatches(l, { ...EMPTY_FILTERS, ads: ['SomeOtherAd'] })).toBe(false)
    })

    it('matches property against the engagement-level attributedProperty', () => {
        const l = lead({ attributedProperty: '1802 - K L Astoria' })
        expect(leadMatches(l, { ...EMPTY_FILTERS, properties: ['1802 - K L Astoria'] })).toBe(true)
        expect(leadMatches(l, { ...EMPTY_FILTERS, properties: ['Some Other Property'] })).toBe(false)
    })

    it('the Not Applicable / Unmapped placeholders are themselves selectable', () => {
        const l = lead({ attributedCampaign: '', attributedProperty: '' })
        expect(leadMatches(l, { ...EMPTY_FILTERS, campaigns: [ATTRIBUTION_NOT_APPLICABLE] })).toBe(true)
        expect(leadMatches(l, { ...EMPTY_FILTERS, properties: [ATTRIBUTION_UNMAPPED_PROPERTY] })).toBe(true)
        expect(leadMatches(l, { ...EMPTY_FILTERS, campaigns: ['CampaignA'] })).toBe(false)
    })

    it('leaves a lead alone when no attribution filter is active', () => {
        const l = lead({ attributedCampaign: 'CampaignA' })
        expect(leadMatches(l, EMPTY_FILTERS)).toBe(true)
    })
})

describe('visitMatches — reads the joined LEAD, not a copy on the visit itself', () => {
    it('matches/excludes by the joined lead\'s attribution, same as the source filter does', () => {
        const l = lead({ id: 'L1', attributedCampaign: 'CampaignA' })
        const v = visit({ leadId: 'L1' })
        expect(visitMatches(v, l, { ...EMPTY_FILTERS, campaigns: ['CampaignA'] })).toBe(true)
        expect(visitMatches(v, l, { ...EMPTY_FILTERS, campaigns: ['CampaignB'] })).toBe(false)
    })

    it('falls back to the placeholder when there is no lead to join (defensive — should not happen in practice)', () => {
        const v = visit()
        expect(visitMatches(v, undefined, { ...EMPTY_FILTERS, campaigns: [ATTRIBUTION_NOT_APPLICABLE] })).toBe(true)
        expect(visitMatches(v, undefined, { ...EMPTY_FILTERS, campaigns: ['CampaignA'] })).toBe(false)
    })
})

describe('soldBidMatches — resolved independently of population, from first-touch directly', () => {
    it('matches a Direct sale by its attributed campaign', () => {
        const bid = soldBid({ attributedCampaign: 'CampaignA' })
        expect(soldBidMatches(bid, { ...EMPTY_FILTERS, campaigns: ['CampaignA'] })).toBe(true)
        expect(soldBidMatches(bid, { ...EMPTY_FILTERS, campaigns: ['CampaignB'] })).toBe(false)
    })

    it('a Channel-Partner sale with no first-touch row still answers the filter via the placeholder', () => {
        // Same null-safe treatment as `channel` already gets: no attribution -> Not
        // Applicable, which a campaign filter correctly excludes, same as a channel filter
        // already excludes `channel: null`.
        const cpBid = soldBid({ isChannelPartner: true, channel: null, attributedCampaign: '' })
        expect(soldBidMatches(cpBid, { ...EMPTY_FILTERS, campaigns: [ATTRIBUTION_NOT_APPLICABLE] })).toBe(true)
        expect(soldBidMatches(cpBid, { ...EMPTY_FILTERS, campaigns: ['CampaignA'] })).toBe(false)
        // Unfiltered, it still counts — same "true everything we sold" total the channel
        // filter already preserves.
        expect(soldBidMatches(cpBid, EMPTY_FILTERS)).toBe(true)
    })
})
