import { describe, expect, it } from 'vitest'
import { buildBuckets } from '@/lib/buyer/shared'

// buildBuckets admits a bucket as soon as its START is in the past, so the current week or
// month always appears holding only the days elapsed so far. That is the right call — the
// current week is the one people most want to see — but the chart has to be told, or it
// renders a 2-of-7-day bar at the same weight as a full one and reads as a collapse. These
// lock which buckets get flagged.

const IST = (m: number, d: number, h = 9) =>
    new Date(`2026-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T${String(h).padStart(2, '0')}:00:00+05:30`)

const Q_START = IST(7, 5, 0)
const Q_END = new Date('2026-10-05T00:00:00+05:30')

describe('buildBuckets bucketIncomplete', () => {
    it('flags only the final, in-progress week', () => {
        // Tuesday 8 Sep. The week of Mon 7 Sep has run 2 of 7 days.
        const { bucketStarts, bucketIncomplete } = buildBuckets([], 'week', Q_START, Q_END, IST(9, 8))
        expect(bucketStarts.length).toBe(bucketIncomplete.length)
        expect(bucketIncomplete.filter(Boolean)).toHaveLength(1)
        expect(bucketIncomplete[bucketIncomplete.length - 1]).toBe(true)
        expect(bucketIncomplete.slice(0, -1).every((f) => f === false)).toBe(true)
    })

    it('flags nothing when now falls exactly on a week boundary', () => {
        // Monday 7 Sep at IST midnight: every admitted week has fully elapsed.
        const { bucketIncomplete } = buildBuckets([], 'week', Q_START, Q_END, IST(9, 7, 0))
        expect(bucketIncomplete.some(Boolean)).toBe(false)
    })

    it('flags the final month at month grain', () => {
        const { bucketIncomplete } = buildBuckets([], 'month', Q_START, Q_END, IST(9, 8))
        expect(bucketIncomplete.filter(Boolean)).toHaveLength(1)
        expect(bucketIncomplete[bucketIncomplete.length - 1]).toBe(true)
    })

    it('flags a week the SELECTED RANGE clips, not just one today clips', () => {
        // A past quarter, fully elapsed, but its last week is cut short by the quarter end —
        // Jul 5 is a Sunday, so the week containing it starts Jun 29 and the range starts
        // mid-week. Looking at a closed period must still mark a partial bucket, otherwise a
        // historical view shows a cliff nobody can explain by "today".
        const rangeEnd = new Date('2026-08-13T00:00:00+05:30') // a Thursday
        const { bucketIncomplete } = buildBuckets(
            [{ start: '2026-07-06T00:00:00+05:30', end: rangeEnd.toISOString() }],
            'week',
            Q_START,
            Q_END,
            IST(9, 8)
        )
        expect(bucketIncomplete[bucketIncomplete.length - 1]).toBe(true)
    })

    it('leaves every bucket complete for a fully elapsed, boundary-aligned range', () => {
        const { bucketIncomplete } = buildBuckets(
            [{ start: '2026-07-06T00:00:00+05:30', end: '2026-08-10T00:00:00+05:30' }],
            'week',
            Q_START,
            Q_END,
            IST(9, 8)
        )
        expect(bucketIncomplete.some(Boolean)).toBe(false)
    })

    it('flags only the leading stub bucket as partialStart', () => {
        // JAS 2026 opens Wed 1 Jul, so the first Monday bucket (29 Jun) holds just 1-5 Jul.
        const { bucketStarts, bucketPartialStart } = buildBuckets([], 'week', Q_START, Q_END, IST(9, 15))
        expect(bucketPartialStart[0]).toBe(true)
        expect(bucketPartialStart.filter(Boolean)).toHaveLength(1)
        expect(bucketPartialStart).toHaveLength(bucketStarts.length)
    })

    it('flags no stub when the range opens on a Monday', () => {
        // 6 Jul 2026 is a Monday, so nothing is clipped off the front.
        const { bucketPartialStart } = buildBuckets(
            [{ start: '2026-07-06T00:00:00+05:30', end: '2026-08-10T00:00:00+05:30' }],
            'week',
            Q_START,
            Q_END,
            IST(9, 8)
        )
        expect(bucketPartialStart.some(Boolean)).toBe(false)
    })
})
