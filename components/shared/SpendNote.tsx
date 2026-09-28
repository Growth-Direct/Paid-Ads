'use client'

import { relativeTime } from '@/lib/shared/relativeTime'
import type { SpendOrigin } from '@/lib/spend/origin'

// The one-line provenance note under the Target vs Achieved table, on both tabs.
//
// Three things have to be visible or the Spend and cost-per rows above are unreadable:
//
//  1. WHERE THE NUMBER CAME FROM. The ledger and the committed snapshot disagree, on purpose —
//     the ledger is live and the snapshot is a hand-built file. Saying "snapshot built 18 Sep"
//     about a ledger number is not a small inaccuracy; it tells the reader to go and edit a
//     spreadsheet to correct something the spreadsheet no longer controls.
//
//  2. WHETHER THE NUMBER IS COMPLETE. `source.ts` deliberately does NOT fall back to the
//     snapshot when a ledger read fails, so that a gap is visible rather than papered over with
//     stale figures. That only works if something renders the gap. The ledger also returns
//     `status: 'ok'` WITH a note when one of its own ingest runs failed during the period, so
//     the note is rendered whenever it is set, not only when the read itself failed. Keying on
//     status alone silently swallows that case.
//
//     It is stated, NOT dressed as an outage. `failedSources` groups every run in the window, so
//     one failed run in July would otherwise show a red "spend is incomplete" banner until
//     October, over numbers that are complete. A warning that cannot be cleared is a warning
//     nobody reads.
//
//  3. HOW MUCH SPEND A PLACE FILTER DROPPED. Spend with no micromarket falls out of every
//     filtered view, so each cost-per metric is computed on a smaller numerator, which makes the
//     channel look CHEAPER than it is. Saying so is the difference between a caveat and a wrong
//     number.

const wrap: React.CSSProperties = {
    marginTop: 10,
    paddingTop: 8,
    borderTop: '1px solid #CCCCCC',
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 10.5,
    lineHeight: 1.6,
    color: '#333333',
}

/** The fields both tabs' ingest reports share. Narrowed so one component serves both. */
export interface SpendNoteIngest {
    status: 'ok' | 'unavailable' | 'schema-error'
    origin: SpendOrigin
    error: string | null
    droppedBadDate: number
    droppedBadSpend: number
    unmappedSources: string[]
    unknownMicromarkets: string[]
    builtAt: string | null
    /** Set when this window's Meta rows were overlaid with a live Graph API pull instead of
     *  coming from `origin` — see lib/buyer/spend/meta.ts. Absent/null on every other path. */
    metaLiveAsOf?: string | null
}

function inrShort(n: number): string {
    if (n >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`
    if (n >= 1e5) return `₹${(n / 1e5).toFixed(2)} L`
    return `₹${Math.round(n).toLocaleString('en-IN')}`
}

function onDate(iso: string | null): string | null {
    if (!iso) return null
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return null
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' })
}

export default function SpendNote({
    ingest,
    sheetName,
    excludedUnallocated = 0,
}: {
    ingest: SpendNoteIngest
    /** The tab of the growth team's workbook this side's snapshot is built from. */
    sheetName: string
    /** Spend dropped by the active place filter for having no micromarket. 0 without one. */
    excludedUnallocated?: number
}) {
    if (ingest.status !== 'ok') {
        return (
            <div style={{ ...wrap, color: '#DC2626' }}>
                Spend unavailable — {ingest.error ?? 'unknown error'}. Spend and cost rows show no data.
            </div>
        )
    }

    const when = onDate(ingest.builtAt)
    const parts: string[] = []
    if (ingest.origin === 'ledger') {
        parts.push(when ? `Spend from the growth activity ledger, last pulled ${when}.` : 'Spend from the growth activity ledger.')
    } else if (ingest.origin === 'sheet-live') {
        parts.push(
            when
                ? `Spend live from the "${sheetName}" sheet, pulled ${relativeTime(ingest.builtAt!)}.`
                : `Spend live from the "${sheetName}" sheet.`
        )
    } else {
        parts.push(when ? `Spend snapshot built ${when} from the "${sheetName}" sheet.` : `Spend from the "${sheetName}" sheet.`)
    }
    // Meta specifically is fresher than the sentence above says — named separately rather
    // than folded into `origin`, since every other source (3P, Offline, etc.) genuinely still
    // comes from origin and saying otherwise would misstate where THEIR numbers come from.
    // relativeTime, not onDate: this can be pulled many times a day, and "28 Sept" would throw
    // away the "just now" signal that's the whole point of it being live.
    if (ingest.metaLiveAsOf) {
        parts.push(`Meta is live via the Graph API, pulled ${relativeTime(ingest.metaLiveAsOf)}.`)
    }
    if (excludedUnallocated > 0) {
        parts.push(
            `${inrShort(excludedUnallocated)} carries no micromarket and is excluded by the current filter, so the cost-per rows read low.`
        )
    }
    // Anomalies someone can act on. Deliberately absent when clean, so that seeing anything
    // here means something needs attention.
    if (ingest.unknownMicromarkets.length > 0) {
        parts.push(`Unrecognised micromarket${ingest.unknownMicromarkets.length > 1 ? 's' : ''}: ${ingest.unknownMicromarkets.join(', ')}.`)
    }
    if (ingest.unmappedSources.length > 0) {
        parts.push(`Unmapped source${ingest.unmappedSources.length > 1 ? 's' : ''}: ${ingest.unmappedSources.join(', ')}.`)
    }
    if (ingest.droppedBadDate > 0 || ingest.droppedBadSpend > 0) {
        parts.push(`${ingest.droppedBadDate + ingest.droppedBadSpend} row(s) dropped for an unreadable date or amount.`)
    }

    return (
        <div style={wrap}>
            {/* The read succeeded but what it read is incomplete. Amber rather than red: the
                numbers above are real, they are just short by whatever the failed pull holds. */}
            {ingest.error ? <div style={{ color: '#D97706', marginBottom: 2 }}>{ingest.error}.</div> : null}
            {parts.join(' ')}
        </div>
    )
}
