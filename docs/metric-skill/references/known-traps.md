# Known traps in Zoho DB Sync

Read this before writing SQL, not after a number looks odd.

Every item here was found the hard way, by someone producing a wrong number and then working out why. None of them throw an error. They all return clean, plausible, wrong results. That is what makes them dangerous for a team that cannot read the SQL.

## 1. The bigint `id` column is corrupted on every table

Every table has a bigint `id`. **Never use it.** Not in a join, not in a filter, not to build a link back to Zoho.

Zoho record IDs are 18 digits. A 64-bit float holds about 16 digits exactly. Somewhere in the sync the ID gets parsed as a number and rounded, so the bigint column silently holds a value that is close to right and actually wrong.

Verified on a real lead: text `_id` is `785549000045192131`, which matches Zoho. The bigint `id` on the same row is `785549000045192200`. Same bug confirmed on `deals`.

**What to do instead:** every table has a text column with the exact unrounded ID. Use `_id` for the table's own key, and the named text lookup column when pointing at another table, like `deals."Lead"` or `events."What_Id"`. Text to text, always.

If a join returns zero rows when it obviously should return many, or returns matches for everything, check this first.

## 2. Datetime filters default to UTC, not IST

All timestamps sync as `timestamptz`. If you filter with a bare date like `'2026-04-01'`, Postgres reads it as UTC midnight, which is 5:30am IST. Your week starts five and a half hours late and records near the boundary land in the wrong bucket.

**Always write the offset:** `'2026-04-01T00:00:00+05:30'`, never `'2026-04-01'`.

When bucketing by week or month, convert explicitly: `date_trunc('week', "Created_Time" AT TIME ZONE 'Asia/Kolkata')`.

One related thing that is not a bug: Postgres weeks start Monday, and Metabase's own charting UI defaults to Sunday. If weekly buckets differ slightly between your query and a Metabase-built question, that is usually this, not a data problem.

## 3. The visit rollup fields on Leads and Bids are dead or lossy

Zoho keeps convenience fields on Leads and Bids that look like they answer "did this lead visit". Automations were supposed to maintain them. The automations do not cover every path that creates a visit, especially since the WhatsApp bot started creating records.

Checked directly against leads with real, confirmed visits:

| Field | Table | State |
|---|---|---|
| `No_of_Visits` | `deals` | **Always NULL.** Completely unmaintained. |
| `Visit_Booked_On` | `leads` | Dead legacy field. Zoho's own UI still labels it "(Engati)", a system Truva replaced. Null even on leads that definitely visited. |
| `Visited` | `leads` | Same. Dead. |
| `First_visited_at` | `leads` | Works, but only ever records the **first** visit. |
| `First_completed_visit_time` | `deals` | Works, but only the **first** visit. A bid with visits in April and July shows April only. |

**Build every visit metric on `events` instead.** Visit booked = an `events` row exists for the bid with `Module = 'Bid'`, any status.

For **visit completed**, which definition you want depends on the question. The buyer DRR metric moved off `Visit_Status` on 2026-09-01 and now reads the linked bid's `Stage` — anything other than `Unassigned`, `Pre-Visit` or `Cancelled` counts as visited. `Visit_Status IN ('Visit Complete', 'Visit Completed')` is still the right read of that field itself, and the two agree about 92.5% of the time. Use the `Stage` reading for anything that has to tie to the dashboard, and say which one a number came from. See `metric-definitions.md`.

The general lesson, which will apply to fields not yet on this list: before trusting a summary field on Leads or Bids, ask whether a dedicated module records that event directly. If one does, use it. Treat rollups as a shortcut that may be stale.

## 4. `Visit_Status` spelling, and blanks that are not NULL

The picklist contains both `Visit Complete` and `Visit Completed`. As of 2026-08-10, across 11,877 buyer visits, only the single-word spelling has any rows:

| `Visit_Status` | Rows |
|---|---|
| `Visit Complete` | 7,968 |
| `Cancelled` | 3,742 |
| `Scheduled` | 127 |
| `Rescheduled` | 30 |
| empty string | 10 |

Include both spellings in filters anyway, since the second could start being written at any time and the cost is nothing.

Note the ten rows with an **empty string**, not NULL. `WHERE "Visit_Status" IS NOT NULL` will not exclude them.

## 5. `Lead_Source` has case-variant junk

The clean values are things like `Meta`, `Google Ads`, `Channel Partner`, `Website`, `99Acres`, `Housing`, `Instagram`, `WhatsApp`, `Referral`.

Production also contains lowercase junk written by various integrations: `google_ads`, `instagram`, `fb`, `google`, `meta`. Group case-insensitively, or `Meta` and `meta` become two lines on the chart.

Use `lower("Lead_Source")` for grouping, and map the junk variants onto their clean equivalents explicitly.

## 6. `Lead_Source` means two different things depending on the table

On `leads` it is the acquisition channel, with the full list of values above.

On `deals` it has only two values, `Direct` and `Channel Partner`, and it describes how interest in that specific property was sourced.

Same column name, different meaning, different table. If someone asks to split bids by source, ask which one they mean.

## 7. `Lead_Status` contains telephony junk

Real statuses include `Qualified`, `Not Qualified`, `In follow Up`, `Site visit Scheduled`, `Inactive`, `Call Later`, `Unassigned`, `Attempted to Contact`, `Pre Qualified`, `Purchased with Truva`, `Purchased Outside Truva`, `Duplicate`. Note the odd casing on `In follow Up` and `Site visit Scheduled`.

Call dispositions also get written into this field by the Acefone webhook. Live counts for leads created since 2026-01-01, checked 2026-08-29: `Open - Disconnected` (908), `Network Issue` (45), `Customer Network Issue` (10), `Call Rejected` (8), `Not Reachable` (7), `Unallocated Number` (6), `Receiver is busy` (3), `System Failure` (1). `Channel Issue` also exists historically.

These are not real lead statuses, but **do not drop them — map them into `Attempted to Contact`** (see trap 16). They are real leads someone tried to reach. Folding them in takes ATC from 558 to about 1,546, so it materially changes any status distribution either way.

`Paused Search` (26) is a real status, not junk. `Inactive` (2,973) is real too.

## 8. Bid `Stage` has legacy spellings

Current values, with the spacing exactly as stored: `Unassigned`, `Pre-Visit`, `Active - Warm`, `Active - Cold`, `Offer Negotiation`, `Blocking Received`, `Closed - Won`, `Closed - Sold`, `Closed - Rejected`, `Cancelled`.

Some older records hold `Active`, `Active Cold`, or `Warm`. Handle both forms when filtering on stage.

## 9. `Modified_Time` on `events` is unusable

A bulk operation on 23 July 2026 between 15:55 and 15:56 rewrote `Modified_Time` on 99.7% of all buyer visits. It hit completed and cancelled visits at the same rate, so it did not manufacture status changes, but the column is now meaningless as an event timestamp.

**Anchor every visit time series on `Start_DateTime`.**

## 10. Stage-change timestamps can precede the visit they follow

Transitions into `Active - Warm` or `Active - Cold` are often timestamped *before* the bid's first completed visit. The stage gets updated when feedback comes in; the visit datetime is stamped separately and can land later.

So never test "was this bid activated after its visit" with `Modified_Time >= First_completed_visit_time`. It silently drops about half of real activations. Test instead for any history row with `Moved_To__s` in the active stages, or a current `Stage` in the active stages.

## 11. `Type_of_meeting` is empty on every row

The picklist defines `First` and `Follow-up meeting`. No live data populates it, across roughly 4,350 events checked.

To split first from repeat visits, derive it: the earliest completed visit per bid is the first, later completed ones on the same bid are repeats.

## 12. Lead-level UTM fields are coarser than the source-history rows

A lead's `First_Source` can say `Paid Ads (Unattributed)` with a null property, while its latest `lead_source_history` row says `Source = Google Ads`, `Property_Name = 2001 - K L Astoria`, `Micromarket = Barcelona`.

The specific attribution lives in `lead_source_history`, one row per engagement, with campaign, ad set, ad, and property. The lead-level fields are a lossy summary.

Anything that needs the real source or property of a particular engagement must read `lead_source_history`.

## 13. Lead Source History starts on 2026-06-09

Rows before that date were backfilled by hand on that day. Any trend line through early June will show a false step. Either start the window at 2026-06-09 or flag the discontinuity on the chart.

Also: **a CP engagement writes its row when the bid is created, not when the lead is created.** A CP lead with no bid has no row here at all, by design. Do not read that absence as missing data.

## 14. Completed visits are right-censored in recent periods

On completed buyer visits, feedback is effectively part of marking the visit complete. A visit whose feedback is still pending is not yet `Visit Complete`.

So the most recent week or two will always undercount completed visits, and a dip at the right-hand edge of a chart is usually this, not a real decline. Either exclude the trailing period or label it as incomplete.

## 15. `Truva_Cluster = 'VCV'` is a test environment, and excluding it wrongly breaks things

VCV is a prod-testing cluster. On `products` its 110 records all carry virtual micromarkets (`Airport (Virtual)`, `Leaf Links (Virtual)`, `Mainland (Virtual)`, `Viceport (Virtual)`) and `House_Captain = System`.

**Exclude it from every query, always.** It is one of the always-on defaults in SKILL.md, not something to ask about.

Verified counts on 2026-08-10: `products` 110, `events` 18, `sellers` 11.

The trap is in *how* you exclude it. All three tables also hold nulls and empty-string clusters, and a plain inequality drops the null rows too:

```sql
-- WRONG: silently drops every row where Truva_Cluster is NULL
AND "Truva_Cluster" != 'VCV'

-- RIGHT
AND "Truva_Cluster" IS DISTINCT FROM 'VCV'
```

`IS DISTINCT FROM` treats null as different from `'VCV'`, so null rows survive. It is shorter and harder to get wrong than an `IS NULL OR ...` construction, and it is what the live seller query uses.

On `sellers` the naive form loses one null row and keeps 237 empty-string rows, so the damage there is small. On a table with many nulls it would be severe, and it would read as a real decline rather than a bug.

**The same trap applies to any `NOT IN` filter on a nullable column.** The live seller query has `lower("Seller_Source") NOT IN ('channel partner','society partners')`, which drops null sources. It is safe today because `sellers` has no null `Seller_Source`, only one empty string. If nulls appear, that filter starts eating rows.

## 16. Telephony junk statuses are real leads — bucket them, do not delete them

Both `sellers."Call_Status"` and `leads."Lead_Status"` get polluted by the Acefone webhook writing call dispositions into a status field.

On sellers: `Network Issue`, `Call Rejected`, `Open - Disconnected`. On leads: `Network Issue`, `Customer Network Issue`, `Unallocated Number`, `Not Reachable`, `Call Rejected`, `Channel Issue`, `System Failure`.

**Map these into `Attempted to Contact`. Do not filter them out.** Every one of them is a lead somebody tried to reach and failed to connect with. Dropping them understates the top of the funnel and makes contact rates look better than they are.

```sql
CASE
  WHEN "Call_Status" IN ('Network Issue', 'Call Rejected', 'Open - Disconnected')
    THEN 'Attempted to Contact'
  ELSE "Call_Status"
END AS call_status_clean
```

`Invalid number` and `To call` are **not** in this group. `To call` is a lead nobody has attempted yet, and `Invalid number` is arguably its own outcome. Ask before folding either one anywhere.

## 17. `sellers."Lead_Type"` is dead

The team stopped maintaining it. Seller funnel status is `Call_Status` on `sellers`, and `Acq_Status` on `products` once a property record exists.

This one really matters because the two fields disagree by a lot. For leads created since 2026-05-01, `Call_Status = 'Qualified'` returns **360** records while the dead `Lead_Type = 'Qualified'` returns **81**. Same word, 4.4x apart. Any historical chart built on `Lead_Type` is wrong and should be rebuilt.

## 18. "Qualified" on sellers has three candidate fields

- `Call_Status = 'Qualified'` — **this is the right one**, 360 records since 2026-05-01
- `Lead_Type = 'Qualified'` — dead field, 81 records, see above
- `Truva_Qualified` — a text **array** column, holds multiple values per row, not a status

Use `Call_Status`. If someone's existing number does not match yours, this is the first thing to check.

## 19. `sellers."Channel"` is 85% empty

Of 3,206 seller leads since 2026-05-01: 2,122 blank, 590 `Unknown`, 13 null. Splitting a seller chart by Channel puts six lines out of seven into a junk bucket.

Use `Seller_Source`. Its sub-source detail is embedded in the values themselves, like `Society Data - Cold Call` and `Society Data - WA Blast`.

## 20. `Seller_Source` has junk variants too

`google_ads` (189 records) should be Google Ads. `IG` (7) should be Instagram. `Ads` (5) is ambiguous, ask before bucketing it. One row has an empty string.

189 records is not a rounding error, so this materially changes a Google Ads line on a chart.

## 21. `Source_Category` on sellers is not a real column

It exists only inside the `_raw` JSON. Any query referencing it needs JSON extraction, not a plain column reference.

## 22. `NOT IN` silently drops NULLs

Postgres behaviour, not a Zoho quirk, but it bites here constantly because so many of these columns are nullable.

`WHERE "Lead_Status" NOT IN ('Duplicate', 'Inactive')` excludes every row where `Lead_Status` is NULL, which is probably not what anyone wanted. Write `WHERE ("Lead_Status" IS NULL OR "Lead_Status" NOT IN (...))` when nulls should pass.

## 23. Status names in the DRR doc do not match the database

The growth team's standardisation doc is written in business prose, and seven status strings in it are capitalised differently from the values actually stored. An exact-match filter built from the doc returns a clean, wrong number.

| Doc | Database | Table |
|---|---|---|
| `In Follow Up` | `In follow Up` | `leads` |
| `Site Visit Scheduled` | `Site visit Scheduled` | `leads` |
| `Visit to be Scheduled` | `Visit to be scheduled` | `leads` |
| `Not Qualified` | `Not qualified` | `sellers` |
| `Visit to be scheduled` | `Visit to be Scheduled` | `products` |
| `Visit scheduled` | `Visit Scheduled` | `products` |

Note that `Visit to be scheduled` on `leads` and `Visit to be Scheduled` on `products` are capitalised **oppositely**. Copy the exact string for the table you are querying from `metric-definitions.md`.

Measured cost, 2026-08-29: buyer qualified leads come out 13.8% low using the doc spellings (4,932 vs 5,724). Seller visits come out 27% high (2,967 vs 2,338).

Compare with `lower()` on both sides where you can, so a future casing change does not silently break a chart.

## 24. Unmapped sources disappear instead of erroring

The buyer channel mapping does not cover every live `Lead_Source`. As of 2026-08-29, `Channel Partner` (1,756), `Builder` (12), `Nobroker` (2) and `ig` (2) have no channel — 11.2% of all leads.

A `CASE` with no `ELSE` returns null for these, and a chart grouped on it either hides them or shows a confusing blank series. **Always give the `CASE` an `ELSE 'Unmapped'`** and leave that bucket on the chart. A visible `Unmapped` bar gets fixed; a silently dropped source becomes a number nobody can reconcile.

## 25. `Society Data` means two different channels

On the buyer side it maps to Society WA Groups & Management Apps. On the seller side it maps to Cold Outreach. Same string, opposite ends of the funnel. Check which report you are building before bucketing it.

## 26. Column names need double quotes

The replica preserves Zoho's mixed-case API names, so Postgres needs them quoted. `SELECT Created_Time FROM leads` fails or silently folds to lowercase. Write `SELECT "Created_Time" FROM leads`.

Table names are lowercase and do not need quoting.

## 27. The seller-visit rule changed on 2026-09-01 and `Internally Rejected` flipped sides

The old rule was one line: a visit is any property whose `Acq_Status` is filled, except `Junk`, `Internally Rejected`, `Explore Later - Pre Visit`, `Visit to be Scheduled`, `Visit Scheduled`. The DRR doc replaced it with three cases where `Visit_Date` decides both whether a property counts and which quarter it lands in.

`Internally Rejected` moved from the never-count list into Case 2, so it now counts whenever a `Visit_Date` is present. That is 395 of its 604 properties.

Measured on the mirror 2026-09-07, VCV excluded, all time:

| Rule | Qualifying properties |
|---|---|
| Old single-exclusion rule | 2,527 |
| New three-case rule | 2,858 |

**Anything still running the old rule reports seller visits 13% low**, and the error is concentrated in one status rather than spread thinly, so it will not look like noise. Cost per Visit and Conversion % both move with it, in opposite directions.

Two smaller effects inside that number, which partly cancel: Case 2 now gates `Recycled`, `Request Valuation Range`, `Valuation Range Received` and `Pitched to Seller` on having a `Visit_Date`, which removes 64 properties the old rule counted unconditionally. `Request Valuation Range` has no `Visit_Date` on any of its 19 rows, so it now contributes zero.

Full case lists and per-status counts are in `metric-definitions.md`.

## 28. Zoho's live COQL API requires a WHERE clause, unlike the Postgres mirror

A bare `SELECT ... FROM Products` (no WHERE at all) 400s against the live Zoho API with
`{"code":"SYNTAX_ERROR","details":{"clause":"where"},"message":"missing clause"}` — verified
2026-09-07, building the growth-reporting dashboard's "fetch every property regardless of
status" query. The Postgres mirror this skill was originally written against has no such
restriction, so a query built by testing against the mirror can pass there and still fail live.

If you genuinely want every row with no real filter, add a trivially-true condition instead of
omitting WHERE — `id is not null` works, since `id` is always populated.

## 29. The seller three-case rule is New-cohort only — Old drops Case 3's "always counts"

Trap #27 covers the 2026-09-01 rewrite but only checked the Notion doc's New Visit section.
Read against the source doc directly on 2026-09-07: the **Old Visit** section is not that same
rule re-applied to an older cohort. It has no Case 3 at all — every non-Case-1 status (both
what's Case 2 and Case 3 on the New side) requires a `Visit_Date` **within the current
quarter**, with no fallback. A dashboard or query built by reading only the New Visit section
(the more prominent, more detailed one) will treat Old-cohort Case 3 properties as unconditional
visits, which the doc does not say — that overcounts Old Visits, in the opposite direction from
trap #27's undercount. The growth-reporting dashboard had exactly this bug from when the
three-case rule first landed (2026-09-07) until same-day, when it was caught and fixed in
`lib/seller/derive.ts`'s `isQualifyingVisit`.

## 30. Channel Partner-sourced sellers/products are already fetched live — just dropped in memory

`lib/seller/aggregate.ts`'s Sellers/Products COQL queries carry no `Seller_Source` exclusion at
all — every Channel Partner-sourced seller and property is pulled from Zoho on every build, the
same as Direct. The exclusion (`EXCLUDED_SELLER_SOURCES`, `lib/seller/shared.ts`) only runs
in-memory, in `aggregate.ts`'s `eligible()` gate. Verified 2026-09-08 while adding the Overall
Funnel's "Total Conversions (Channel Partner + Direct)" float box: no second Zoho query was
needed to read Channel Partner conversions back in — `rawProducts`/`rawSellerById` already had
them, they just weren't being kept. If a future card needs any other Channel Partner-sourced
reading, check here first before adding a fetch.

This extends further than first assumed: `Truva_Micromarket`/`Truva_Cluster` are ALSO already
fetched for Channel Partner sellers (same `sellerFields` string covers every source, no
conditional). The 2026-09-08 session wrongly reasoned "Channel Partner sellers have no
channel/micromarket taxonomy of their own" when it built the float box to ignore every filter —
true for channel (Channel Partner isn't in the channel map), false for place. Verified
2026-09-09: `rawSellerById`'s Channel Partner rows carry real `Truva_Micromarket` values, just
never carried into `channelPartnerProducts`' sibling pool. See
`lib/seller/aggregate.ts`'s `channelPartnerPlaces` and `lib/seller/filters.ts`'s `placeMatches`.

## 31. The two tabs of the spend workbook use OPPOSITE date orders

`Spends_Structure.xlsx` has a "Buyer side spends" tab and a "Seller side spends" tab with
identical 22-column headers. Their dates are not in the same order. Measured against both
exports on 2026-09-08:

| Tab | Order | Proof |
|---|---|---|
| Buyer side spends | **M/D** | first component never exceeds 12, second reaches 31 |
| Seller side spends | **D/M** | first component reaches 31, second never exceeds 9 |

The seller tab also mixes year widths: 20,713 rows with a 4-digit year and 1,127 with a 2-digit
one (`06/01/26`), both in the same column.

Reading the seller tab with the buyer's order silently destroys it. Rows whose first component
is above 12 (15,392 of 21,840) fail the month check and drop; the rest are accepted with day
and month transposed, so `06/01/26` becomes 1 June instead of 6 January. Nothing errors, the
totals just come out wrong and wrongly distributed across the quarter.

`lib/spend/sheet.ts` therefore makes the order an explicit argument rather than a default, and
`scripts/build-seller-spend.ts` **proves it from the data on every build** via `inferSlashOrder`
— a component above 12 can only be a day — and throws rather than guessing when the file cannot
settle it. Do the same for any new tab: never inherit another tab's order.

## 32. `UTM Source` on the spend sheet does not match `Seller_Source` in Zoho

The seller spend tab writes `99Acres`; Zoho's `Seller_Source` says `99 Acres`, with a space. A
source filter carries the Zoho spelling and a spend row carries the sheet's, so before this was
handled, filtering to that one source showed ₹0 spend and a dash in every cost-per row, as
though ₹22,150 of real 3P spend did not exist. One space.

The other four sources on the tab (`Meta`, `google_ads`, `Offline Branding`,
`MagicBricks`/`Magicbricks`) line up today only by luck of casing. `lib/seller/costs.ts`
compares on a normalised key (lowercased, non-alphanumerics stripped) instead of the raw string.
Safe in this taxonomy because it never merges genuinely distinct sources — `Society Data`,
`Society Data - WA Blast` and `Society Data - Cold Call` stay separate keys.

Check both vocabularies whenever you join sheet spend to CRM counts. The failure direction is
the dangerous one: a missing numerator makes a channel look cheaper, and nobody double-checks a
number that flatters them.

## 33. About 20% of seller spend carries no micromarket, and a place filter silently drops it

On the 2026-09-08 seller export, ₹2,33,191 of ₹11,73,207 (19.9%) has no usable micromarket:
`All MM` (14.6%, the tab's deliberate "not attributable" marker), a blank cell (4.6%), and
`Habibi` (0.7%) — a **cluster** name typed into the micromarket column. There is no basis to
split any of it across micromarkets, so it is counted in the unfiltered total and excluded
entirely under any micromarket or cluster filter.

That makes every filtered cost-per metric read low. Powai, for example: ₹1.85 L of Powai spend
against ₹1.48 L excluded as unallocated in the same window. The seller tab states the excluded
amount on screen for this reason (`components/seller/SpendNote.tsx`); the buyer tab computes the
same ingest report and renders none of it, so a filtered buyer CPL carries the same understatement
with no caveat.

Also on the tab: `Anthens`, a live misspelling of Athens (₹917). Unfixed, that money lands in the
unallocated bucket too. `lib/seller/spend/parse.ts` corrects it. `All MM` and blank are mapped to
unallocated **without** being reported as anomalies — flagging the single most expensive value on
the tab would train everyone to ignore the anomaly list — while `Habibi` and anything else
unrecognised **are** reported, because they are data-entry problems the growth team can fix.

## 34. Seller has no spend target, so no cost target can be derived

The buyer target grid (`lib/buyer/targets.ts`) carries a `spendInr` column, and buyer's target
CPL/CPQL/CPV/CAC are derived from it by division — they are not transcribed. The seller grid
(`lib/seller/targets.ts`, from Metabase card 739) has eight numeric columns and no spend column,
so Spend and all four seller cost metrics show a dash in every target column. Do not fill the gap
by pro-rating the buyer grid's spend into seller channels: a fabricated target renders identically
to a real one. Ask the growth team for a spend figure per channel × micromarket instead.

## 35. NoBroker was already correctly in seller 3P; Square Yards had no live rows to check against

Raised by the growth team on 2026-09-09 as "NoBroker and squareYards to be included in 3P for
seller side." Checked against a live `/api/seller` build the same day: `SELLER_CHANNEL_MAP`
already had `nobroker: '3P'`, and the 3P total (427) summed exactly to 99 Acres + Magicbricks +
Housing.com + NoBroker (35) + MyGate — so NoBroker was never actually missing. No live seller
carries anything resembling "Square Yards" yet (checked the same build), so there is no way to
confirm the exact `Seller_Source` spelling Zoho will write when one appears. Added `'square
yards': '3P'` (spaced) alongside the existing `squareyards` (unspaced) key, mirroring the
`'99 acres'`/`'99acres'` dual-key pattern already in the map — whichever spelling shows up first,
it won't silently fall through to `Unmapped`. Revisit once a real row exists to confirm the exact
casing.

**Follow-up, same day:** the growth team then reported NoBroker and Square Yards missing from
the Channel/Source **filter picker** specifically (not the channel map, which was already fine).
Root cause: `buildSellerSourceOptions` (`lib/seller/options.ts`) only listed sources from
`inPopulation` sellers — i.e. created inside the current quarter. All 35 live NoBroker records
predate JAS 2026 (sampled createdAt: 2025-07-26, 2025-03-04 ×4) — real 3P data, just entirely
Old-cohort, so it never got a picker checkbox even though it already counted in every Old-cohort
total. This was harmless while Visits/Conversions defaulted to New-only (an Old-only source's
checkbox would have shown zero data anyway) and became a real gap once the default moved to
New+Old the same day (see metric-definitions.md item 9). Fixed by dropping the `inPopulation`
restriction — the picker now reflects every source in `facts.sellers`, New and Old alike. Square
Yards still won't appear until a real row exists; that part needs no further code, just live data.

## 36. Both spend sheets are committed for the whole quarter up front, not filled in day by day

Reported by the growth team on 2026-09-09 against 3P specifically (99 Acres, Housing.com,
Magicbricks), but verified to be a dashboard-wide gap: BOTH `lib/seller/spend/spend-jas26.json`
and `lib/buyer/spend/spend-jas26.json` already carry real spend rows through `2026-09-30` (the
quarter end), while `now` that day was `2026-09-09` — three weeks of not-yet-incurred spend
already sitting in both sheets. Neither `computeSellerSpendForWindow` nor `computeSpendForWindow`
took `now` into account, so the QTD "Achieved" Spend row (and every cost-per metric built from
it: CPL, CPQL, CPV, CAC) summed the raw window regardless of whether those dates had actually
happened yet — overstating spend and understating cost-per across every channel, not just 3P.
Fixed in both `lib/seller/derive.ts` and `lib/buyer/derive.ts`: the QTD spend window's end is now
capped at `min(funnelEnd, now)` (clamped to not go below `funnelStart` either, for a fully-future
selected period). The Last 2-Week Spend column needed no change — its own window already ends at
the start of the current week, always `<= now` by construction. Verified live 2026-09-09: Seller
Spend Achieved read ₹9.83L (matching a raw sum of only in-window rows dated before `now`) against
₹9.96L for the full in-window total; Buyer read ₹41.50L against ₹43.49L.

## 37. A full-touch `Lead_Source_History` query can hit the 10,000-row COQL cap within one quarter

Trap #28 already covers COQL's live-API quirks; this is trap #13/#28's sibling on volume. The
growth-reporting dashboard's Overall Funnel "Total Leads" / "all touches" block reads every
`Lead_Source_History` row in the window, any `Serial_Number` — a lead that re-enquires gets a
second, third, ... row, unlike the first-touch attribution query (`Serial_Number = 1` only, ~4,800
rows/quarter) which stays comfortably under the 10,000-row cap for the same window.

Verified live 2026-09-15: fetching the full JAS 2026 quarter as a single COQL query 400'd with
`{"code":"LIMIT_EXCEEDED","details":{"limit":10000},"message":"max records limit exceeded"}`. The
call was wrapped in a catch that degrades gracefully rather than failing the whole page build
(the same pattern used for first-touch attribution failures), so the symptom was not an error
anywhere in the UI — it was a silent, plausible-looking **0** on that one metric.

**Fix:** always fetch this specific query on calendar-month slices (`monthSlices`), never the
single quarter-wide slice the lighter one-row-per-lead/bid/visit queries can safely share. See
`lib/buyer/lsh.ts`'s `fetchAllTouches` and its call site in `lib/buyer/aggregate.ts`.
## 38. `Society_Name` on `pre_qualified_data` is an empty string, never NULL

Found 2026-09-22, while checking whether the procurement dashboard's numerator could be built
out of the mirror at all.

`WHERE "Society_Name" IS NOT NULL` returns **57,759** rows — every row in the table. Live Zoho
COQL against the same module on the same day returns **57,379** not-null and **380** null. The
sync writes `''` where Zoho holds null, so the column is never null and the null test excludes
nothing.

`WHERE "Society_Name" <> ''` returns the right 380-row gap. Same shape as trap 4's ten blank
`Visit_Status` rows, but here it is not ten rows out of 11,877 — it is the difference between
reporting 99.3% field coverage and reporting 100%.

Assume this applies to every text column on every synced table, not just this one.

## 39. `societies."truva_qualified"` in TruIQ has seven values, not Yes/No

Verified live 2026-09-22 in Metabase **db 2 (TruIQ Production)**, `societies` (table 35):

| `truva_qualified` | Societies |
|---|---|
| `CHECK_PENDING` | 1,064 |
| `NO` | 549 |
| `YES` | **458** |
| `EXPLORE_LATER` | 134 |
| `UNDER_CONSTRUCTION` | 59 |
| `BUILDER_INVENTORY` | 22 |
| `CERTAIN_LAYOUTS` | 9 |

2,295 societies in total. Anything written as a two-state TQ filter — `tq_status=yes|no`, a
boolean, "the TQ societies" — silently picks one of several possible populations. The TQ set is
`YES`, 458 societies; `CHECK_PENDING` is the largest bucket and is not a no; and `CERTAIN_LAYOUTS`
is a partial qualification that nobody outside TruIQ has ruled on for reporting purposes.

The default is `CHECK_PENDING`, so a society nobody has assessed reads as the most common value
rather than as missing data.

## 40. The procurement numerator and denominator are in two different Metabase databases

Metabase cannot join across database connections, and these two are not even the same engine:

- **db 6, Zoho DB Sync (Postgres)** — `public.pre_qualified_data` (table 198), the procured
  records. Also `societies` (185) and `towers` (208), the Zoho hierarchy modules.
- **db 2, TruIQ Production (MySQL)** — `societies` (35), `towers` (14), `units` (11), which hold
  total unit counts and `truva_qualified`.

So any procurement ratio is two queries joined in application code, never one statement. Writing
it as a single query is not slow or ugly, it is impossible, and the first attempt at it will look
like a permissions problem.

**That join now lives in growth, not here** — see trap 42 for why. This dashboard reads the
finished ratio from `GET /api/procurement/societies` on growth and adds Airtable priority to it.

The join key is better than it looks, though, and worth knowing before anyone builds a fuzzy
society-name matcher: db 6 `societies` carries **`TruIQ_ID`**, and db 2 `societies` carries
**`zoho_record_id`**. The two hierarchies are already joined by id in both directions. Only
`pre_qualified_data` itself lacks an id — it carries `Society_Name`/`Tower_Name`/`Unit_Number` as
free text and has no lookup to the Societies module (checked against Zoho's field metadata
2026-09-22; the only structured field on it is the `Truva_Micromarket` picklist). So exactly one
fuzzy match is needed, `pre_qualified_data."Society_Name"` against db 6 `societies."Society"`,
and everything downstream of it is an exact id join.

## 41. `Tower_Name` and `Unit_Number` on `pre_qualified_data` are mostly empty

Measured 2026-09-22, out of 57,759 rows (`<> ''`, per trap 38):

| Column | Populated | Share |
|---|---|---|
| `Society_Name` | 57,379 | 99% |
| `Unit_Number` | 23,055 | 40% |
| `Tower_Name` | 21,331 | **37%** |

Any tower-level procurement breakdown built on this reports a third of the data as if it were all
of it. The society-level number is sound; the tower-level number is not, and it fails by
under-reporting rather than by erroring.

Separately, 1,134 rows have a `Society_Name` that is not a society name but the wreckage of a
clubbed string — real values include `- of Vasant Galaxy`, `- L of Great Eastern Kanjurmarg`,
`- S of Great Eastern Kanjurmarg` and `- of Mahindra Eminente`. These are not spelling variants
and no amount of normalisation or fuzzy matching recovers them; they need the one-time cleanup
tracked as `G-11` in the monorepo's `apps/growth/BACKLOG.md`.

One more thing that bites in the other direction: the top-level `Society_Name` is a projection of
the **first row** of the record's `Property_details` subform. A seller with two properties in two
different societies is attributed entirely to the first. The subform itself is available in the
mirror (`Property_details`, and the whole record as `_raw` jsonb), so counting per property rather
than per record is possible here in a way it is not through the Zoho API.

## 42. Metabase is IP allowlisted, and Vercel cannot be added to the allowlist

Found 2026-09-23, after concluding the opposite and being wrong.

`metabase.truva.in` is an internet-facing AWS ALB, but its security group
(`sg-0a9b9e3cc83cf0756`) allows 443 from ten entries only — nine `/32`s plus Anthropic's
`160.79.104.0/21`. **Testing reachability from a machine that is already on the list proves
nothing**, which is exactly the mistake that produced the first answer: both test paths were
allowlisted, one of them being the Claude MCP connector range.

Vercel cannot go on that list. Vercel Functions have no static egress IP below Enterprise
(Secure Compute), and the account here is on personal Hobby scopes. The only allowlistable
alternative is AWS's own `ap-south-1` EC2 ranges — 55 prefixes covering **2,191,376 addresses**,
i.e. every AWS customer in Mumbai — which is strictly worse than no allowlist, because it looks
like a control.

The same applies to every private source behind that VPC, so it is not a Metabase-specific
problem: the Zoho sync mirror and truiq's MySQL are equally out of reach from here.

**What to do instead:** let a service that IS inside the VPC compute the number and serve it.
`growth` runs on App Runner with a VPC connector (stable NAT egress `13.233.71.200`) and owns
`GET /api/procurement/society-progress` for exactly this reason. Anything this dashboard needs
from a private source has to arrive the same way.

That route is read with the `GROWTH_LEDGER_*` credentials already set here — same service, same
`x-api-key` gate, no new secret. growth's middleware does have a narrower `EXTERNAL_API_KEY` gate
for routes under `/api/external/`, but that variable is not set on growth-production (checked
2026-09-23), so a route under that prefix would have compared every request against `undefined`
and 401'd. The two branches also differ in status code: a bad `x-api-key` is **403**, a bad
`x-external-api-key` is 401.

One related gotcha, since CLAUDE.md's verification recipe depends on it: the
`metabase.truva.in/api/public/dashboard/...` endpoints used to check buyer metrics need no auth,
but they DO need an allowlisted IP. They work from a Truva machine and fail from CI or anywhere
else, which reads as a broken URL rather than a blocked one.

## 38. `Products.Min_Guarantee` is a real, live-populated field — verified for the "GMV Acquired" row

Not previously fetched by this dashboard. Confirmed to exist on the live Products module (not
just `docs/zoho-setup.md`, a stale Wire-era doc, and not just the Postgres mirror's schema) by
adding it to `lib/seller/aggregate.ts`'s `productFields` COQL SELECT and reading the result live:
QTD "GMV Acquired" (sum of `Min_Guarantee` over MoU-Signed properties whose
`Seller_MoU_Signing_Date` falls in-window, same population as Total Property Conversions) read
₹85.08 Cr on 2026-09-24 — a real, populated figure, not the 0 a missing/blank field would give.

Update 2026-09-24: "% Spends of GMV" originally rendered through the same whole-number
`Math.round` percent formatting every other `%` row in `TwoWeekTable.tsx` uses, and GMV vastly
exceeds Spend in this business (a real-estate rev-share model) — so it always printed "0%" even
though the underlying value is a genuine, non-zero fraction of a percent. Fixed per the user's
request: this one row now shows one decimal place (`pctDecimals` in `TwoWeekTable.tsx`), every
other percentage row is unchanged.

## 39. `Products.Acq_Status = 'Visit Completed'` has zero live matches (2026-09-24)

`ACQ_ALWAYS_VISIT_STATUSES` (`lib/seller/types.ts`) lists `'Visit Completed'` as one of 12
Case-3 statuses. Building the new "Post Visit TAT" chart (counts of properties currently at
Visit Completed / Sent for Valuation / Valuation Completed / Offer Made to Seller) surfaced
that the live dataset has 0 properties at that exact status, checked two ways: filtering
`facts.products` directly, and searching every distinct live `Acq_Status` value for one
containing both "visit" and "complet" (case-insensitive) — none exists. The other 3 stages in
the same chart are populated normally (17 / 18 / 14 as of this check).

**Not fixed here** — this is a pre-existing constant used throughout `derive.ts`'s qualifying-
visit classification, not something this session touched or is qualified to silently rename.
Could mean the status is genuinely just fast-transitional (properties move through it too
quickly to ever be caught mid-status), or that the live spelling has drifted since the constant
was written. Flagging so the next person doesn't waste time thinking their own new chart is
broken — it isn't; the bucket is just empty by design of whatever's actually going on upstream.

## 40. Post Visit TAT's 3 new stage-date fields are real and populated; the chart no longer reads `Acq_Status` at all

`Products.Valuation_Request_date`, `Pricing_completion_date` and `Offer_Date` (plus the
already-used `Visit_Date`) were added to `lib/seller/aggregate.ts`'s `productFields` COQL SELECT
2026-09-24 and confirmed live: fetching the JAS 2026 quarter returned 247 / 325 / 305 / 138
properties respectively for Visit Completed / Sent for Valuation / Valuation Completed / Offer
Made to Seller — all four real, non-zero, and none of them empty.

This makes trap #39 (`Acq_Status = 'Visit Completed'` has zero live matches) a non-issue for this
specific chart going forward: Post Visit TAT was rebuilt this same session to count a property
by whichever of these 4 date fields falls in the funnel window, **not** by matching the
property's current `Acq_Status` string — so #39's live-spelling-drift concern, whatever its root
cause turns out to be, doesn't block this chart. #39 itself is unresolved and still applies to
anything that DOES match on that exact status string.

**One assumption made, not independently verified**: these 4 date fields are treated as
lifecycle timestamps that stay populated once a property moves past that stage (so a property
now at "Offer Made to Seller" is assumed to still carry its earlier `Visit_Date`/
`Valuation_Request_date`/`Pricing_completion_date`). This was checked against the live JAS 2026
population only in aggregate (247/325/305/138 are each independently large, consistent with
overlapping cumulative counts, not 4 mutually-exclusive current-status buckets) — not
sellerId-by-sellerId. If a future session finds a property whose date field goes BLANK again
after it advances further (i.e. the assumption is false), the count semantics described in
`lib/seller/derive.ts`'s Post Visit TAT comment block would need revisiting.

## 43. The mirror's typed columns get three things wrong that `_raw` gets right (2026-09-28)

Found moving the dashboard off the live Zoho API onto growth's mirror endpoint. Each was checked
against live Zoho COQL the same day, and each gives a plausible wrong number, never an error. They
matter to anyone writing SQL against **Zoho DB Sync** in Metabase too, not only to growth.

- **Booleans from bulk-read rows are stored inverted.** The bulk loader writes the CSV string
  `"false"` and the typed boolean column comes out `true`. `deals."Was_Bid_Warm"` is true on
  11,900 rows; Zoho has 878 warm bids. `_raw->>'Was_Bid_Warm'` is right on every row (875 string
  `"true"` + 3 JSON `true` = 878). Any Metabase card filtering a boolean column is suspect.
- **`Leads.Truva_Cluster` is a multi-select, but `_meta_fields` still says `picklist`.** It was
  retyped in Zoho on 2026-09-09 and the mirror never updates a field's type after discovering it.
  Bulk rows hold it as `"GLAM;BABU"`, REST rows as a JSON array, and the typed column as text. Do
  not split every `;` value to compensate: `UTM_Micromarket` is a real picklist whose values
  include `"Powai;Vegas"`.
- **Lookups to deleted records keep their stale id.** The API returns `null` for them. 81 JAS 2026
  Lead_Source_History touches point at deleted leads, which a "has a lead" count would include.

Also: `_raw` has two shapes (bulk rows are all strings, `""` for empty; REST rows are typed JSON),
and the `<field>__name` lookup-name columns are empty on bulk rows.

What does hold: record sets. Every read this dashboard makes returned the same ids from the mirror
as from Zoho over JAS 2026, and datetime/date columns filter correctly. The mirror trails Zoho by
one sync cycle (median 10 minutes per module, measured over 24 hours).

growth's `CrmMirrorService` corrects all of the above; this dashboard sees API-shaped records.

## Adding to this file

When a new trap turns up, add it here with what was checked, what the wrong result looked like, and the date. A trap nobody wrote down gets rediscovered by the next person, at the same cost.
