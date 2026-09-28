import { writeFileSync } from 'node:fs'
import type { SpendFact } from '../lib/buyer/facts'
import { type LedgerFact, fetchLedgerRaw } from '../lib/buyer/spend/ledger'
import buyerSnapshot from '../lib/buyer/spend/spend-jas26.json'
import { VALID_MICROMARKETS, fixMicromarket, mapChannel } from '../lib/buyer/shared'
import sellerSnapshot from '../lib/seller/spend/spend-jas26.json'
import { resolveSellerMicromarket } from '../lib/seller/spend/parse'
import { mapSellerChannel } from '../lib/seller/shared'
import { type Delta, type Reconciliation, reconcile, withinWindow } from '../lib/spend/reconcile'

// Does the growth ledger report the same spend as the committed snapshot, for a month the growth
// team has already reconciled?
//
// This is the gate on switching the dashboard fully onto the ledger. Run it before trusting the
// swap, not after:
//
//   pnpm reconcile:spend
//   pnpm reconcile:spend -- --from 2026-07-01 --to 2026-07-31 --side buyer
//
// Credentials come from .env via node --env-file (see package.json). The key is never printed,
// including on an error path.

const PURPOSES = ['BUYER', 'SELLER', 'BRANDING', 'CHANNEL_PARTNER', 'HOME_LOANS'] as const

interface Args {
    from: string
    to: string
    side: 'buyer' | 'seller' | 'both'
    tolerance: number
    out: string | null
}

function parseArgs(argv: string[]): Args {
    const get = (name: string): string | null => {
        const i = argv.indexOf(`--${name}`)
        return i >= 0 && argv[i + 1] ? argv[i + 1]! : null
    }
    const side = (get('side') ?? 'both') as Args['side']
    if (!['buyer', 'seller', 'both'].includes(side)) throw new Error(`--side must be buyer, seller or both`)
    // August by default: fully in the past, so the ledger's future-dated 3P rows (a billing
    // period is written across all its days at entry) cannot distort the comparison.
    return {
        from: get('from') ?? '2026-08-01',
        to: get('to') ?? '2026-08-31',
        side,
        tolerance: Number(get('tolerance') ?? '0.5'),
        out: get('out'),
    }
}

const inr = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
const signed = (n: number) => `${n >= 0 ? '+' : '−'}${inr(Math.abs(n))}`
const pctOf = (d: Delta) => (d.pct === null ? '—' : `${d.pct >= 0 ? '+' : '−'}${Math.abs(d.pct).toFixed(1)}%`)

/** The ledger's rows in the BUYER taxonomy — the same mapping lib/buyer/spend/ledger.ts applies. */
function mapBuyer(rows: LedgerFact[]): SpendFact[] {
    return rows.map((r) => {
        const fixed = fixMicromarket(r.micromarket)
        return {
            date: r.date,
            channel: mapChannel((r.source ?? '').trim()) ?? 'Unmapped',
            micromarket: VALID_MICROMARKETS.has(fixed) ? fixed : null,
            rawSource: (r.source ?? '').trim().toLowerCase(),
            spendInr: r.spendInr,
            impressions: r.impressions,
            clicks: r.clicks,
        }
    })
}

/** The ledger's rows in the SELLER taxonomy. A different channel map, a different micromarket
 *  list, and the `All MM` / `Anthens` rules — reused from the seller parser rather than
 *  re-implemented, so the comparison cannot report a difference it created itself. */
function mapSeller(rows: LedgerFact[]): SpendFact[] {
    return rows.map((r) => {
        const raw = (r.source ?? '').trim()
        return {
            date: r.date,
            channel: (mapSellerChannel(raw) ?? 'Unmapped') as SpendFact['channel'],
            micromarket: resolveSellerMicromarket(r.micromarket).micromarket,
            rawSource: raw.toLowerCase(),
            spendInr: r.spendInr,
            impressions: r.impressions,
            clicks: r.clicks,
        }
    })
}

function table(title: string, rows: Delta[], leftLabel: string, rightLabel: string): string[] {
    if (rows.length === 0) return [`### ${title}`, '', '_nothing on either side_', '']
    const lines = [
        `### ${title}`,
        '',
        `| key | ${leftLabel} | ${rightLabel} | diff | % |`,
        '| --- | ---: | ---: | ---: | ---: |',
    ]
    for (const d of rows) {
        const spellings = d.leftRaw && d.rightRaw && d.leftRaw !== d.rightRaw ? ` _(${d.leftRaw} / ${d.rightRaw})_` : ''
        lines.push(`| ${d.key}${spellings} | ${inr(d.left)} | ${inr(d.right)} | ${signed(d.diff)} | ${pctOf(d)} |`)
    }
    lines.push('')
    return lines
}

function report(r: Reconciliation, tolerance: number): { lines: string[]; pass: boolean } {
    const within = r.total.pct !== null && Math.abs(r.total.pct) <= tolerance
    // A zero baseline cannot be "within tolerance" — nothing to be within. Called out, not passed.
    const pass = r.total.left > 0 && within
    const lines = [
        `## ${r.leftLabel} vs ${r.rightLabel} — ${r.window.from} to ${r.window.to}`,
        '',
        `| | ${r.leftLabel} | ${r.rightLabel} | diff | % |`,
        '| --- | ---: | ---: | ---: | ---: |',
        `| **TOTAL** | ${inr(r.total.left)} | ${inr(r.total.right)} | ${signed(r.total.diff)} | ${pctOf(r.total)} |`,
        '',
        pass
            ? `**PASS** — inside the ${tolerance}% tolerance.`
            : r.total.left === 0
              ? `**NO BASELINE** — the snapshot has no spend in this window, so there is nothing to reconcile against.`
              : `**FAIL** — outside the ${tolerance}% tolerance.`,
        '',
    ]
    if (r.onlyLeft.length > 0) lines.push(`Only in ${r.leftLabel}: ${r.onlyLeft.join(', ')}`, '')
    if (r.onlyRight.length > 0) lines.push(`Only in ${r.rightLabel}: ${r.onlyRight.join(', ')}`, '')
    lines.push(
        ...table('By channel', r.byChannel, r.leftLabel, r.rightLabel),
        ...table('By source', r.bySource, r.leftLabel, r.rightLabel),
        ...table('By micromarket', r.byMicromarket, r.leftLabel, r.rightLabel),
        ...table(
            'By day (non-zero differences only)',
            r.byDay.filter((d) => Math.abs(d.diff) > 0.005),
            r.leftLabel,
            r.rightLabel
        )
    )
    return { lines, pass }
}

/** How much spend each purpose holds, and how much holds none at all.
 *
 *  `activityPurpose` is nullable on the ledger, so a row whose purpose was never set is returned
 *  under NO purpose filter. fetchLedgerSpend asks for BUYER, so that money is silently absent
 *  from the dashboard. This is the first number to read when buyer comes up short. */
async function purposeAudit(from: string, to: string): Promise<string[]> {
    const lines = ['## Purpose audit', '']
    const totals = new Map<string, number>()
    for (const p of PURPOSES) {
        const raw = await fetchLedgerRaw(from, to, p)
        if ('error' in raw) return [...lines, `Could not read the ledger: ${raw.error}`, '']
        totals.set(
            p,
            raw.payload.facts.reduce((s, f) => s + f.spendInr, 0)
        )
    }
    const all = await fetchLedgerRaw(from, to, null)
    if ('error' in all) return [...lines, `Could not read the ledger unfiltered: ${all.error}`, '']
    const unfiltered = all.payload.facts.reduce((s, f) => s + f.spendInr, 0)
    const named = [...totals.values()].reduce((a, b) => a + b, 0)
    const unattributed = unfiltered - named

    lines.push('| purpose | spend |', '| --- | ---: |')
    for (const [p, v] of totals) lines.push(`| ${p} | ${inr(v)} |`)
    lines.push(
        `| **sum of named** | ${inr(named)} |`,
        `| **unfiltered** | ${inr(unfiltered)} |`,
        `| **unattributed (null purpose)** | ${inr(unattributed)} |`,
        ''
    )
    lines.push(
        unattributed > 0.005
            ? `${inr(unattributed)} carries no \`activityPurpose\`, so no purpose filter returns it and the dashboard never sees it.`
            : 'Every ledger row in this window carries a purpose.',
        ''
    )
    return lines
}

async function sideReport(
    side: 'buyer' | 'seller',
    args: Args
): Promise<{ lines: string[]; pass: boolean } | { lines: string[]; pass: null }> {
    const snapshotFacts = (side === 'buyer' ? buyerSnapshot.facts : sellerSnapshot.facts) as SpendFact[]
    const purpose = side === 'buyer' ? 'BUYER' : 'SELLER'
    const raw = await fetchLedgerRaw(args.from, args.to, purpose)
    if ('error' in raw) {
        return { lines: [`## ${side} — could not read the ledger`, '', raw.error, ''], pass: null }
    }
    const ledgerFacts = side === 'buyer' ? mapBuyer(raw.payload.facts) : mapSeller(raw.payload.facts)
    const r = reconcile(
        { label: 'snapshot', facts: withinWindow(snapshotFacts, args.from, args.to) },
        { label: `ledger (${purpose})`, facts: withinWindow(ledgerFacts, args.from, args.to) },
        { from: args.from, to: args.to }
    )
    const out = report(r, args.tolerance)
    return { lines: [`# ${side.toUpperCase()}`, '', ...out.lines], pass: out.pass }
}

/** Where this ran against, and what the ledger actually holds.
 *
 *  Printed first and always. A reconciliation that comes back all zeroes is unreadable without
 *  it: the first run of this script reported a 100% gap for August, which turned out to mean the
 *  configured ledger was STAGING and held September only. Host, not the key, and never the key. */
async function coverage(from: string, to: string): Promise<string[]> {
    const base = process.env.GROWTH_LEDGER_BASE_URL ?? ''
    let host = '(unset)'
    try {
        host = new URL(base).host
    } catch {
        host = base ? '(unparseable)' : '(unset)'
    }
    const lines = ['## Ledger coverage', '', `- host: \`${host}\``]
    // Deliberately wider than the requested window, to show whether the window is empty because
    // the ledger is empty or because that particular month was never loaded.
    const wide = await fetchLedgerRaw('2026-01-01', '2026-12-31', null)
    if ('error' in wide) return [...lines, `- could not read the ledger: ${wide.error}`, '']
    const facts = wide.payload.facts
    if (facts.length === 0) return [...lines, '- the ledger holds no rows at all for 2026', '']
    const days = facts.map((f) => f.date).sort()
    const byMonth = new Map<string, number>()
    for (const f of facts) byMonth.set(f.date.slice(0, 7), (byMonth.get(f.date.slice(0, 7)) ?? 0) + f.spendInr)
    lines.push(
        `- rows in 2026: ${days[0]} to ${days[days.length - 1]}`,
        `- by month: ${[...byMonth.entries()]
            .sort()
            .map(([m, v]) => `${m} ${inr(v)}`)
            .join(', ')}`,
        `- last ingest run: ${wide.payload.ingest?.lastRunAt ?? 'never'}`
    )
    const failed = wide.payload.ingest?.failedSources ?? []
    if (failed.length > 0) {
        lines.push(
            // `failedSources` groups every ingest run in the window, so this says a run failed
            // somewhere in the period — not that the last one did, and not that anything is
            // short. Measured 18 Sep: one failed run around 15 Sep flagged both ad sources for
            // every window containing that day, while spend had landed on all of them. Calling
            // it a live outage sent a reader hunting for a gap that was not there.
            `- an ingest run failed for **${failed.join(', ')}** somewhere in this period — worth checking if a gap below is unexplained, but a failed run is normally retried`
        )
    }
    if (!byMonth.has(from.slice(0, 7))) {
        lines.push(
            `- **the requested window (${from} to ${to}) is not in the ledger at all** — the comparison below cannot mean anything until it is loaded`
        )
    }
    lines.push('')
    return lines
}

async function main() {
    const args = parseArgs(process.argv.slice(2))
    const sides: Array<'buyer' | 'seller'> = args.side === 'both' ? ['buyer', 'seller'] : [args.side]

    const lines = [
        `# Spend reconciliation — ${args.from} to ${args.to}`,
        '',
        `Committed snapshot vs the growth activity ledger. Tolerance ${args.tolerance}% on the total.`,
        '',
        '`diff` is right minus left, so a positive number means the LEDGER reports more.',
        '',
    ]
    lines.push(...(await coverage(args.from, args.to)))
    let failed = false
    for (const side of sides) {
        const out = await sideReport(side, args)
        lines.push(...out.lines)
        if (out.pass === false || out.pass === null) failed = true
    }
    lines.push(...(await purposeAudit(args.from, args.to)))

    const text = lines.join('\n')
    console.log(text)
    if (args.out) {
        writeFileSync(args.out, text)
        console.log(`\nwrote ${args.out}`)
    }
    if (failed) {
        console.error('\nReconciliation did not pass. The dashboard should not be switched fully onto the ledger yet.')
        process.exitCode = 1
    }
}

void main()
