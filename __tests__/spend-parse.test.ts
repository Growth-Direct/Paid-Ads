import { parseInr, parseSheetDate, parseSpendTable } from '@/lib/buyer/spend/parse'
import { describe, expect, it } from 'vitest'

describe('parseSheetDate', () => {
    it('parses D-Mon-YYYY (offline rows)', () => {
        expect(parseSheetDate('5-Jun-2026')).toBe('2026-06-05T00:00:00+05:30')
    })
    it('parses M/D/YYYY (ad-platform rows) — 8/7 is 7 Aug, not 8 Jul', () => {
        expect(parseSheetDate('8/7/2026')).toBe('2026-08-07T00:00:00+05:30')
    })
    it('parses D-Mon-YY, the two-digit-year form the buyer tab started using on 2026-09-16', () => {
        // 29,127 rows (₹9.2 L of Meta and Google Ads) arrived in this shape alongside the
        // four-digit form. The month is named, so only the year needs resolving.
        expect(parseSheetDate('1-Sep-26')).toBe('2026-09-01T00:00:00+05:30')
        expect(parseSheetDate('31-Aug-26')).toBe('2026-08-31T00:00:00+05:30')
    })

    it('still parses the four-digit-year form the same file also carries', () => {
        expect(parseSheetDate('14-Aug-2026')).toBe('2026-08-14T00:00:00+05:30')
    })

    it('rejects an out-of-range month', () => {
        expect(parseSheetDate('13/7/2026')).toBeNull()
    })
    it('rejects junk', () => {
        expect(parseSheetDate('')).toBeNull()
        expect(parseSheetDate('yesterday')).toBeNull()
    })
})

describe('parseInr', () => {
    it('handles Indian lakh grouping', () => {
        expect(parseInr('1,23,456')).toBe(123456)
    })
    it('strips the rupee sign and decimals', () => {
        expect(parseInr('₹12,345.60')).toBeCloseTo(12345.6)
    })
    it('treats blank and dash as zero spend', () => {
        expect(parseInr('')).toBe(0)
        expect(parseInr('-')).toBe(0)
    })
    it('drops non-numeric garbage (null, not 0)', () => {
        expect(parseInr('n/a')).toBeNull()
    })
})

const HEADER = ['Date', 'UTM Source', 'UTM Micromarket', 'Impressions', 'Clicks', 'Spends (in INR)']

describe('parseSpendTable', () => {
    it('hard-errors, naming the column, when a required header is missing', () => {
        const r = parseSpendTable(['Date', 'UTM Source', 'Spends (in INR)'], [])
        expect(r.report.status).toBe('schema-error')
        expect(r.report.error).toContain('utm micromarket')
    })

    it('sums duplicate (date, channel, micromarket, source) rows rather than deduping', () => {
        const rows = [
            ['8/5/2026', 'Meta', 'Powai', '100', '10', '1,000'],
            ['8/5/2026', 'Meta', 'Powai', '50', '5', '2,000'],
        ]
        const { facts } = parseSpendTable(HEADER, rows)
        expect(facts).toHaveLength(1)
        expect(facts[0]!.spendInr).toBe(3000)
        expect(facts[0]!.impressions).toBe(150)
    })

    it('keeps unknown-source spend under Unmapped and reports it', () => {
        const { facts, report } = parseSpendTable(HEADER, [['8/5/2026', 'TikTok', 'Powai', '', '', '500']])
        expect(facts[0]!.channel).toBe('Unmapped')
        expect(report.unmappedSources).toContain('TikTok')
    })

    it('keeps unknown-micromarket spend in the null bucket and reports it', () => {
        const { facts, report } = parseSpendTable(HEADER, [['8/5/2026', 'Meta', 'Atlantis', '', '', '500']])
        expect(facts[0]!.micromarket).toBeNull()
        expect(report.unknownMicromarkets).toContain('Atlantis')
    })

    it('counts dropped bad dates and bad spends', () => {
        const rows = [
            ['nope', 'Meta', 'Powai', '', '', '100'],
            ['8/5/2026', 'Meta', 'Powai', '', '', 'n/a'],
            ['8/5/2026', 'Meta', 'Powai', '', '', '100'],
        ]
        const { report } = parseSpendTable(HEADER, rows)
        expect(report.droppedBadDate).toBe(1)
        expect(report.droppedBadSpend).toBe(1)
        expect(report.rowsKept).toBe(1)
    })
})
