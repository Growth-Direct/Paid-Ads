import type { SpendFact } from '@/lib/buyer/facts'

// Compares two sets of SpendFacts for the same window and says where the money differs.
//
// Built to answer one question before the dashboard is switched fully onto the growth ledger:
// does the ledger report what the committed snapshot reports, for a month the growth team has
// already reconciled? A total that matches is not enough on its own — two sides can agree in
// total and disagree on every channel — so every breakdown is reported separately.
//
// Pure. No network, no clock, no env. scripts/reconcile-spend.ts does the I/O.

export interface SpendSide {
    label: string
    facts: SpendFact[]
}

export interface Delta {
    key: string
    /** The raw values behind `key` on each side, when they were spelled differently. */
    leftRaw?: string
    rightRaw?: string
    left: number
    right: number
    /** right − left. Positive means the right side (the ledger) reports MORE. */
    diff: number
    /** diff as a share of left, or null when left is 0 — never render a divide-by-zero. */
    pct: number | null
}

export interface Reconciliation {
    window: { from: string; to: string }
    leftLabel: string
    rightLabel: string
    total: Delta
    byChannel: Delta[]
    bySource: Delta[]
    byMicromarket: Delta[]
    byDay: Delta[]
    /** Keys that carry spend on one side and nothing at all on the other. */
    onlyLeft: string[]
    onlyRight: string[]
}

/** The IST calendar day a fact belongs to.
 *
 *  Both formats in play start with that date: the snapshot writes a full IST-midnight ISO
 *  (`2026-08-05T00:00:00+05:30`) and the ledger writes a bare `2026-08-05`. Slicing is therefore
 *  correct for each without a timezone conversion — and deliberately avoids `new Date()`, which
 *  reads the ledger's bare form as UTC midnight and would shift it 5.5 hours. */
export function dayOf(fact: SpendFact): string {
    return fact.date.slice(0, 10)
}

/** Source names collapsed for comparison: lowercased, non-alphanumerics stripped.
 *
 *  The two sides do not spell sources the same way. The snapshot carries the growth sheet's
 *  `UTM Source`; the ledger carries Zoho's `Lead_Source`. `google ads` and `google_ads` are the
 *  same spend and must not read as two missing rows. The raw spellings are kept on the Delta so
 *  the real vocabulary gap stays visible rather than being normalised out of the report. */
export function sourceKey(raw: string): string {
    return raw.toLowerCase().replace(/[^a-z0-9]/g, '')
}

interface Bucket {
    left: number
    right: number
    leftRaw?: string
    rightRaw?: string
}

function emptyBucket(): Bucket {
    return { left: 0, right: 0 }
}

function toDelta(key: string, b: Bucket): Delta {
    const diff = b.right - b.left
    return {
        key,
        ...(b.leftRaw !== undefined ? { leftRaw: b.leftRaw } : {}),
        ...(b.rightRaw !== undefined ? { rightRaw: b.rightRaw } : {}),
        left: b.left,
        right: b.right,
        diff,
        // Null, not 0 and not Infinity: "the left side had nothing here" is a different statement
        // from "they differ by 0%", and the report should not blur them.
        pct: b.left === 0 ? null : (diff / b.left) * 100,
    }
}

/** Largest absolute rupee difference first, so the biggest contributor to the gap is the first
 *  line read. Ties break on key for a stable, diffable report. */
function bySize(a: Delta, b: Delta): number {
    return Math.abs(b.diff) - Math.abs(a.diff) || a.key.localeCompare(b.key)
}

function group(
    left: SpendFact[],
    right: SpendFact[],
    keyOf: (f: SpendFact) => string,
    rawOf?: (f: SpendFact) => string
): Delta[] {
    const buckets = new Map<string, Bucket>()
    const put = (facts: SpendFact[], side: 'left' | 'right') => {
        for (const f of facts) {
            const key = keyOf(f)
            const b = buckets.get(key) ?? emptyBucket()
            b[side] += f.spendInr
            if (rawOf) {
                const rawField = side === 'left' ? 'leftRaw' : 'rightRaw'
                // First spelling seen wins; they are the same key by construction.
                b[rawField] ??= rawOf(f)
            }
            buckets.set(key, b)
        }
    }
    put(left, 'left')
    put(right, 'right')
    return (
        [...buckets.entries()]
            .map(([k, b]) => toDelta(k, b))
            // A key that is zero on both sides is not a finding, it is noise. The ledger returns
            // groups whose spend summed to nothing, and a report padded with them buries the rows
            // that matter.
            .filter((d) => d.left !== 0 || d.right !== 0)
            .sort(bySize)
    )
}

const sum = (facts: SpendFact[]) => facts.reduce((s, f) => s + f.spendInr, 0)

/** `left` is the baseline (the reconciled snapshot); `right` is what is being tested (the
 *  ledger). Every `diff` therefore reads as "how much more the ledger says". */
export function reconcile(left: SpendSide, right: SpendSide, window: { from: string; to: string }): Reconciliation {
    const byChannel = group(left.facts, right.facts, (f) => f.channel)
    const bySource = group(
        left.facts,
        right.facts,
        (f) => sourceKey(f.rawSource),
        (f) => f.rawSource
    )
    // The unallocated bucket is a real answer, not a missing value, so it gets its own row rather
    // than being dropped — it is ~20% of seller spend and excluded by any place filter.
    const byMicromarket = group(left.facts, right.facts, (f) => f.micromarket ?? '(unallocated)')
    const byDay = group(left.facts, right.facts, dayOf).sort((a, b) => a.key.localeCompare(b.key))

    // Presence is judged on the source breakdown: a source on one side and absent on the other is
    // the finding that matters, and channel is too coarse to show it.
    const onlyLeft = bySource.filter((d) => d.right === 0 && d.left !== 0).map((d) => d.leftRaw ?? d.key)
    const onlyRight = bySource.filter((d) => d.left === 0 && d.right !== 0).map((d) => d.rightRaw ?? d.key)

    return {
        window,
        leftLabel: left.label,
        rightLabel: right.label,
        total: toDelta('TOTAL', { left: sum(left.facts), right: sum(right.facts) }),
        byChannel,
        bySource,
        byMicromarket,
        byDay,
        onlyLeft,
        onlyRight,
    }
}

/** Facts inside an inclusive IST day range. Both sides are filtered with this, so neither can
 *  quietly contribute a row the other's window excluded. */
export function withinWindow(facts: SpendFact[], from: string, to: string): SpendFact[] {
    return facts.filter((f) => {
        const d = dayOf(f)
        return d >= from && d <= to
    })
}
