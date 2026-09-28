import { describe, expect, it } from 'vitest'
import { dayOf, reconcile, sourceKey, withinWindow } from '@/lib/spend/reconcile'
import type { SpendFact } from '@/lib/buyer/facts'
import type { Channel } from '@/lib/buyer/types'

// The reconciler is the gate on switching the dashboard fully onto the growth ledger, so its own
// arithmetic has to be beyond doubt. Every case here is one the August comparison can actually hit.

function fact(over: Partial<SpendFact> = {}): SpendFact {
    return {
        date: '2026-08-05T00:00:00+05:30',
        channel: 'Paid Ads' as Channel,
        micromarket: 'Powai',
        rawSource: 'meta',
        spendInr: 1000,
        impressions: 0,
        clicks: 0,
        ...over,
    }
}

const AUG = { from: '2026-08-01', to: '2026-08-31' }
const run = (left: SpendFact[], right: SpendFact[]) =>
    reconcile({ label: 'snapshot', facts: left }, { label: 'ledger', facts: right }, AUG)

describe('dayOf', () => {
    it('reads the IST calendar day from both formats without a timezone shift', () => {
        // The snapshot writes a full IST-midnight ISO; the ledger writes a bare day. new Date()
        // would read the bare form as UTC midnight and move it 5.5 hours — slicing must not.
        expect(dayOf(fact({ date: '2026-08-05T00:00:00+05:30' }))).toBe('2026-08-05')
        expect(dayOf(fact({ date: '2026-08-05' }))).toBe('2026-08-05')
    })
})

describe('sourceKey', () => {
    it('collapses the sheet and Zoho spellings of one source', () => {
        expect(sourceKey('google ads')).toBe(sourceKey('google_ads'))
        expect(sourceKey('99 Acres')).toBe(sourceKey('99acres'))
        expect(sourceKey('Housing.com')).toBe('housingcom')
    })

    it('keeps genuinely different sources apart', () => {
        expect(sourceKey('Society Data')).not.toBe(sourceKey('Society Data - WA Blast'))
    })
})

describe('reconcile', () => {
    it('reports a zero gap when both sides agree', () => {
        const r = run([fact()], [fact({ date: '2026-08-05' })])
        expect(r.total.left).toBe(1000)
        expect(r.total.right).toBe(1000)
        expect(r.total.diff).toBe(0)
        expect(r.total.pct).toBe(0)
        expect(r.onlyLeft).toEqual([])
        expect(r.onlyRight).toEqual([])
    })

    it('signs diff as "how much more the ledger says"', () => {
        const r = run([fact({ spendInr: 1000 })], [fact({ spendInr: 1250 })])
        expect(r.total.diff).toBe(250)
        expect(r.total.pct).toBeCloseTo(25, 5)
    })

    it('matches one source across the sheet-vs-Zoho spelling gap', () => {
        // The snapshot says `google ads`; the ledger says `google_ads`. One row, not two halves.
        const r = run([fact({ rawSource: 'google ads' })], [fact({ rawSource: 'google_ads' })])
        expect(r.bySource).toHaveLength(1)
        expect(r.bySource[0]!.diff).toBe(0)
        expect(r.bySource[0]!.leftRaw).toBe('google ads')
        expect(r.bySource[0]!.rightRaw).toBe('google_ads')
        expect(r.onlyLeft).toEqual([])
        expect(r.onlyRight).toEqual([])
    })

    it('names a source present on one side only, and still counts its money', () => {
        const r = run([fact({ rawSource: 'housing', spendInr: 5000 })], [fact({ rawSource: 'meta', spendInr: 800 })])
        expect(r.onlyLeft).toEqual(['housing'])
        expect(r.onlyRight).toEqual(['meta'])
        const housing = r.bySource.find((d) => d.leftRaw === 'housing')!
        expect(housing.left).toBe(5000)
        expect(housing.right).toBe(0)
        expect(housing.diff).toBe(-5000)
    })

    it('gives pct null, not Infinity, when the baseline side has nothing', () => {
        const r = run([], [fact({ spendInr: 900 })])
        expect(r.total.left).toBe(0)
        expect(r.total.diff).toBe(900)
        expect(r.total.pct).toBeNull()
    })

    it('keeps the unallocated bucket as its own row rather than dropping it', () => {
        const r = run([fact({ micromarket: null, spendInr: 4000 })], [fact({ micromarket: null, spendInr: 4000 })])
        expect(r.byMicromarket.map((d) => d.key)).toContain('(unallocated)')
    })

    it('sorts breakdowns by absolute rupee difference, largest first', () => {
        const left = [
            fact({ channel: 'Paid Ads' as Channel, spendInr: 1000 }),
            fact({ channel: '3P' as Channel, spendInr: 1000 }),
            fact({ channel: 'Offline Branding' as Channel, spendInr: 1000 }),
        ]
        const right = [
            fact({ channel: 'Paid Ads' as Channel, spendInr: 1010 }),
            fact({ channel: '3P' as Channel, spendInr: 1500 }),
            fact({ channel: 'Offline Branding' as Channel, spendInr: 900 }),
        ]
        expect(run(left, right).byChannel.map((d) => d.key)).toEqual(['3P', 'Offline Branding', 'Paid Ads'])
    })

    it('orders the day breakdown chronologically, not by size', () => {
        const left = [fact({ date: '2026-08-02', spendInr: 100 }), fact({ date: '2026-08-01', spendInr: 100 })]
        const right = [fact({ date: '2026-08-02', spendInr: 900 }), fact({ date: '2026-08-01', spendInr: 100 })]
        expect(run(left, right).byDay.map((d) => d.key)).toEqual(['2026-08-01', '2026-08-02'])
    })

    it('sums several facts into one bucket rather than replacing them', () => {
        const r = run([fact({ spendInr: 600 }), fact({ spendInr: 400 })], [fact({ date: '2026-08-05', spendInr: 1000 })])
        expect(r.total.diff).toBe(0)
        expect(r.byChannel).toHaveLength(1)
    })
})

describe('withinWindow', () => {
    it('includes both endpoints and excludes either side of them', () => {
        const facts = [
            fact({ date: '2026-07-31' }),
            fact({ date: '2026-08-01' }),
            fact({ date: '2026-08-31T00:00:00+05:30' }),
            fact({ date: '2026-09-01' }),
        ]
        expect(withinWindow(facts, '2026-08-01', '2026-08-31').map(dayOf)).toEqual(['2026-08-01', '2026-08-31'])
    })
})
