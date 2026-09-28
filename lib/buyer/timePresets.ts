import { IST_OFFSET_MS, quarterLabelOf, quarterStartOfIST } from './shared'

// Leads in Zoho start on 2024-11-29, so there is nothing to show before that quarter.
export const DATA_START_ISO = '2024-10-01T00:00:00+05:30'

export interface TimeRange {
    id: string
    label: string
    /** Null means the reporting quarter, which is what the dashboard opens on. */
    start: string | null
    end: string | null
    grain: 'week' | 'month'
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function istParts(d: Date) {
    const ist = new Date(d.getTime() + IST_OFFSET_MS)
    return { y: ist.getUTCFullYear(), m: ist.getUTCMonth() }
}

function istDate(y: number, m: number, day = 1): Date {
    return new Date(Date.UTC(y, m, day) - IST_OFFSET_MS)
}

/** Quarters newest first, from the current one back to the start of the data. */
export function quarterRanges(now: Date): TimeRange[] {
    const out: TimeRange[] = []
    const floor = quarterStartOfIST(new Date(DATA_START_ISO))
    for (let q = quarterStartOfIST(now); q >= floor; ) {
        const { y, m } = istParts(q)
        const end = istDate(y, m + 3)
        out.push({
            id: `q-${y}-${m}`,
            label: quarterLabelOf(q),
            start: q.toISOString(),
            end: end.toISOString(),
            grain: 'week',
        })
        q = istDate(y, m - 3)
    }
    return out
}

/** The last `count` months, newest first. */
export function monthRanges(now: Date, count = 12): TimeRange[] {
    const out: TimeRange[] = []
    const floor = new Date(DATA_START_ISO)
    const { y, m } = istParts(now)
    for (let i = 0; i < count; i++) {
        const start = istDate(y, m - i)
        if (start < floor) break
        const p = istParts(start)
        out.push({
            id: `m-${p.y}-${p.m}`,
            label: `${MONTHS[p.m]} ${p.y}`,
            start: start.toISOString(),
            end: istDate(p.y, p.m + 1).toISOString(),
            grain: 'week',
        })
    }
    return out
}

/** `end` is exclusive, so the label shows the last day actually included. */
export function formatRangeLabel(startISO: string, endISO: string): string {
    const a = istParts2(new Date(startISO))
    const b = istParts2(new Date(new Date(endISO).getTime() - 1))
    const left = a.y === b.y ? `${a.d} ${MONTHS[a.m]}` : `${a.d} ${MONTHS[a.m]} ${String(a.y).slice(2)}`
    return `${left} – ${b.d} ${MONTHS[b.m]} ${String(b.y).slice(2)}`
}

function istParts2(d: Date) {
    const ist = new Date(d.getTime() + IST_OFFSET_MS)
    return { y: ist.getUTCFullYear(), m: ist.getUTCMonth(), d: ist.getUTCDate() }
}

export function customRange(startISO: string, endISO: string): TimeRange {
    return {
        id: `custom-${startISO}-${endISO}`,
        label: formatRangeLabel(startISO, endISO),
        start: startISO,
        end: endISO,
        grain: 'week',
    }
}

export function isCustom(r: TimeRange): boolean {
    return r.id.startsWith('custom-')
}

/** yyyy-mm-dd in IST, for date inputs. */
export function toDateInput(iso: string | null, fallback: Date): string {
    const d = iso ? new Date(iso) : fallback
    return new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10)
}

/** A yyyy-mm-dd from a date input, read as midnight IST. */
export function fromDateInput(value: string): string {
    return new Date(`${value}T00:00:00+05:30`).toISOString()
}
