import { describe, expect, it } from 'vitest'
import { inferSlashOrder, parseSheetDate } from '@/lib/spend/sheet'
import { parseSellerSpendTable } from '@/lib/seller/spend/parse'

// The seller spend tab's own hazards, as measured against the 2026-09-08 export (21,840 rows,
// ₹11,73,206.80). Every case here is a real value from that file, not an invented one.

const HEADER = ['Date', 'UTM Source', 'UTM Micromarket', 'Impressions', 'Clicks', 'Spends (in INR)']
const DMY = 'DMY' as const

describe('inferSlashOrder', () => {
    it('proves D/M when the first component exceeds 12', () => {
        // The live seller tab: max first 31, max second 9.
        const inf = inferSlashOrder(['06/01/26', '31/08/2026', '5/9/2026'])
        expect(inf.order).toBe('DMY')
        expect(inf.maxFirst).toBe(31)
        expect(inf.maxSecond).toBe(9)
    })

    it('proves M/D when the second component exceeds 12', () => {
        // The live buyer tab's shape, which is the opposite order in the same workbook.
        expect(inferSlashOrder(['8/7/2026', '12/31/2026']).order).toBe('MDY')
    })

    it('refuses to guess when neither component exceeds 12', () => {
        expect(inferSlashOrder(['6/1/2026', '7/2/2026']).order).toBeNull()
    })

    it('refuses to guess when both components exceed 12 (a corrupt column)', () => {
        expect(inferSlashOrder(['31/8/2026', '8/31/2026']).order).toBeNull()
    })

    it('ignores non-slash dates rather than counting them', () => {
        expect(inferSlashOrder(['1-Aug-2026', 'yesterday', '']).slashRows).toBe(0)
    })
})

describe('parseSheetDate with an explicit slash order', () => {
    it('reads the seller tab as D/M — 06/01/26 is 6 Jan, not 1 Jun', () => {
        expect(parseSheetDate('06/01/26', DMY)).toBe('2026-01-06T00:00:00+05:30')
    })

    it('reads the buyer tab as M/D — 8/7/2026 is 7 Aug, not 8 Jul', () => {
        expect(parseSheetDate('8/7/2026', 'MDY')).toBe('2026-08-07T00:00:00+05:30')
    })

    it('resolves a two-digit year as 20xx', () => {
        expect(parseSheetDate('31/08/26', DMY)).toBe('2026-08-31T00:00:00+05:30')
    })

    it('still reads the unambiguous D-Mon-YYYY form whatever the slash order', () => {
        expect(parseSheetDate('5-Jun-2026', DMY)).toBe('2026-06-05T00:00:00+05:30')
        expect(parseSheetDate('5-Jun-2026', 'MDY')).toBe('2026-06-05T00:00:00+05:30')
    })

    it('rejects every slash date when the order could not be proved', () => {
        // The build script throws instead of reaching here, but if a caller ever passes null
        // the row must drop and be counted, never be guessed at.
        expect(parseSheetDate('06/01/26', null)).toBeNull()
        expect(parseSheetDate('5-Jun-2026', null)).toBe('2026-06-05T00:00:00+05:30')
    })

    it('rejects a component that cannot be a month under the given order', () => {
        expect(parseSheetDate('31/08/2026', 'MDY')).toBeNull()
    })
})

describe('parseSellerSpendTable', () => {
    it('hard-errors, naming the column, when a required header is missing', () => {
        const { facts, report } = parseSellerSpendTable(['Date', 'UTM Source'], [], DMY)
        expect(facts).toEqual([])
        expect(report.status).toBe('schema-error')
        expect(report.error).toContain('utm micromarket')
        expect(report.error).toContain('spends (in inr)')
    })

    it('maps every live seller source to its channel, leaving nothing unmapped', () => {
        // The five sources actually present on the tab.
        const rows = [
            ['06/01/26', 'Meta', 'Powai', '1', '1', '100'],
            ['06/01/26', 'google_ads', 'Powai', '1', '1', '100'],
            ['06/01/26', 'Offline Branding', 'Powai', '1', '1', '100'],
            ['06/01/26', 'MagicBricks', 'Powai', '1', '1', '100'],
            ['06/01/26', '99Acres', 'Powai', '1', '1', '100'],
        ]
        const { facts, report } = parseSellerSpendTable(HEADER, rows, DMY)
        expect(report.unmappedSources).toEqual([])
        expect(new Set(facts.map((f) => f.channel))).toEqual(new Set(['Paid Ads', 'Offline Branding', '3P']))
    })

    it('keeps unknown-source spend under Unmapped and reports it', () => {
        const { facts, report } = parseSellerSpendTable(HEADER, [['06/01/26', 'TikTok', 'Powai', '', '', '500']], DMY)
        expect(facts[0]!.channel).toBe('Unmapped')
        expect(facts[0]!.spendInr).toBe(500)
        expect(report.unmappedSources).toContain('TikTok')
    })

    it('sends All MM to the unallocated bucket WITHOUT flagging it — it is the tab’s convention, not an anomaly', () => {
        const { facts, report } = parseSellerSpendTable(HEADER, [['06/01/26', 'Meta', 'All MM', '', '', '1000']], DMY)
        expect(facts[0]!.micromarket).toBeNull()
        expect(report.unknownMicromarkets).toEqual([])
        expect(report.unallocatedInr).toBe(1000)
    })

    it('sends a blank micromarket to the unallocated bucket without flagging it', () => {
        const { report } = parseSellerSpendTable(HEADER, [['06/01/26', '99Acres', '', '', '', '2000']], DMY)
        expect(report.unknownMicromarkets).toEqual([])
        expect(report.unallocatedInr).toBe(2000)
    })

    it('flags a cluster typed into the micromarket column, and still counts its money', () => {
        // `Habibi` is live on the tab (₹8,042.60). It is a cluster, not a micromarket, so it
        // cannot be allocated — but it IS a data-entry problem the growth team should see.
        const { facts, report } = parseSellerSpendTable(HEADER, [['06/01/26', 'Meta', 'Habibi', '', '', '8042.60']], DMY)
        expect(facts[0]!.micromarket).toBeNull()
        expect(report.unknownMicromarkets).toContain('Habibi')
        expect(report.unallocatedInr).toBeCloseTo(8042.6, 2)
    })

    it('corrects the live Anthens typo to Athens rather than losing it to unallocated', () => {
        const { facts, report } = parseSellerSpendTable(HEADER, [['06/01/26', 'Meta', 'Anthens', '', '', '917.10']], DMY)
        expect(facts[0]!.micromarket).toBe('Athens')
        expect(report.unallocatedInr).toBe(0)
        expect(report.unknownMicromarkets).toEqual([])
    })

    it('keeps the seller-only micromarkets the buyer grid lumps together', () => {
        const rows = [
            ['06/01/26', 'Meta', 'Helsinki', '', '', '100'],
            ['06/01/26', 'Meta', 'Berlin', '', '', '100'],
            ['06/01/26', 'Meta', 'Hong Kong', '', '', '100'],
        ]
        const { facts } = parseSellerSpendTable(HEADER, rows, DMY)
        expect(facts.map((f) => f.micromarket)).toEqual(['Helsinki', 'Berlin', 'Hong Kong'])
    })

    it('sums duplicate (date, channel, micromarket, source) rows rather than deduping', () => {
        // Several ads for one source on one day is the normal shape of this tab; deduping
        // would understate spend, the direction that flatters every cost-per metric.
        const rows = [
            ['06/01/26', 'Meta', 'Powai', '100', '5', '0.56'],
            ['06/01/26', 'Meta', 'Powai', '50', '2', '0.17'],
        ]
        const { facts } = parseSellerSpendTable(HEADER, rows, DMY)
        expect(facts).toHaveLength(1)
        expect(facts[0]!.spendInr).toBeCloseTo(0.73, 5)
        expect(facts[0]!.impressions).toBe(150)
        expect(facts[0]!.clicks).toBe(7)
    })

    it('handles Indian lakh grouping in the spend column', () => {
        const { facts } = parseSellerSpendTable(HEADER, [['06/01/26', 'Meta', 'Powai', '', '', '1,23,456']], DMY)
        expect(facts[0]!.spendInr).toBe(123456)
    })

    it('treats a blank or dash amount as zero spend, keeping the row', () => {
        const rows = [
            ['06/01/26', 'Meta', 'Powai', '', '', ''],
            ['07/01/26', 'Meta', 'Powai', '', '', '-'],
        ]
        const { facts, report } = parseSellerSpendTable(HEADER, rows, DMY)
        expect(report.rowsKept).toBe(2)
        expect(facts.every((f) => f.spendInr === 0)).toBe(true)
    })

    it('counts dropped bad dates and bad amounts instead of coercing them', () => {
        const rows = [
            ['not a date', 'Meta', 'Powai', '', '', '100'],
            ['06/01/26', 'Meta', 'Powai', '', '', 'n/a'],
            ['06/01/26', 'Meta', 'Powai', '', '', '100'],
        ]
        const { facts, report } = parseSellerSpendTable(HEADER, rows, DMY)
        expect(report.droppedBadDate).toBe(1)
        expect(report.droppedBadSpend).toBe(1)
        expect(report.rowsKept).toBe(1)
        expect(facts).toHaveLength(1)
    })

    it('matches columns by header text, not position', () => {
        // Same data, columns reordered and re-cased: the growth team does this.
        const header = ['Spends (in INR)', 'utm_micromarket', 'UTM  Source', 'DATE']
        const { facts } = parseSellerSpendTable(header, [['750', 'Glasgow', 'Meta', '06/01/26']], DMY)
        expect(facts[0]).toMatchObject({ spendInr: 750, micromarket: 'Glasgow', channel: 'Paid Ads', rawSource: 'meta' })
    })

    it('records the slash order it was built with', () => {
        expect(parseSellerSpendTable(HEADER, [], DMY).report.slashOrder).toBe('DMY')
    })
})
