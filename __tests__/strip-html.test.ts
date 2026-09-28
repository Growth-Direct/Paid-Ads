import { stripHtml } from '@/lib/strip-html'
import { describe, expect, it } from 'vitest'

describe('stripHtml', () => {
    it('returns null for null input', () => {
        expect(stripHtml(null)).toBeNull()
    })

    it('returns null for empty string', () => {
        expect(stripHtml('')).toBeNull()
    })

    it('returns null when only whitespace remains after stripping', () => {
        expect(stripHtml('<p>   </p>')).toBeNull()
    })

    it('strips HTML tags', () => {
        expect(stripHtml('<p>Hello world</p>')).toBe('Hello world')
    })

    it('converts <br> to newline', () => {
        expect(stripHtml('Line 1<br>Line 2')).toBe('Line 1\nLine 2')
    })

    it('converts <br/> to newline', () => {
        expect(stripHtml('Line 1<br/>Line 2')).toBe('Line 1\nLine 2')
    })

    it('converts <br /> to newline', () => {
        expect(stripHtml('Line 1<br />Line 2')).toBe('Line 1\nLine 2')
    })

    it('collapses consecutive <br> tags into a single newline', () => {
        expect(stripHtml('A<br><br>B')).toBe('A\nB')
        expect(stripHtml('A<br><br><br>B')).toBe('A\nB')
    })

    it('decodes &amp;', () => {
        expect(stripHtml('A &amp; B')).toBe('A & B')
    })

    it('decodes &lt; and &gt;', () => {
        expect(stripHtml('&lt;tag&gt;')).toBe('<tag>')
    })

    it('decodes &nbsp;', () => {
        expect(stripHtml('A&nbsp;B')).toBe('A B')
    })

    it('trims leading and trailing whitespace', () => {
        expect(stripHtml('  hello  ')).toBe('hello')
    })

    it('handles realistic Zoho AI HTML with paragraphs and breaks', () => {
        const input =
            '<p>Buyer Snapshot</p>' +
            '<p>Budget ₹3.5 Cr.<br>Interested in E of The Trees.<br><br>Looking to close soon.</p>'
        expect(stripHtml(input)).toBe(
            'Buyer Snapshot\nBudget ₹3.5 Cr.\nInterested in E of The Trees.\nLooking to close soon.'
        )
    })
})
