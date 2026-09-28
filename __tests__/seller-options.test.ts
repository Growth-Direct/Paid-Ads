import { describe, expect, it } from 'vitest'
import { buildSellerClusterOptions, buildSellerSourceOptions } from '@/lib/seller/options'
import { EMPTY_SELLER_SPEND_INGEST } from '@/lib/seller/spend/parse'
import type { SellerFact, SellerFacts } from '@/lib/seller/facts'

// buildSellerSourceOptions drives the Channel/Source filter picker. Locks the 2026-09-09 fix:
// a source whose every seller predates the current quarter (Old cohort, inPopulation false)
// must still appear, not just sources with in-quarter (New cohort) records.

function seller(over: Partial<SellerFact> & { rawSource: string; channel: SellerFact['channel'] }): SellerFact {
    return {
        id: over.id ?? 'S1',
        name: 'Test Seller',
        phoneKey: '',
        dedupKey: 'id:S1',
        isPrimary: true,
        inPopulation: true,
        callStatusRaw: 'Qualified',
        callStatusFolded: 'Qualified',
        isQualified: true,
        reasonForDrop: null,
        notTruvaQualifiedReasons: [],
        micromarkets: [],
        clusters: [],
        createdAt: '2026-07-10T09:00:00+05:30',
        responseAt: null,
        acefoneLeadId: null,
        ...over,
    }
}

function facts(sellers: SellerFact[]): SellerFacts {
    return {
        sellers,
        products: [],
        channelPartnerProducts: [],
        channelPartnerPlaces: {},
        spend: [],
        spendIngest: EMPTY_SELLER_SPEND_INGEST,
        windowStart: '2026-07-01T00:00:00+05:30',
        windowEnd: '2026-10-01T00:00:00+05:30',
    }
}

describe('buildSellerSourceOptions', () => {
    it('includes a source whose every seller is Old cohort (inPopulation false)', () => {
        // Mirrors live NoBroker: 35 real records, all 2025-dated, none inPopulation for the
        // current quarter — verified live 2026-09-09 against /api/seller.
        const options = buildSellerSourceOptions(
            facts([
                seller({ id: 'NB1', rawSource: 'NoBroker', channel: '3P', inPopulation: false, createdAt: '2025-03-04T00:54:55+05:30' }),
            ])
        )
        const threeP = options.find((g) => g.id === '3P')
        expect(threeP?.children.map((c) => c.label)).toContain('NoBroker')
    })

    it('still omits a source with no records at all', () => {
        // Square Yards has zero live rows (checked 2026-09-09) — nothing to build an option
        // from. This isn't a bug this function can fix; it's a Zoho-data fact.
        const options = buildSellerSourceOptions(facts([seller({ id: 'M1', rawSource: 'Meta', channel: 'Paid Ads' })]))
        const threeP = options.find((g) => g.id === '3P')
        expect(threeP).toBeUndefined()
    })

    it('still groups by channel and sorts sources alphabetically within it, mixing New and Old cohorts', () => {
        const options = buildSellerSourceOptions(
            facts([
                seller({ id: 'S1', rawSource: 'MyGate', channel: '3P', inPopulation: true }),
                seller({ id: 'S2', rawSource: 'NoBroker', channel: '3P', inPopulation: false }),
                seller({ id: 'S3', rawSource: '99 Acres', channel: '3P', inPopulation: true }),
            ])
        )
        const threeP = options.find((g) => g.id === '3P')!
        expect(threeP.children.map((c) => c.label)).toEqual(['99 Acres', 'MyGate', 'NoBroker'])
    })
})

describe('buildSellerClusterOptions', () => {
    // Added 2026-09-24 per an explicit growth-team request ("add unmapped for all non mapped
    // micromarkets... and add that in the filter"): a live-derived "Unmapped" group, appended
    // only when at least one seller's primary micromarket doesn't map to a named market.

    it('omits the Unmapped group when every seller has a canonical primary micromarket', () => {
        const options = buildSellerClusterOptions(facts([seller({ id: 'S1', rawSource: 'Meta', channel: 'Paid Ads', micromarkets: ['Powai'] })]))
        expect(options.find((g) => g.id === 'Unmapped')).toBeUndefined()
    })

    it('adds a single-child Unmapped group when a seller carries a blank or unrecognised micromarket', () => {
        const options = buildSellerClusterOptions(
            facts([
                seller({ id: 'S1', rawSource: 'Meta', channel: 'Paid Ads', micromarkets: ['Powai'] }),
                seller({ id: 'S2', rawSource: 'Meta', channel: 'Paid Ads', micromarkets: ['Outside MM'] }),
                seller({ id: 'S3', rawSource: 'Meta', channel: 'Paid Ads', micromarkets: [] }),
            ])
        )
        const unmapped = options.find((g) => g.id === 'Unmapped')
        expect(unmapped).toBeDefined()
        expect(unmapped!.children).toEqual([{ id: 'Unmapped', label: 'Unmapped' }])
    })

    it('still lists every canonical cluster/micromarket regardless of live data', () => {
        const options = buildSellerClusterOptions(facts([]))
        expect(options.map((g) => g.id)).toEqual(['PAV', 'GLAM', 'BABU', 'HABIBI'])
    })
})
