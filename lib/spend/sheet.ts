// Format primitives for the growth team's spend workbook (Spends_Structure.xlsx), shared by
// the buyer and seller parsers. Nothing here knows about channels, micromarkets or either
// side's taxonomy — that lives in lib/buyer/spend/parse.ts and lib/seller/spend/parse.ts.
//
// These were written inside the buyer parser first and moved here verbatim when the seller
// tab needed them. __tests__/spend-parse.test.ts still exercises them through their buyer
// re-exports, unedited, which is what proves the move changed no behaviour.

const MONTHS: Record<string, number> = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
}

/** Header text normalised for matching: trimmed, lowercased, runs of whitespace and
 *  underscores collapsed to one space. Columns are matched on this, never on position. */
export const norm = (h: string) => h.trim().toLowerCase().replace(/[\s_]+/g, ' ')

/** Which component of a `d/d/y` date is the month. There is no way to tell from a single
 *  value — `06/01/26` is 1 Jun under MDY and 6 Jan under DMY — so each tab states the order
 *  it was proved to use rather than inheriting a guess. Passing null makes every slash date
 *  unparseable, so it gets dropped and counted instead of silently misdated. */
export type SlashOrder = 'MDY' | 'DMY'

/** The workbook mixes date formats, and they differ per tab:
 *  - `D-Mon-YYYY` (e.g. 1-Aug-2026) — the hand-typed offline rows. Unambiguous.
 *  - `M/D/YYYY` or `D/M/YYYY` (e.g. 8/7/2026) — the ad-platform exports.
 *  - the same slash form with a two-digit year (e.g. 6/1/26), resolved as 2000 + yy.
 *
 *  `slashOrder` decides the two slash forms; see SlashOrder for why it is explicit. The buyer
 *  tab is MDY, proved against the file: its first slash component never exceeds 12 while the
 *  second reaches 31.
 *
 *  Returns an IST-midnight ISO so a spend day buckets with the same mondayOfIST/monthOfIST
 *  logic as leads, or null on anything else. */
export function parseSheetDate(raw: string, slashOrder: SlashOrder | null = 'MDY'): string | null {
    const s = raw.trim()
    const iso = (y: number, mon0: number, day: number) =>
        `${y}-${String(mon0 + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}T00:00:00+05:30`

    // The month is NAMED here, so unlike the slash forms there is no day/month ambiguity to
    // resolve — only the year. A two-digit year (`1-Sep-26`) appeared in the buyer tab on
    // 2026-09-16 alongside the four-digit form and accounted for 29,127 rows, ₹9.2 L, all Meta
    // and Google Ads. Resolved as 20xx, the same rule the slash branch below already applies.
    const dmon = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2}|\d{4})$/)
    if (dmon) {
        const day = Number(dmon[1])
        const mon = MONTHS[dmon[2]!.toLowerCase()]
        if (mon === undefined || day < 1 || day > 31) return null
        const rawYear = dmon[3]!
        return iso(rawYear.length === 2 ? 2000 + Number(rawYear) : Number(rawYear), mon, day)
    }

    const slash = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/)
    if (slash) {
        if (slashOrder === null) return null
        const first = Number(slash[1])
        const second = Number(slash[2])
        const mon = slashOrder === 'MDY' ? first : second
        const day = slashOrder === 'MDY' ? second : first
        if (mon < 1 || mon > 12 || day < 1 || day > 31) return null
        // A two-digit year in this workbook is always 20xx — the sheet starts in 2026 and
        // nothing in it predates the company.
        const rawYear = slash[3]!
        const year = rawYear.length === 2 ? 2000 + Number(rawYear) : Number(rawYear)
        return iso(year, mon - 1, day)
    }

    return null
}

/** Minimal RFC-4180 CSV: quoted fields, embedded commas (the spend column is `"8,400.00"`),
 *  doubled quotes, and \n or \r\n. Enough for a Sheets export. Returns rows of cells. */
export function parseCsv(text: string): string[][] {
    const rows: string[][] = []
    let row: string[] = []
    let field = ''
    let q = false
    for (let i = 0; i < text.length; i++) {
        const c = text[i]
        if (q) {
            if (c === '"') {
                if (text[i + 1] === '"') {
                    field += '"'
                    i++
                } else q = false
            } else field += c
        } else if (c === '"') q = true
        else if (c === ',') {
            row.push(field)
            field = ''
        } else if (c === '\n' || c === '\r') {
            if (c === '\r' && text[i + 1] === '\n') i++
            row.push(field)
            field = ''
            if (row.length > 1 || row[0] !== '') rows.push(row)
            row = []
        } else field += c
    }
    if (field !== '' || row.length > 0) {
        row.push(field)
        if (row.length > 1 || row[0] !== '') rows.push(row)
    }
    return rows
}

/** Indian-grouped rupee strings: "1,23,456", "₹12,345.60", "" → 0. Non-numeric → null,
 *  which drops the row (never coerce garbage to a number). */
export function parseInr(raw: string): number | null {
    const s = raw.trim().replace(/[₹,\s]/g, '')
    if (s === '' || s === '-') return 0
    const n = Number(s)
    return Number.isFinite(n) ? n : null
}

/** Impressions/clicks. Laxer than parseInr on purpose: these are context, not money, so
 *  garbage becomes 0 rather than dropping the row and losing its spend alongside. */
export function parseCount(raw: string): number {
    const n = Number((raw ?? '').trim().replace(/[,\s]/g, ''))
    return Number.isFinite(n) ? n : 0
}

interface SlashOrderInference {
    /** The proved order, or null when the data cannot distinguish the two. */
    order: SlashOrder | null
    /** How many values matched the slash form at all. */
    slashRows: number
    maxFirst: number
    maxSecond: number
}

/** Proves the slash order from the data instead of trusting a hand-set constant: a component
 *  above 12 can only be a day. If the first component exceeds 12 the order is D/M; if the
 *  second does, it is M/D; if neither ever does, the file is genuinely ambiguous and this
 *  returns null so the caller can refuse rather than guess.
 *
 *  The buyer tab's order was established this way once, by hand, and then hardcoded. Doing
 *  it at build time instead means a tab that changes producer announces itself rather than
 *  quietly transposing every date's day and month. */
export function inferSlashOrder(dateStrings: Iterable<string>): SlashOrderInference {
    let slashRows = 0
    let maxFirst = 0
    let maxSecond = 0
    for (const raw of dateStrings) {
        const m = (raw ?? '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(?:\d{2}|\d{4})$/)
        if (!m) continue
        slashRows++
        maxFirst = Math.max(maxFirst, Number(m[1]))
        maxSecond = Math.max(maxSecond, Number(m[2]))
    }
    const firstIsDay = maxFirst > 12
    const secondIsDay = maxSecond > 12
    // Both above 12 is self-contradictory — a corrupt or mixed column, not an order to pick.
    const order: SlashOrder | null = firstIsDay === secondIsDay ? null : firstIsDay ? 'DMY' : 'MDY'
    return { order, slashRows, maxFirst, maxSecond }
}
