/**
 * One-time spend aggregator. Reads the growth team's raw export (scripts/spend-raw.csv),
 * sums it to (day × channel × micromarket × source), and writes the small committed
 * snapshot lib/buyer/spend/spend-jas26.json. The raw ~95K rows never reach git or the
 * browser — only the aggregate does.
 *
 * Run:  npx tsx scripts/build-spend.ts
 * Re-run whenever the sheet is refreshed, until the live Google Sheet read replaces this.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseCsv, parseSpendTable } from '../lib/buyer/spend/parse'

const RAW = join(process.cwd(), 'scripts/spend-raw.csv')
const OUT = join(process.cwd(), 'lib/buyer/spend/spend-jas26.json')

const rows = parseCsv(readFileSync(RAW, 'utf8'))
if (rows.length < 2) throw new Error('spend-raw.csv has no data rows')

const header = rows[0]!
const builtAt = new Date().toISOString()
const { facts, report } = parseSpendTable(header, rows.slice(1), builtAt)

writeFileSync(OUT, JSON.stringify({ facts, ingest: report }, null, 2))

const totalSpend = facts.reduce((s, f) => s + f.spendInr, 0)
console.log('spend snapshot built:')
console.log('  raw rows        :', report.rowsRead)
console.log('  kept            :', report.rowsKept)
console.log('  dropped bad date:', report.droppedBadDate)
console.log('  dropped bad spend:', report.droppedBadSpend)
console.log('  aggregated facts:', facts.length)
console.log('  total spend ₹   :', Math.round(totalSpend).toLocaleString('en-IN'))
console.log('  unmapped sources:', report.unmappedSources.join(', ') || '(none)')
console.log('  unknown MMs     :', report.unknownMicromarkets.join(', ') || '(none)')
