import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { executeCOQL } from '../lib/zoho'
import { norm, parseCsv } from '../lib/spend/sheet'
import {
    type BackfillRow,
    type LshTouch,
    attribute,
    groupSheetRows,
    propertyKey,
    subscriptionPeriods,
    toSheetRow,
} from '../lib/spend/obBackfill'

// Builds the two files the growth ledger needs to hold Offline Branding and 3P spend, which it
// currently holds none of. Run by hand:
//
//   pnpm build:backfill
//
// Reads scripts/spend-raw.csv (the growth team's manual export, the agreed source of truth),
// and Zoho for Lead_Source_History and Products. Zoho answers are cached to scratch files so a
// re-run costs nothing — the API throttles hard on repeated token mints.

const FROM = '2026-06-01'
const TO = '2026-09-30'
const RAW = join(process.cwd(), 'scripts/spend-raw.csv')
const CACHE_LSH = join(process.cwd(), 'scripts/.cache-lsh-ob.json')
const CACHE_PROD = join(process.cwd(), 'scripts/.cache-products.json')
const OUT_OB = join(process.cwd(), 'scripts/ob-backfill.csv')
const OUT_3P = join(process.cwd(), 'scripts/3p-subscriptions.csv')

const THIRD_PARTY = ['99Acres', 'MagicBricks', 'Housing'] as const
/** The exact spellings POST /api/growth-activities/subscriptions accepts. The sheet's differ. */
const LEDGER_SOURCE: Record<string, string> = { '99Acres': '99Acres', MagicBricks: 'Magicbricks', Housing: 'Housing' }

const inr = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
const csv = (v: unknown) => {
    const s = String(v ?? '')
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

async function cached<T>(path: string, fetch: () => Promise<T>): Promise<T> {
    if (existsSync(path)) return JSON.parse(readFileSync(path, 'utf8')) as T
    const data = await fetch()
    writeFileSync(path, JSON.stringify(data))
    return data
}

async function main() {
    // --- the sheet ---
    const rows = parseCsv(readFileSync(RAW, 'utf8'))
    const header = rows[0]!
    const idx = new Map(header.map((h, i) => [norm(h), i]))
    const col = (r: string[], k: string) => (r[idx.get(k)!] ?? '').trim()

    const obSheet = rows
        .slice(1)
        .filter((r) => /offline/i.test(col(r, 'utm source')))
        .map((r) => toSheetRow((k) => col(r, k), 'MDY'))
        .filter((r): r is NonNullable<typeof r> => !!r && r.date >= FROM && r.date <= TO)

    const grouped = groupSheetRows(obSheet)

    // --- Zoho: the Offline Branding touches that carry the UTM-builder tags ---
    const lshRaw = await cached(CACHE_LSH, async () => {
        const out: Record<string, unknown>[] = []
        for (const [a, b] of monthWindows(FROM, TO)) {
            out.push(
                ...(await executeCOQL(
                    `select id, Campaign_Name, UTM_Medium, Micromarket, Property_Name, Timestamp, Source ` +
                        `from Lead_Source_History where (Timestamp between '${a}T00:00:00+05:30' and '${b}T00:00:00+05:30') ` +
                        `and (Source = 'Offline Branding')`
                ))
            )
        }
        return out
    })
    const touches: LshTouch[] = lshRaw.map((r) => ({
        day: String(r.Timestamp ?? '').slice(0, 10),
        micromarket: (r.Micromarket as string) ?? null,
        campaignName: (r.Campaign_Name as string) ?? null,
        propertyName: (r.Property_Name as string) ?? null,
    }))

    // --- Zoho: candidate properties, only for the micromarkets the sheet actually spends in ---
    const micromarkets = [...new Set([...grouped.values()].map((g) => g.micromarket).filter(Boolean))]
    const products = await cached(CACHE_PROD, async () => {
        const out: Record<string, unknown>[] = []
        for (const mm of micromarkets) {
            out.push(
                ...(await executeCOQL(`select id, Product_Name, Truva_Micromarket from Products where Truva_Micromarket = '${mm}'`))
            )
        }
        return out
    })
    const byProperty = new Map<string, { id: string; name: string }>()
    for (const p of products) {
        const name = String(p.Product_Name ?? '')
        const k = propertyKey(name)
        // A key that is not unique cannot identify a flat, so it resolves to nothing at all
        // rather than to whichever row happened to be read first.
        if (byProperty.has(k)) byProperty.set(k, { id: '', name: '' })
        else byProperty.set(k, { id: String(p.id), name })
    }
    const resolveProperty = (name: string) => {
        const hit = byProperty.get(propertyKey(name))
        return hit && hit.id ? hit : undefined
    }

    // --- attribute and write ---
    const out: BackfillRow[] = [...grouped.values()]
        .map((g) => attribute(g, touches, resolveProperty))
        .sort((a, b) => a.date.localeCompare(b.date) || a.micromarket.localeCompare(b.micromarket))

    const obHeader = [
        'activity_date', 'source', 'campaign_name', 'purpose', 'medium', 'micromarket',
        'property_id', 'property_name', 'society_id', 'spend_inr', 'quantity', 'scans',
        'attribution', 'lsh_campaigns_seen', 'lsh_properties_seen',
    ]
    writeFileSync(
        OUT_OB,
        [
            obHeader.join(','),
            ...out.map((r) =>
                [
                    r.date, 'Offline Branding', r.campaignName, 'BUYER', r.medium, r.micromarket,
                    r.propertyId, r.propertyName, '', r.spendInr.toFixed(2), r.quantity, r.scans,
                    r.attribution, r.campaignsSeen, r.propertiesSeen,
                ].map(csv).join(',')
            ),
        ].join('\n') + '\n'
    )

    // --- 3P: invoice periods, not days ---
    const periods = THIRD_PARTY.flatMap((src) =>
        subscriptionPeriods(
            LEDGER_SOURCE[src]!,
            rows
                .slice(1)
                .filter((r) => col(r, 'utm source') === src)
                .map((r) => toSheetRow((k) => col(r, k), 'MDY'))
                .filter((r): r is NonNullable<typeof r> => !!r && r.date >= FROM && r.date <= TO)
                .map((r) => ({ date: r.date, spendInr: r.spendInr }))
        )
    )
    writeFileSync(
        OUT_3P,
        ['source,start_date,end_date,amount,purpose,days,per_day']
            .concat(periods.map((p) => [p.source, p.startDate, p.endDate, p.amount.toFixed(2), 'BUYER', p.days, p.perDay.toFixed(2)].map(csv).join(',')))
            .join('\n') + '\n'
    )

    // --- report ---
    const sheetTotal = obSheet.reduce((a, r) => a + r.spendInr, 0)
    const fileTotal = out.reduce((a, r) => a + r.spendInr, 0)
    const tier = (a: string) => out.filter((r) => r.attribution === a)
    const sum = (rs: BackfillRow[]) => rs.reduce((a, r) => a + r.spendInr, 0)
    console.log(`Offline Branding  ${obSheet.length} sheet rows -> ${out.length} activities`)
    for (const a of ['lsh-campaign', 'no-campaign-property', 'no-campaign-micromarket'] as const) {
        console.log(`  ${a.padEnd(24)} ${String(tier(a).length).padStart(2)} rows  ${inr(sum(tier(a)))}`)
    }
    console.log(`  with a resolved property : ${out.filter((r) => r.propertyId).length}`)
    console.log(`  sheet total ${inr(sheetTotal)}   file total ${inr(fileTotal)}   ${Math.abs(sheetTotal - fileTotal) < 0.01 ? 'MATCH' : 'MISMATCH'}`)
    const tpSheet = rows
        .slice(1)
        .filter((r) => (THIRD_PARTY as readonly string[]).includes(col(r, 'utm source')))
        .map((r) => toSheetRow((k) => col(r, k), 'MDY'))
        .filter((r): r is NonNullable<typeof r> => !!r && r.date >= FROM && r.date <= TO)
    const tpSheetTotal = tpSheet.reduce((a, r) => a + r.spendInr, 0)
    const tpFileTotal = periods.reduce((a, p) => a + p.amount, 0)
    console.log(`\n3P  ${tpSheet.length} daily rows -> ${periods.length} subscription periods`)
    console.log(`  sheet total ${inr(tpSheetTotal)}   file total ${inr(tpFileTotal)}   ${Math.abs(tpSheetTotal - tpFileTotal) < 1 ? 'MATCH' : 'MISMATCH'}`)
    console.log(`\nwrote ${OUT_OB}\nwrote ${OUT_3P}`)
}

function monthWindows(from: string, to: string): Array<[string, string]> {
    const out: Array<[string, string]> = []
    let cur = from.slice(0, 8) + '01'
    while (cur <= to) {
        const d = new Date(`${cur}T00:00:00Z`)
        const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString().slice(0, 10)
        out.push([cur, next])
        cur = next
    }
    return out
}

void main()
