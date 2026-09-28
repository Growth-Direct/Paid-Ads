import type { SpendFact, SpendIngest } from '../facts'
import { VALID_MICROMARKETS, fixMicromarket, mapChannel } from '../shared'

// The growth activity ledger, read live, mapped to the same SpendFact shape the committed
// snapshot produces. This is the swap TECH-1227 asks for: one source of growth spend, so no
// second pipeline exists to diverge from it.
//
// The ledger serves day × source × micromarket and its own `source` value — the Zoho Lead_Source
// spelling, character for character. Channel is applied HERE, through the same mapChannel() the
// sheet parser uses, because "Paid Ads" / "3P" / "Offline Branding" are this dashboard's
// taxonomy and belong in one place: the repo that renders them.
//
// Every row that comes back is kept. A source we cannot map lands under Unmapped and is named in
// the ingest block; a micromarket we do not recognise lands in the unallocated bucket and is
// named too. Dropping either would lose real money to make a chart tidy.

/** Ledger rows are days; a day is only ever this shape. */
const IS_DAY = /^\d{4}-\d{2}-\d{2}$/

export interface LedgerFact {
    date: string
    source: string
    micromarket: string | null
    spendInr: number
    impressions: number
    clicks: number
    rows: number
}

export interface LedgerResponse {
    from: string
    to: string
    facts: LedgerFact[]
    ingest: {
        rowsRead: number
        groups: number
        lastRunAt: string | null
        failedSources: string[]
        truncated: boolean
    }
}

export interface LedgerSpend {
    facts: SpendFact[]
    ingest: SpendIngest
}

/**
 * Where the ledger lives, and the key to read it with.
 *
 * Read at call time rather than at module load: a missing var must degrade this one block to
 * "unavailable" and leave the rest of the dashboard rendering, not throw during import and take
 * the whole page down.
 */
function config(): { baseUrl: string; apiKey: string } | null {
    const baseUrl = process.env.GROWTH_LEDGER_BASE_URL?.replace(/\/$/, '')
    const apiKey = process.env.GROWTH_LEDGER_API_KEY
    if (!baseUrl || !apiKey) return null
    return { baseUrl, apiKey }
}

/**
 * The kill switch: `GROWTH_LEDGER_ENABLED=false` serves the committed snapshot instead.
 *
 * **Default on, deliberately.** The ledger is already the live source wherever the two vars are
 * set, so a flag that defaulted off would turn it off on the next deploy — a behaviour change
 * nobody asked for, arriving silently. What is wanted here is the other direction: one env var
 * to flip back to the snapshot in a hurry, without pulling the credentials out and without a
 * deploy of code.
 *
 * Only these four spellings turn it off. An unrecognised value leaves the ledger on rather than
 * off, because a typo in an env var must not quietly change where money comes from.
 */
const OFF = new Set(['false', '0', 'off', 'no'])

export function ledgerEnabled(): boolean {
    const flag = process.env.GROWTH_LEDGER_ENABLED?.trim().toLowerCase()
    return !(flag && OFF.has(flag))
}

/**
 * True when the ledger should be read: switched on, and configured to reach.
 *
 * The two are separate facts and stay separate. "Turned off on purpose" and "never given a URL"
 * want different words in the ingest block, and `source.ts` distinguishes them.
 */
export function ledgerConfigured(): boolean {
    return ledgerEnabled() && config() !== null
}

function unavailable(error: string): LedgerSpend {
    return {
        facts: [],
        ingest: {
            status: 'unavailable',
            error,
            rowsRead: 0,
            rowsKept: 0,
            droppedBadDate: 0,
            droppedBadSpend: 0,
            unmappedSources: [],
            unknownMicromarkets: [],
            origin: 'ledger',
            builtAt: null,
        },
    }
}

/**
 * The ledger's own rows for a window, untouched.
 *
 * Split out of fetchLedgerSpend so a caller can see what the ledger actually said before this
 * repo's buyer taxonomy is applied to it. scripts/reconcile-spend.ts needs exactly that: it
 * compares the ledger against the committed snapshot under BOTH the buyer and the seller
 * mappings, and a function that had already folded sources into buyer channels could not answer
 * the seller question or show which raw Zoho spelling a group came from.
 *
 * Returns a discriminated result rather than throwing, because every caller here turns a failure
 * into a visible gap in the spend block instead of an exception.
 */
export async function fetchLedgerRaw(
    from: string,
    to: string,
    purpose: string | null = 'BUYER'
): Promise<{ payload: LedgerResponse } | { error: string }> {
    const cfg = config()
    if (!cfg) return { error: 'Growth ledger is not configured (GROWTH_LEDGER_BASE_URL / _API_KEY)' }

    const qs = new URLSearchParams({ from, to })
    if (purpose) qs.set('purpose', purpose)

    try {
        // Bounded: a hung ledger must not hold the whole facts build open. The dashboard renders
        // with a visible spend gap instead, which is the behaviour the ingest block exists for.
        const res = await fetch(`${cfg.baseUrl}/api/growth-activities/spend?${qs}`, {
            headers: { 'x-api-key': cfg.apiKey },
            signal: AbortSignal.timeout(15_000),
            cache: 'no-store',
        })
        // The status only. A body could echo the query string back, and the key is a header, but
        // there is no reason for a diagnostic path to widen what an error message can carry.
        if (!res.ok) return { error: `Growth ledger responded ${res.status}` }
        const payload = (await res.json()) as LedgerResponse
        if (!Array.isArray(payload?.facts)) return { error: 'Growth ledger returned an unexpected shape' }
        return { payload }
    } catch (error) {
        return { error: error instanceof Error ? error.message : 'Growth ledger unreachable' }
    }
}

/**
 * Buyer spend for a window, out of the ledger, in this dashboard's own taxonomy.
 *
 * `purpose` defaults to Buyer, which is the one judgement call in this swap: the committed
 * snapshot was built from the growth team's buyer tab, and the ledger holds seller, brand,
 * channel-partner and home-loan activity in the same table. Buyer-only is what reproduces
 * today's numbers. Pass null to total everything.
 *
 * Note `activityPurpose` is NULLABLE on the ledger, so a row whose purpose was never set is not
 * returned under any purpose filter. scripts/reconcile-spend.ts measures how much that is.
 */
export async function fetchLedgerSpend(
    from: string,
    to: string,
    purpose: string | null = 'BUYER'
): Promise<LedgerSpend> {
    const raw = await fetchLedgerRaw(from, to, purpose)
    if ('error' in raw) return unavailable(raw.error)
    const payload = raw.payload

    const agg = new Map<string, SpendFact>()
    const unmapped = new Set<string>()
    const unknownMm = new Set<string>()
    let droppedBadDate = 0
    let kept = 0

    for (const row of payload.facts) {
        if (!IS_DAY.test(row.date ?? '')) {
            droppedBadDate++
            continue
        }

        // mapChannel returns null for the sources excluded from DRR scope entirely. Spend on one
        // of those is money that was still spent, so it is kept under Unmapped and named below
        // rather than dropped.
        const rawSource = (row.source ?? '').trim()
        const channel = mapChannel(rawSource) ?? 'Unmapped'
        if (channel === 'Unmapped' && rawSource) unmapped.add(rawSource)

        const fixed = fixMicromarket(row.micromarket)
        let micromarket: string | null = null
        if (VALID_MICROMARKETS.has(fixed)) micromarket = fixed
        else if (fixed) unknownMm.add(fixed)

        // Two ledger sources can fold onto one channel and one label, so groups are SUMMED on
        // collision, never replaced — the same rule the sheet parser applies, for the same
        // reason: dropping one understates spend, which is the direction that flatters CPL.
        const key = `${row.date}|${channel}|${micromarket ?? ''}|${rawSource.toLowerCase()}`
        const existing = agg.get(key)
        if (existing) {
            existing.spendInr += row.spendInr
            existing.impressions += row.impressions
            existing.clicks += row.clicks
        } else {
            agg.set(key, {
                date: row.date,
                channel,
                micromarket,
                rawSource: rawSource.toLowerCase(),
                spendInr: row.spendInr,
                impressions: row.impressions,
                clicks: row.clicks,
            })
        }
        kept += row.rows ?? 1
    }

    // A failed pull on the growth side is a gap in the numbers even though this request
    // succeeded, so it is surfaced as an error rather than left to look like a quiet week.
    // `failedSources` is grouped over EVERY ingest run in the requested window, so it means "at
    // least one run for this source failed somewhere in this period" — not "the most recent run
    // failed", and not that anything is missing: a failed run is usually retried and succeeds.
    // Measured 18 Sep 2026: a single failed run on ~15 Sep put both ad sources in this list for
    // every window containing that day, while 17-18 Sep alone returned []. Ad spend had landed
    // on all of those days. Wording it as a live outage turned a recovered blip into a standing
    // alarm, which is the state a signal stops being read in.
    const failed = payload.ingest?.failedSources ?? []
    const truncated = payload.ingest?.truncated ?? false
    const notes = [
        failed.length > 0 ? `An ingest run failed for ${failed.join(', ')} during this period` : null,
        truncated ? 'Ledger response was truncated — the range is too wide' : null,
    ].filter((n): n is string => n !== null)

    return {
        facts: [...agg.values()],
        ingest: {
            status: 'ok',
            error: notes.length > 0 ? notes.join('. ') : null,
            rowsRead: payload.ingest?.rowsRead ?? kept,
            rowsKept: kept,
            droppedBadDate,
            droppedBadSpend: 0,
            unmappedSources: [...unmapped].slice(0, 20),
            unknownMicromarkets: [...unknownMm].slice(0, 20),
            // When the ledger last pulled, not when this page rendered — the footer says how
            // fresh spend is, and a request timestamp would always claim "just now".
            origin: 'ledger',
            builtAt: payload.ingest?.lastRunAt ?? null,
        },
    }
}
