# scripts

The dashboard reads spend from a **committed aggregate**, not from the sheet. The raw exports
are 21K–95K rows; shipping them to the browser would take the payload from ~1MB to tens of MB.
These scripts collapse each export to ~1K rows summed by (date, channel, micromarket, source),
which is small enough to ride along in the fact table and be re-filtered client-side.

Re-run the relevant script whenever the growth team refreshes the sheet. **The number on the
dashboard is only as fresh as the last run** — see "Why this is still manual" below.

## build-spend.ts — buyer

1. In `Spends_Structure.xlsx`, open the **"Buyer side spends"** tab.
2. File → Download → Comma-separated values (.csv).
3. Save it here as `scripts/spend-raw.csv` (gitignored — the raw rows are never committed).
4. Run: `pnpm build:spend`

Writes `lib/buyer/spend/spend-jas26.json`.

## build-seller-spend.ts — seller

1. In the same `Spends_Structure.xlsx`, open the **"Seller side spends"** tab.
2. File → Download → Comma-separated values (.csv).
3. Save it here as `scripts/seller-spend-raw.csv` (gitignored).
4. Run: `pnpm build:spend:seller`

Writes `lib/seller/spend/spend-jas26.json`.

**Read the output.** It prints rows read/kept, drops, the total, the unallocated share and any
unrecognised source or micromarket. Three lines matter:

- `date order` — proved from the data, not assumed. The two tabs of this one workbook use
  **opposite** orders (buyer M/D, seller D/M), so the build derives it from the file every time
  and refuses to run if the data can't settle it. See known-traps.md #31.
- `unallocated` — spend with no micromarket (`All MM`, blank, or a cluster typed into the
  column). It is ~20% on the seller tab and is dropped by any micromarket filter, which makes
  filtered cost-per metrics read low. The seller tab says so on screen; see known-traps.md #33.
- `unknown micromkts` / `unmapped sources` — data-entry problems worth fixing in the sheet.
  `Habibi` is a cluster, not a micromarket. `All MM` and blank are deliberately *not* listed.

## Why this is still manual

Both sheets are filled by hand, so a snapshot is stale the moment someone types. A live read is
the right end state and `lib/*/spend/source.ts` is the seam for it — same `{ facts, ingest }`
shape, so nothing downstream changes. It needs two things we don't have yet: `drive.readonly` on
the service account behind `GOOGLE_SA_CREDENTIALS_JSON` (currently Directory-scoped only, so a
Workspace admin has to grant it), and a Drive export/convert step, because the workbook is an
uploaded `.xlsx` rather than a native Google Sheet — `sheets.values.get` cannot read it.
