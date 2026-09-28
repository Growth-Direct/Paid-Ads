import type { WeekSeriesPoint } from './types'

/** How weeks club together into fortnights, for BOTH the `pairWeeks` visual grouping and the
 *  Bi-Weekly merge — one helper so the two views can never drift apart.
 *
 *  A PARTIAL week stands on its own: the stub at the start (a quarter beginning mid-week leaves
 *  one — 29 Jun – 5 Jul for a quarter opening on Wed 1 Jul) and the running week at the end. The
 *  full weeks between them pair two at a time, and an odd one left over stays solo, the
 *  convention the old blind `i += 2` grouping already used for a trailing odd week.
 *
 *  Leaving the leading stub alone is what anchors every fortnight to the first FULL week, so the
 *  grouping stays put as the quarter fills in instead of every pair reshuffling each time a week
 *  is added. Opt-in through `pairFromFirstFullWeek`; without it this returns the original
 *  two-at-a-time grouping, which is what the Seller tab still renders.
 *
 *  Note `solo()` also treats the NEXT point: a full week whose partner is the running week is
 *  left on its own rather than half-paired, so the partial always stands clear. */
export function weekGroups(pts: WeekSeriesPoint[], fromFirstFullWeek: boolean): WeekSeriesPoint[][] {
    const groups: WeekSeriesPoint[][] = []
    if (!fromFirstFullWeek) {
        for (let i = 0; i < pts.length; i += 2) groups.push(pts.slice(i, i + 2))
        return groups
    }
    const solo = (p: WeekSeriesPoint | undefined): boolean =>
        p === undefined || p.partialStart === true || p.incomplete === true
    let i = 0
    while (i < pts.length) {
        const a = pts[i]!
        if (solo(a) || solo(pts[i + 1])) {
            groups.push([a])
            i += 1
        } else {
            groups.push([a, pts[i + 1]!])
            i += 2
        }
    }
    return groups
}

