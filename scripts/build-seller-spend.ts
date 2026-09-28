import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseSellerSpendTable } from '../lib/seller/spend/parse'
import { inferSlashOrder, norm, parseCsv } from '../lib/spend/sheet'

// Builds the committed seller spend snapshot from a CSV export of the "Seller side spends"
// tab. Run by hand — see scripts/README.md — because the sheet is filled by hand.
//
//   pnpm build:spend:seller
//
// Raw rows are never shipped to the browser: 21.8K rows would take the /api/seller payload
// from ~1MB to tens of MB. This collapses them to ~1K facts, small enough to ride along in
// the fact table and be re-filtered client-side like every other dimension.

const RAW = join(process.cwd(), 'scripts/seller-spend-raw.csv')
const OUT = join(process.cwd(), 'lib/seller/spend/spend-jas26.json')

const rows = parseCsv(readFileSync(RAW, 'utf8'))
if (rows.length < 2) throw new Error('seller-spend-raw.csv has no data rows')

const header = rows[0]!
const data = rows.slice(1)

// The date order is PROVED from the data on every build, not hardcoded. The two tabs of this
// one workbook disagree — buyer is M/D, seller is D/M — so a hardcoded order silently
// transposes every day and month the day a tab changes producer. If the file can't settle it,
// refuse to build rather than emit misdated spend.
const dateCol = norm('Date')
const idx = new Map(header.map((h, i) => [norm(h), i]))
const dateAt = idx.get(dateCol)
if (dateAt === undefined) throw new Error('seller-spend-raw.csv has no Date column')
const inferred = inferSlashOrder(data.map((r) => (r[dateAt] ?? '').trim()))
if (inferred.order === null) {
    throw new Error(
        `Cannot prove the slash date order from the data: ${inferred.slashRows} slash rows, ` +
            `max first component ${inferred.maxFirst}, max second ${inferred.maxSecond}. ` +
            `Neither component exceeds 12 (or both do), so D/M and M/D are indistinguishable. ` +
            `Ask the growth team which the sheet uses before building.`
    )
}

const builtAt = new Date().toISOString()
const { facts, report } = parseSellerSpendTable(header, data, inferred.order, builtAt)

writeFileSync(OUT, JSON.stringify({ facts, ingest: report }, null, 2))

const inr = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 2 })
const total = facts.reduce((s, f) => s + f.spendInr, 0)
console.log(`date order         ${inferred.order}  (max first ${inferred.maxFirst}, max second ${inferred.maxSecond})`)
console.log(`rows read          ${report.rowsRead}`)
console.log(`rows kept          ${report.rowsKept}`)
console.log(`dropped bad date   ${report.droppedBadDate}`)
console.log(`dropped bad spend  ${report.droppedBadSpend}`)
console.log(`facts              ${facts.length}`)
console.log(`total spend        ₹${inr(total)}`)
console.log(`unallocated        ₹${inr(report.unallocatedInr)}  (${((report.unallocatedInr / total) * 100).toFixed(1)}% — dropped by any micromarket filter)`)
console.log(`unmapped sources   ${report.unmappedSources.length ? report.unmappedSources.join(', ') : '(none)'}`)
console.log(`unknown micromkts  ${report.unknownMicromarkets.length ? report.unknownMicromarkets.join(', ') : '(none)'}`)
console.log(`\nwrote ${OUT}`)
