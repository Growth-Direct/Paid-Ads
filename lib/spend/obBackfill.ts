import { parseInr, parseSheetDate } from './sheet'

// Turns the growth team's manual spend sheet into rows the growth activity ledger can accept.
//
// The sheet is a spend table; the ledger is an ACTIVITY ledger keyed on an identity. Offline
// Branding rows carry no campaign, no property and no society — only (date, micromarket,
// medium, ₹) — so the identity has to be recovered from Lead_Source_History, where the
// UTM-builder links land, or synthesised honestly when it cannot be.
//
// Pure: no network, no clock, no env. scripts/build-ob-backfill.ts does the I/O.

export interface SheetRow {
    date: string
    micromarket: string
    medium: string
    spendInr: number
    quantity: number
    scans: number
}

export interface LshTouch {
    day: string
    micromarket: string | null
    campaignName: string | null
    propertyName: string | null
}

/** A property label collapsed for comparison against Zoho's `Product_Name`.
 *
 *  Zoho writes `{Unit} - {Tower} - {pincode}`; LSH writes `{Unit} - {Tower} of {Society}` and
 *  REPEATS the tower when tower and society share a name (`1802 - K L Astoria of K L Astoria`,
 *  `303 - Glen Croft of Glen Croft of Hiranandani Gardens`). The unit is split off first
 *  because it rides on the leading segment and would otherwise stop the duplicate collapsing.
 *  Deterministic, not fuzzy — a near-miss stays unresolved rather than being guessed at, since
 *  filing spend against the wrong flat is worse than filing it at micromarket level. */
export function propertyKey(name: string): string {
    const noPin = name.toLowerCase().replace(/\s*-\s*\d{6}\s*$/, '')
    const m = noPin.match(/^\s*([0-9]+\s*[a-z]?)\s*-\s*(.*)$/)
    const unit = m ? m[1]!.replace(/\s+/g, '') : ''
    const rest = m ? m[2]! : noPin
    const segs = rest.split(' of ').map((x) => x.replace(/[^a-z0-9]+/g, ' ').trim())
    return `${unit}|${segs.filter((x, i) => i === 0 || x !== segs[i - 1]).join(' of ').trim()}`
}

/** `Flyer`/`Flyers` and `Class`/`Classified Ads` both appear in LSH; the sheet uses only the
 *  plural forms. Folded so the two sides can be compared at all. */
export function normaliseMedium(raw: string | null | undefined): string {
    const s = (raw ?? '').trim().toLowerCase()
    if (s.startsWith('flyer')) return 'flyers'
    if (s.startsWith('class')) return 'classified ads'
    return s
}

/** The sheet's Offline Branding rows, summed to one activity per (date, micromarket, medium).
 *
 *  Summing is load-bearing. The ledger's uniqueness is `(source, activityDate, activityKey)`
 *  with `activityKey = sha256(identifier)`, so two rows that produced the same campaign name on
 *  one day would overwrite each other and silently lose money. Three flyer drops in Powai on one
 *  day are one day's flyer activity in Powai. */
export function groupSheetRows(rows: SheetRow[]): Map<string, SheetRow> {
    const out = new Map<string, SheetRow>()
    for (const r of rows) {
        const k = `${r.date}|${r.micromarket}|${r.medium}`
        const e = out.get(k)
        if (e) {
            e.spendInr += r.spendInr
            e.quantity += r.quantity
            e.scans += r.scans
        } else {
            out.set(k, { ...r })
        }
    }
    return out
}

/** Where the row's identifier came from.
 *
 *  `lsh-campaign` is the only one that names a real campaign, and the only one that joins back
 *  to Lead_Source_History. The other two carry a DESCRIPTION, not a campaign — see label(). */
export type Attribution = 'lsh-campaign' | 'no-campaign-property' | 'no-campaign-micromarket'

export interface BackfillRow extends SheetRow {
    campaignName: string
    attribution: Attribution
    propertyId: string
    propertyName: string
    campaignsSeen: number
    propertiesSeen: number
}

/** The identifier for a row with no campaign behind it.
 *
 *  Deliberately NOT in the builder's grammar. A real campaign name looks like
 *  `903C_WesternHeights_Buyer_05062026` — underscore-joined, no spaces — so anything a person
 *  or a query might try to join against LSH is unmistakable. Synthesising a lookalike would
 *  invite exactly the join it cannot support, since this string appears nowhere in LSH.
 *
 *  It is still deterministic and unique per (date, micromarket, medium), because `POST /manual`
 *  requires a campaignName, hashes it into activityKey, and keys uniqueness on
 *  (source, activityDate, activityKey) — two rows sharing one would overwrite each other. */
function describe(key: SheetRow, property?: { name: string }): string {
    const what = property ? property.name.replace(/\s*-\s*\d{6}\s*$/, '') : key.micromarket
    const medium = key.medium ? key.medium.replace(/\b\w/g, (c) => c.toUpperCase()) : 'Offline'
    return `Offline Branding - ${medium} - ${what} - ${key.date}`
}

/** Attribution runs at (date, micromarket), NOT (date, micromarket, medium).
 *
 *  LSH leaves `UTM_Medium` null on 145 of 395 touches, so requiring it to agree throws away
 *  usable evidence — and measured against this data it changes nothing except to lose matches.
 *  The medium still rides on the output row, because it is a real attribute of the activity. */
export function attribute(
    key: SheetRow,
    touches: LshTouch[],
    resolveProperty: (name: string) => { id: string; name: string } | undefined
): BackfillRow {
    const sameDay = touches.filter(
        (t) => t.day === key.date && (!t.micromarket || !key.micromarket || t.micromarket === key.micromarket)
    )
    const campaigns = [...new Set(sameDay.map((t) => t.campaignName?.trim()).filter((c): c is string => !!c))]
    const propertyNames = [...new Set(sameDay.map((t) => t.propertyName?.trim()).filter((p): p is string => !!p))]
    const resolved = propertyNames.length === 1 ? resolveProperty(propertyNames[0]!) : undefined

    let campaignName: string
    let attribution: Attribution
    if (campaigns.length === 1) {
        // The link was built with the UTM builder and exactly one campaign ran here that day.
        // This is the only identifier that names something real and joins back to LSH.
        campaignName = campaigns[0]!
        attribution = 'lsh-campaign'
    } else if (campaigns.length === 0 && resolved) {
        // Leads arrived for one property but the link carried no campaign tag. The property is
        // the real connection and it travels in property_id; the identifier only describes.
        campaignName = describe(key, resolved)
        attribution = 'no-campaign-property'
    } else {
        // No tag at all, or several campaigns and no honest way to split one day's spend
        // between them. A micromarket-level record, described as exactly that.
        campaignName = describe(key)
        attribution = 'no-campaign-micromarket'
    }

    return {
        ...key,
        campaignName,
        attribution,
        propertyId: resolved?.id ?? '',
        propertyName: resolved?.name ?? '',
        campaignsSeen: campaigns.length,
        propertiesSeen: propertyNames.length,
    }
}

export interface SubscriptionPeriod {
    source: string
    startDate: string
    endDate: string
    amount: number
    days: number
    perDay: number
}

/** A 3P source's daily sheet rows collapsed back into the invoice periods they were spread from.
 *
 *  The sheet already apportions an invoice across its days, and the ledger re-derives that
 *  itself from a period — so loading the days would double the work and fight the model. A run
 *  of identical daily amounts is one invoice. */
export function subscriptionPeriods(source: string, daily: Array<{ date: string; spendInr: number }>): SubscriptionPeriod[] {
    const sorted = [...daily].sort((a, b) => a.date.localeCompare(b.date))
    const out: SubscriptionPeriod[] = []
    let run: typeof sorted = []
    const flush = () => {
        if (run.length === 0) return
        const perDay = run[0]!.spendInr
        out.push({
            source,
            startDate: run[0]!.date,
            endDate: run[run.length - 1]!.date,
            amount: Math.round(perDay * run.length * 100) / 100,
            days: run.length,
            perDay,
        })
        run = []
    }
    for (const d of sorted) {
        if (run.length > 0 && Math.abs(run[0]!.spendInr - d.spendInr) > 0.005) flush()
        run.push(d)
    }
    flush()
    return out
}

/** Parses one sheet row. Exported so the script and its tests read the same columns. */
export function toSheetRow(get: (col: string) => string, slashOrder: 'MDY' | 'DMY'): SheetRow | null {
    const iso = parseSheetDate(get('date'), slashOrder)
    if (!iso) return null
    return {
        date: iso.slice(0, 10),
        micromarket: get('utm micromarket'),
        medium: normaliseMedium(get('utm medium')),
        spendInr: parseInr(get('spends (in inr)')) ?? 0,
        quantity: Number(get('quantity') || 0),
        scans: Number(get('scans') || 0),
    }
}
