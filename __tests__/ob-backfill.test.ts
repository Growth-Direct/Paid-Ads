import { describe, expect, it } from 'vitest'
import {
    type LshTouch,
    type SheetRow,
    attribute,
    groupSheetRows,
    normaliseMedium,
    propertyKey,
    subscriptionPeriods,
} from '@/lib/spend/obBackfill'

const row = (o: Partial<SheetRow> = {}): SheetRow => ({
    date: '2026-06-11',
    micromarket: 'Powai',
    medium: 'flyers',
    spendInr: 12000,
    quantity: 10000,
    scans: 19,
    ...o,
})
const touch = (o: Partial<LshTouch> = {}): LshTouch => ({
    day: '2026-06-11',
    micromarket: 'Powai',
    campaignName: null,
    propertyName: null,
    ...o,
})
const noProperty = () => undefined

describe('propertyKey', () => {
    it('matches LSH against Zoho across the pincode suffix', () => {
        expect(propertyKey('1103 - Fiorello of Nahar’s Amrit Shakti - 400072')).toBe(
            propertyKey('1103 - Fiorello of Nahar’s Amrit Shakti')
        )
    })

    it('collapses the tower LSH repeats as the society', () => {
        // LSH writes "{Unit} - {Tower} of {Society}" and doubles when the two share a name.
        expect(propertyKey('1802 - K L Astoria of K L Astoria')).toBe(propertyKey('1802 - K L Astoria - 400050'))
        expect(propertyKey('303 - Glen Croft of Glen Croft of Hiranandani Gardens')).toBe(
            propertyKey('303 - Glen Croft of Hiranandani Gardens - 400076')
        )
    })

    it('keeps different flats in the same tower apart', () => {
        expect(propertyKey('1802 - K L Astoria - 400050')).not.toBe(propertyKey('1902 - K L Astoria - 400050'))
    })

    it('does not fold a society-only label onto a flat in it', () => {
        expect(propertyKey('K L Astoria')).not.toBe(propertyKey('1802 - K L Astoria - 400050'))
    })
})

describe('normaliseMedium', () => {
    it('folds the singular and truncated spellings LSH carries', () => {
        expect(normaliseMedium('Flyer')).toBe('flyers')
        expect(normaliseMedium('Flyers')).toBe('flyers')
        expect(normaliseMedium('Class')).toBe('classified ads')
        expect(normaliseMedium('Classified Ads')).toBe('classified ads')
        expect(normaliseMedium(null)).toBe('')
    })
})

describe('groupSheetRows', () => {
    it('sums rows sharing a day, micromarket and medium rather than letting them collide', () => {
        // The ledger keys on sha256(campaign name) per source per day, so two rows that produce
        // one name would overwrite each other and lose the money.
        const g = groupSheetRows([row({ spendInr: 12000 }), row({ spendInr: 6000 }), row({ spendInr: 6000 })])
        expect(g.size).toBe(1)
        expect([...g.values()][0]!.spendInr).toBe(24000)
        expect([...g.values()][0]!.quantity).toBe(30000)
    })

    it('keeps different media on the same day apart', () => {
        expect(groupSheetRows([row(), row({ medium: 'classified ads' })]).size).toBe(2)
    })
})

describe('attribute', () => {
    it('takes the real campaign name when exactly one ran that day in that micromarket', () => {
        const r = attribute(row(), [touch({ campaignName: '903C_WesternHeights_Buyer_05062026' })], noProperty)
        expect(r.attribution).toBe('lsh-campaign')
        expect(r.campaignName).toBe('903C_WesternHeights_Buyer_05062026')
    })

    it('falls back to micromarket level when several campaigns ran, rather than splitting spend', () => {
        const r = attribute(row(), [touch({ campaignName: 'A_Buyer_110626' }), touch({ campaignName: 'B_Buyer_110626' })], noProperty)
        expect(r.attribution).toBe('no-campaign-micromarket')
        // Deliberately not in the builder's grammar — nothing should try to join this to LSH.
        expect(r.campaignName).toBe('Offline Branding - Flyers - Powai - 2026-06-11')
        expect(r.campaignName).not.toMatch(/^\w+_\w+_\w+_\d{8}$/)
    })

    it('describes rather than invents a campaign when leads arrived for one property untagged', () => {
        const r = attribute(row(), [touch({ propertyName: '1802 - K L Astoria of K L Astoria' })], () => ({
            id: '785549000000359152',
            name: '1802 - K L Astoria - 400050',
        }))
        expect(r.attribution).toBe('no-campaign-property')
        // The property is the real connection and rides in property_id; the identifier only
        // describes. It must not look like a builder campaign name.
        expect(r.campaignName).toBe('Offline Branding - Flyers - 1802 - K L Astoria - 2026-06-11')
        expect(r.propertyId).toBe('785549000000359152')
    })

    it('ignores touches from another day or another micromarket', () => {
        const r = attribute(row(), [
            touch({ day: '2026-06-12', campaignName: 'WrongDay' }),
            touch({ micromarket: 'Glasgow', campaignName: 'WrongPlace' }),
        ], noProperty)
        expect(r.attribution).toBe('no-campaign-micromarket')
    })

    it('still uses a touch whose micromarket is null, since LSH often leaves it blank', () => {
        const r = attribute(row(), [touch({ micromarket: null, campaignName: 'Untagged_Buyer_110626' })], noProperty)
        expect(r.attribution).toBe('lsh-campaign')
    })

    it('carries the property id even when the campaign name came from LSH', () => {
        const r = attribute(row(), [touch({ campaignName: 'X_Buyer_110626', propertyName: 'P' })], () => ({ id: '99', name: 'P - 400072' }))
        expect(r.attribution).toBe('lsh-campaign')
        expect(r.propertyId).toBe('99')
    })

    it('leaves the property blank when two properties got leads, rather than picking one', () => {
        const r = attribute(row(), [touch({ propertyName: 'A' }), touch({ propertyName: 'B' })], () => ({ id: '1', name: 'A' }))
        expect(r.propertyId).toBe('')
    })

    it('never emits the same campaign name for two different days in one micromarket', () => {
        const a = attribute(row({ date: '2026-06-11' }), [], noProperty)
        const b = attribute(row({ date: '2026-06-12' }), [], noProperty)
        expect(a.campaignName).not.toBe(b.campaignName)
    })
})

describe('subscriptionPeriods', () => {
    it('collapses a run of equal daily amounts back into its invoice', () => {
        const daily = Array.from({ length: 31 }, (_, i) => ({
            date: `2026-07-${String(i + 1).padStart(2, '0')}`,
            spendInr: 1265.26,
        }))
        const [p] = subscriptionPeriods('Magicbricks', daily)
        expect(p!.startDate).toBe('2026-07-01')
        expect(p!.endDate).toBe('2026-07-31')
        expect(p!.days).toBe(31)
        expect(p!.amount).toBeCloseTo(1265.26 * 31, 2)
    })

    it('splits where the daily amount changes, which is where one invoice ends', () => {
        const periods = subscriptionPeriods('Housing', [
            { date: '2026-07-01', spendInr: 842.9 },
            { date: '2026-07-02', spendInr: 842.9 },
            { date: '2026-07-03', spendInr: 871.0 },
        ])
        expect(periods).toHaveLength(2)
        expect(periods[0]!.endDate).toBe('2026-07-02')
        expect(periods[1]!.startDate).toBe('2026-07-03')
    })

    it('returns periods that never overlap, since the ledger rejects an overlap', () => {
        const periods = subscriptionPeriods('99Acres', [
            { date: '2026-07-01', spendInr: 10 },
            { date: '2026-07-02', spendInr: 20 },
            { date: '2026-07-03', spendInr: 10 },
        ])
        for (let i = 1; i < periods.length; i++) expect(periods[i]!.startDate > periods[i - 1]!.endDate).toBe(true)
    })
})

describe('identifiers that are not campaigns', () => {
    const builderGrammar = /^[A-Za-z0-9]+(_[A-Za-z0-9]+)+$/

    it('never emits a builder-shaped name for a row with no LSH campaign', () => {
        // A lookalike would invite a join to Lead_Source_History that cannot succeed, because
        // the string exists nowhere in LSH. Real names look like 903C_WesternHeights_Buyer_05062026.
        const noCampaign = attribute(row(), [], noProperty)
        const withProperty = attribute(row(), [touch({ propertyName: 'P' })], () => ({ id: '1', name: 'P - 400072' }))
        for (const r of [noCampaign, withProperty]) {
            expect(r.attribution).not.toBe('lsh-campaign')
            expect(r.campaignName).not.toMatch(builderGrammar)
            expect(r.campaignName).toContain('Offline Branding - ')
        }
    })

    it('passes a real LSH campaign name through untouched, builder grammar and all', () => {
        const r = attribute(row(), [touch({ campaignName: '903C_WesternHeights_Buyer_05062026' })], noProperty)
        expect(r.campaignName).toMatch(builderGrammar)
    })

    it('still gives every row a unique, stable identifier, since activityKey hashes it', () => {
        const a = attribute(row({ date: '2026-06-11' }), [], noProperty)
        const b = attribute(row({ date: '2026-06-12' }), [], noProperty)
        const c = attribute(row({ medium: 'classified ads' }), [], noProperty)
        const d = attribute(row({ micromarket: 'Glasgow' }), [], noProperty)
        expect(new Set([a, b, c, d].map((r) => r.campaignName)).size).toBe(4)
        expect(attribute(row(), [], noProperty).campaignName).toBe(a.campaignName)
    })
})
