import { weekGroups } from '@/lib/buyer/weekGroups'
import type { WeekSeriesPoint } from '@/lib/buyer/types'
import { describe, expect, it } from 'vitest'

// How weeks club into fortnights on the Buyer charts. The expected grouping below is the one
// the growth team specified on 2026-09-16 for JAS 2026, week for week — a leading stub week
// alone, then pairs, then the running week alone.

function wk(weekLabel: string, flags: Partial<WeekSeriesPoint> = {}): WeekSeriesPoint {
    return { weekStart: weekLabel, weekLabel, counts: {}, leadIds: {}, ...flags }
}

// The quarter opens Wed 1 Jul, so the 29 Jun Monday bucket holds only 1-5 Jul; `now` sits
// inside the 14 Sep week, so that one is still running.
const JAS_2026: WeekSeriesPoint[] = [
    wk('29 Jun', { partialStart: true }),
    wk('6 Jul'),
    wk('13 Jul'),
    wk('20 Jul'),
    wk('27 Jul'),
    wk('3 Aug'),
    wk('10 Aug'),
    wk('17 Aug'),
    wk('24 Aug'),
    wk('31 Aug'),
    wk('7 Sep'),
    wk('14 Sep', { incomplete: true }),
]

const labels = (groups: WeekSeriesPoint[][]) => groups.map((g) => g.map((p) => p.weekLabel))

describe('weekGroups', () => {
    it('matches the grouping the growth team specified, week for week', () => {
        expect(labels(weekGroups(JAS_2026, true))).toEqual([
            ['29 Jun'], // stub: quarter starts mid-week, so it stands alone
            ['6 Jul', '13 Jul'],
            ['20 Jul', '27 Jul'],
            ['3 Aug', '10 Aug'],
            ['17 Aug', '24 Aug'],
            ['31 Aug', '7 Sep'],
            ['14 Sep'], // still running, so it stands alone rather than dragging 7 Sep down
        ])
    })

    it('anchors fortnights to the first full week, so pairs stay put as weeks are added', () => {
        // Next week arrives: every pair above must be unchanged, only the tail moves.
        const nextWeek = [...JAS_2026.slice(0, 11), wk('14 Sep'), wk('21 Sep', { incomplete: true })]
        const got = labels(weekGroups(nextWeek, true))
        expect(got.slice(0, 6)).toEqual(labels(weekGroups(JAS_2026, true)).slice(0, 6))
        expect(got.slice(6)).toEqual([['14 Sep'], ['21 Sep']])
    })

    it('pairs from the start when the range opens on a Monday (no stub week)', () => {
        const noStub = [wk('6 Jul'), wk('13 Jul'), wk('20 Jul'), wk('27 Jul')]
        expect(labels(weekGroups(noStub, true))).toEqual([
            ['6 Jul', '13 Jul'],
            ['20 Jul', '27 Jul'],
        ])
    })

    it('leaves a leftover odd week solo', () => {
        const odd = [wk('6 Jul'), wk('13 Jul'), wk('20 Jul')]
        expect(labels(weekGroups(odd, true))).toEqual([['6 Jul', '13 Jul'], ['20 Jul']])
    })

    it('without the opt-in, groups blindly two at a time — what the Seller tab still renders', () => {
        expect(labels(weekGroups(JAS_2026, false))).toEqual([
            ['29 Jun', '6 Jul'],
            ['13 Jul', '20 Jul'],
            ['27 Jul', '3 Aug'],
            ['10 Aug', '17 Aug'],
            ['24 Aug', '31 Aug'],
            ['7 Sep', '14 Sep'],
        ])
    })
})
