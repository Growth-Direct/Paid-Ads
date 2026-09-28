import { airtableConfig } from './config'

// P0/P1/P2 priority per society, out of the Growth – Marketing base's "TQ Unit wise" table.
//
// Airtable is the degradable source of the two, deliberately. Priority is a label used for
// grouping, not a term in the ratio, so losing it costs the grouping and nothing else: every
// society still renders, with `priority: null` and a warning. Losing growth costs the numbers.
//
// Read with plain fetch rather than the airtable SDK — one paginated GET does not justify a
// dependency, and this repo has no Airtable client of its own.

/** Field names as the table spells them. Overridable because Airtable columns get renamed. */
const SOCIETY_FIELD = process.env.AIRTABLE_TQ_SOCIETY_FIELD || 'Society'
const PRIORITY_FIELD = process.env.AIRTABLE_TQ_PRIORITY_FIELD || 'Priority'

/** Airtable's maximum, and its default is 100 — worth setting, the table is unit-wise. */
const PAGE_SIZE = 100

/** Stop paging rather than looping forever if Airtable keeps handing back an offset. */
const MAX_PAGES = 200

const TIMEOUT_MS = 20_000

export interface SocietyPriority {
    priority: string
    /** True when the society's units disagreed and the most frequent value was taken. */
    priorityInconsistent: boolean
}

export interface PriorityResult {
    /** Keyed on the society name, lowercased and space-collapsed. Empty when unavailable. */
    bySocietyName: Map<string, SocietyPriority>
    /** Set when Airtable could not be read. The caller degrades rather than failing. */
    unavailable: string | null
    /** Rows the table returned, before any field is read. Zero means the table is wrong or empty. */
    recordCount: number
}

interface AirtableRecord {
    fields?: Record<string, unknown>
}

interface AirtablePage {
    records?: AirtableRecord[]
    offset?: string
}

/** The key both sides agree on, so Airtable's spacing and casing do not have to match truiq's. */
export function societyKey(name: string): string {
    return name.toLowerCase().replace(/\s+/g, ' ').trim()
}

/**
 * Read every row of the table, following Airtable's offset pagination.
 *
 * @throws On any non-OK response or transport failure. The caller turns that into a warning.
 */
async function fetchAllRecords(config: {
    apiKey: string
    baseId: string
    table: string
}): Promise<AirtableRecord[]> {
    const records: AirtableRecord[] = []
    let offset: string | undefined

    for (let page = 0; page < MAX_PAGES; page++) {
        const params = new URLSearchParams({ pageSize: String(PAGE_SIZE) })
        if (offset) params.set('offset', offset)

        const url = `https://api.airtable.com/v0/${config.baseId}/${encodeURIComponent(config.table)}?${params}`
        const response = await fetch(url, {
            headers: { Authorization: `Bearer ${config.apiKey}` },
            signal: AbortSignal.timeout(TIMEOUT_MS),
            cache: 'no-store',
        })

        if (!response.ok) {
            throw new Error(`airtable returned ${response.status}`)
        }

        const body = (await response.json()) as AirtablePage
        records.push(...(body.records ?? []))

        if (!body.offset) return records
        offset = body.offset
    }

    // Hitting the cap means the table grew past 20,000 rows or Airtable is looping. Either way the
    // result would be partial, and a partial priority map silently mislabels societies.
    throw new Error(`airtable paging exceeded ${MAX_PAGES} pages`)
}

/**
 * Collapse unit-wise rows into one priority per society.
 *
 * Priority is stored per unit but is conceptually per society. Where a society's units disagree,
 * the most frequent value wins and the society is flagged `priorityInconsistent` — chosen over
 * failing silently, and over picking the first row, which would make the answer depend on Airtable's
 * row order.
 */
export function tallyPriorities(records: AirtableRecord[]): Map<string, SocietyPriority> {
    const tallies = new Map<string, Map<string, number>>()

    for (const record of records) {
        const society = record.fields?.[SOCIETY_FIELD]
        const priority = record.fields?.[PRIORITY_FIELD]
        // Airtable returns a linked-record field as an array; take the single value when it is one.
        const societyName = Array.isArray(society) ? society[0] : society
        const priorityValue = Array.isArray(priority) ? priority[0] : priority
        if (typeof societyName !== 'string' || typeof priorityValue !== 'string') continue

        const key = societyKey(societyName)
        const value = priorityValue.trim()
        if (!key || !value) continue

        const tally = tallies.get(key) ?? new Map<string, number>()
        tally.set(value, (tally.get(value) ?? 0) + 1)
        tallies.set(key, tally)
    }

    const result = new Map<string, SocietyPriority>()
    for (const [society, tally] of tallies) {
        // Sort by count, then by label, so a tie is resolved the same way on every request rather
        // than by Map insertion order.
        const ranked = [...tally.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        result.set(society, { priority: ranked[0]![0], priorityInconsistent: ranked.length > 1 })
    }
    return result
}

/**
 * Priority per society, or an empty map plus a reason when Airtable cannot be read.
 *
 * Never throws. Priority is optional by design, and an Airtable outage must not take the
 * procurement numbers down with it.
 */
export async function fetchPriorities(): Promise<PriorityResult> {
    const config = airtableConfig()
    if (!config) {
        return { bySocietyName: new Map(), unavailable: 'airtable_not_configured', recordCount: 0 }
    }

    try {
        const records = await fetchAllRecords(config)
        const bySocietyName = tallyPriorities(records)

        // Three different things fail identically on the page — every society reads `unassigned`
        // — so they are named separately here. Telling someone "no priorities" when the table
        // name is wrong sends them to look at the data instead of the config.
        if (records.length === 0) {
            // The table answered with nothing: wrong table, or genuinely empty.
            return { bySocietyName, unavailable: 'airtable_empty', recordCount: 0 }
        }
        if (bySocietyName.size === 0) {
            // Rows came back, but not one had both a Society and a Priority string — so the
            // column names are what is wrong, not the table. Log the names that DO exist:
            // knowing the two we looked for is useless without knowing what was there instead,
            // and this is the difference between a five-minute fix and an afternoon.
            //
            // Field NAMES only, never values — the table holds society data and this line ends
            // up in server logs.
            const seen = [...new Set(records.flatMap((r) => Object.keys(r.fields ?? {})))]
            console.error(
                `[procurement/priority] Airtable returned ${records.length} rows from "${config.table}" but none ` +
                    `had both "${SOCIETY_FIELD}" and "${PRIORITY_FIELD}". Columns present: ${seen.join(' | ')}. ` +
                    `Set AIRTABLE_TQ_SOCIETY_FIELD / AIRTABLE_TQ_PRIORITY_FIELD to match.`
            )
            return { bySocietyName, unavailable: 'airtable_fields_unmatched', recordCount: records.length }
        }
        return { bySocietyName, unavailable: null, recordCount: records.length }
    } catch (error) {
        console.error('[procurement/priority] Airtable read failed:', error)
        return { bySocietyName: new Map(), unavailable: 'airtable_unavailable', recordCount: 0 }
    }
}
