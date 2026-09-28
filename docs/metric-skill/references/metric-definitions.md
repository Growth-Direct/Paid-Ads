# DRR metric definitions

The agreed definitions for the Truva DRR report, from the growth team's standardisation doc: [Truva DRR Report: Channel Mapping & Metric Logic](https://app.notion.com/p/truva-homes/Truva-DRR-Report-Channel-Mapping-Metric-Logic-3c13b7829f788038b848ff434ff28f01).

**This file is the authority on what a metric means. It is not the authority on how a value is spelled.** The Notion doc is written in business prose, and several status names in it do not match the strings actually stored in the database. Every value below has been checked against live data on 2026-08-29. Where the doc and the data disagree, the live string is given and the discrepancy is called out.

When someone asks for a DRR metric, use these definitions rather than agreeing a fresh one in the conversation. The definition card in step 2 should restate the definition from here so the person can confirm you picked the right metric, not so they can redefine it.

**Two sources of truth, and they no longer agree.** The seller definitions below come from the Notion doc. The **buyer** definitions come from the live buyer dashboard (`repos/growth-reporting`), which has deliberately moved away from the doc: it counts `Paused Search` as qualified, reads visit completion off the bid's `Stage` instead of `Visit_Status`, and applies four population rules the doc never mentions. Those changes were made with the growth team, so the dashboard is the buyer authority now and the doc is stale on the buyer side. Every buyer difference is marked **[dashboard]** below. A number built from the doc alone will not match the dashboard.

## Report structure

Everything is cut **Quarter → Micromarket → Channel → Property**, and needs to work at day on day, week on week, and month on month.

Two reports, Buyer and Seller. Same core metrics, different definitions of a lead, a visit and a conversion. Don't mix them.

## The casing problem, read this before writing any filter

Status strings in the doc do not match the database. An exact-match `IN (...)` built from the doc silently returns the wrong number with no error.

**On `leads` and `sellers`:**

| Doc says | Database actually holds | Where | Cost of using the doc string |
|---|---|---|---|
| `In Follow Up` | `In follow Up` | `leads.Lead_Status` | 450 qualified leads dropped |
| `Site Visit Scheduled` | `Site visit Scheduled` | `leads.Lead_Status` | 306 qualified leads dropped |
| `Visit to be Scheduled` | `Visit to be scheduled` | `leads.Lead_Status` | 36 qualified leads dropped |
| `Not Qualified` (seller) | `Not qualified` | `sellers.Call_Status` | the whole bucket returns 0 |

Buyer qualified leads come out **13.8% low** if you use the doc's spellings (4,932 instead of 5,724, leads created since 2026-01-01).

**On `products.Acq_Status`, the 2026-09-01 rewrite introduced eleven more.** The doc writes the new Case 2 and Case 3 lists in sentence case; the database is Title Case throughout. None of these error — they just fail to match, and a Case 3 status that fails to match silently stops counting as a visit.

| Doc says | Database actually holds | Properties affected |
|---|---|---|
| `Mou signed` | `MoU Signed` | 246 |
| `Deal lost` | `Deal Lost` | 1,686 |
| `Explore Later - Post visit` | `Explore Later - Post Visit` | 274 |
| `Sent for valuation` | `Sent for Valuation` | 53 |
| `Offer made to broker` | `Offer Made to Broker` | 46 |
| `Valuation range received` | `Valuation Range Received` | 75 |
| `Offer made to seller` | `Offer Made to Seller` | 24 |
| `Offer range rolled out` | `Offer Range Rolled Out` | 19 |
| `Awaiting data from acquisitions` | `Awaiting Data from Acquisitions` | 9 |
| `Revaluation requested` | `Revaluation Requested` | 4 |
| `Pitched to seller` | `Pitched to Seller` | 5 |

Copy the Title Case strings from the Case tables in the seller-visits section, not from the doc. `Request Valuation Range`, `Visit Completed`, `Negotiations`, `Valuation Completed`, `Internally Rejected`, `Recycled`, `Junk`, `Visit to be Scheduled`, `Visit Scheduled` and `Explore Later - Pre Visit` the doc happens to spell correctly.

The doc used to mis-spell `Visit to be Scheduled` and `Visit Scheduled` for products; the rewrite fixed both, so those two are no longer traps.

Note the same words are capitalised differently in different tables: `Visit to be scheduled` on leads, `Visit to be Scheduled` on products. Copy the exact string from this file for the table you are querying.

**Safest habit:** compare case-insensitively with `lower()` on both sides, so a future casing change does not silently break a chart.

## Buyer channels

Mapped from `leads."Lead_Source"`. Counts are leads created since 2026-01-01, checked 2026-08-29.

| Channel | Sources (exact live strings) | Leads |
|---|---|---|
| Paid Ads | `Meta`, `Google Ads`, `LinkedIn`, `Paid Ads (Unattributed)` | 9,202 |
| 3P | `99Acres`, `Housing`, `Magicbricks` | 2,364 |
| Offline Branding | `Offline Branding` | 364 |
| Society WA Groups & Management Apps | `Society WA Groups`, `Society Management App`, `Society Data` | 154 |
| Organic | `Website`, `Instagram`, `WhatsApp`, `Organic` | 1,898 |
| Referral & WOM | `Word of Mouth`, `Referral`, `Seller Referral` | 110 |

**[dashboard] Four sources are excluded from the buyer population outright**, not mapped to a channel:

`Channel Partner`, `Builder`, `NoBroker`, `Society Partners`

`Channel Partner` and `Builder` are direct-growth scope, which the Notion doc never wrote down. `NoBroker` and `Society Partners` are the dashboard's own additions: Metabase counts NoBroker as 3P, but buyer-side direct reporting never does.

**[dashboard] `Seller Referral` was returned to the population on 2026-09-16**, at the growth team's explicit decision: a seller referral is Truva's own demand, not a partner's, so it counts as direct. It maps to the **Referral & WOM** channel (which already carries a target) rather than a channel of its own. This reverses the earlier rule and has consequences worth stating every time this number is presented:

- **The Metabase gap now runs both ways.** Metabase's `leads_eligible` CTE still drops `seller referral`, so buyer lead counts sit slightly ABOVE Metabase's on that volume, while still sitting below on NoBroker/Society Partners. The two do not cancel out.
- **Earlier quarters are not comparable** on any buyer metric without recomputing them, since roughly 40 leads a quarter re-enter Total Leads, Qualified, LTQL %, visits, conversions and the cost-per metrics.
- **Referral & WOM will read worse against its target**, which was set for a channel that did not include these leads.
- **First Response Time still excludes it** (`FRT_EXCLUDED_SOURCES` in `lib/buyer/derive.ts`), which keeps its own exclusion list for its own reasons. That was not part of the decision and remains an open question.

**`Society Partners` is PLURAL.** Verified against 24 months of `Lead_Source` values: 2 leads, and the singular "Society Partner" does not exist, so matching on it would silently exclude nothing. It is partner-sourced and is *not* the same as the direct `Society WA Groups` / `Society Management App` / `Society Data` sources, which stay in the population.

**[dashboard] Junk casings are folded, not dropped:** `google_ads` and `google` → Paid Ads, `fb` → Paid Ads, `ig` → Instagram → Organic.

**Never let an unmapped source vanish.** Bucket anything unrecognised as `Unmapped` and keep it on the chart. A source silently dropped is a number nobody can reconcile; a visible `Unmapped` bar gets fixed.

The Notion doc says "all 6 channels" but lists seven, counting Seller Referral as its own. The dashboard's taxonomy is six channels plus `Unmapped`, with Seller Referral folded into Referral & WOM rather than standing alone.

## Seller channels

Mapped from `sellers."Seller_Source"`.

| Channel | Sources |
|---|---|
| Paid Ads | `Meta`, `Google Ads`, `LinkedIn`, `Paid Ads (Unattributed)`, `Society Data - Meta` |
| 3P | `99 Acres`, `Housing.com`, `Magicbricks`, `NoBroker`, `MyGate`, `SquareYards` |
| Offline Branding | `Offline Branding` |
| Society WA Groups & Management Apps | `Society WA Groups`, `Society Management Apps`, `Society Data - WA Blast` |
| Organic | `Website`, `Instagram`, `WhatsApp`, `Organic` |
| Referral & WOM | `Word of Mouth`, `Referral`, `Seller Referral` |
| Cold Outreach | `Society Data - Cold Call`, `Society Data - AI Calling`, `Society Data` |

**`Society Data` means different things on the two sides.** On buyer it is Society WA Groups & Management Apps. On seller it is Cold Outreach. Same string, different channel. Check which report you are in.

Seller source strings in the live data differ slightly from the doc: the database holds `99 Acres` (with a space), `Housing.com`, `Society Whatsapp`, `Society Management Apps`, and the junk variants `google_ads`, `IG` and `Ads`. See `table-map.md` for the full live list with counts.

## Spend

Captured wherever spend exists for the channel.

- **Paid Ads:** platform spend from Meta, Google and LinkedIn.
- **Offline Branding and 3P:** entered manually.
- **Other channels:** follow the existing Targets/report structure for whether spend applies at all.

Where a channel has no spend, cost-per metrics are not applicable. Show them blank, not zero. A zero reads as free.

## Buyer metrics

Population is leads in the selected Quarter, at Micromarket and Channel level.

| Metric | Definition |
|---|---|
| Total Leads | Count of all leads. |
| Qualified Leads | `Lead_Status` in `Qualified`, `Site visit Scheduled`, `In follow Up`, `Pre Qualified`, `Purchased with Truva`, `Purchased Outside Truva`, `Visit to be scheduled`, **[dashboard]** `Paused Search`. |
| Not Qualified Leads | `Lead_Status = 'Not Qualified'`. |
| Lead → Qualified % | Qualified Leads ÷ Total Leads × 100. |
| CPL | Spend ÷ Total Leads. |
| CPQL | Spend ÷ Qualified Leads. |
| Visits | **[dashboard]** An `events` row with `Module = 'Bid'`, joined to its bid, where the **bid's `Stage` is anything other than `Unassigned`, `Pre-Visit` or `Cancelled`**. Same person counted once per quarter. |
| New Visit | Lead created in the same quarter as the visit. |
| Old Visit | Lead created before the current quarter. |
| Total Visits | New + Old. |
| Unique Visits | Distinct people who completed a visit. |
| Cost per Visit | Spend ÷ **New** Visits. |
| Conversions | `deals."Stage" = 'Closed - Won'` with `Buyer_MoU_Signing_Date` in the quarter. The conversion date is the **MoU signing date**, not the stage change date. |
| New Conversion | MoU signing date and lead creation date both in the current quarter. |
| Old Conversion | MoU signing date in the current quarter, lead created in an earlier quarter. |
| Conversion % | Total Conversions ÷ Total Visits × 100. |
| Cost per New Conversion | Spend ÷ New Conversions. |

**[dashboard] `Paused Search` is qualified.** The doc omits it. It is a real status (26 leads) and the growth team asked for it in, so any qualified count built from the doc's seven statuses is short by however many `Paused Search` leads the window holds.

**[dashboard] Visits moved off `Visit_Status`.** The doc says a visit is `events."Visit_Status" = 'Visit Complete'`. The dashboard reads completion off the linked bid's `Stage` instead, treating everything except `Unassigned`, `Pre-Visit` and `Cancelled` as visited. The two were reconciled live at 92.5% agreement before the switch, so they are close but not equal. Do not mix them in one chart.

### [dashboard] Four buyer population rules the doc does not mention

All four narrow the population, so dashboard numbers sit below Metabase's and below anything built from the doc alone. That gap is the rule, not a bug.

1. **Virtual micromarkets are excluded entirely** — leads, qualified leads, visits and conversions, not just the per-micromarket charts. Matched on the `(virtual)` substring rather than a fixed list, because the names are free-form and new ones keep appearing: live values are `Airport (Virtual)`, `Mainland (Virtual)`, `Viceport (Virtual)`, `Leaf Links (Virtual)`. A lead keeps its real micromarkets and only drops out when *every* one it carries is virtual. A blank micromarket is not virtual and still counts.
2. **Channel-Partner bids are excluded at the bid level.** A bid whose own `deals."Lead_Source"` is `Channel Partner` drops, taking its visit, its warm flag and its conversion with it — but the lead behind it stays and can still qualify. This is independent of the lead's own source, and null-safe: source-less bids survive.
3. **A lead is a phone number, not a CRM record.** The key is the last 10 digits of `Phone`, falling back to `Mobile`, or the record id when neither yields 10 digits — so phone-less leads never merge with each other. Rows are not merged: one per phone group is elected the survivor and the counting metrics filter on it, which keeps drill-downs pointing at real records. The election must run **after** every exclusion, or a dropped lead can be elected the survivor of its group.
4. **Never AND cluster against micromarket on a lead.** They come from two unrelated fields that disagree on about a third of records. Selecting a cluster already selects its micromarkets, so the micromarket filter carries the whole intent. Measured 2026-09-02: GLAM + Paid Ads for JAS 2026 is 996 leads by micromarket but only 690 also carry `Truva_Cluster = 'GLAM'` — the AND under-reported by 31%. The exception is the live-house card, where the cluster sits on the property and filtering on it is correct.

Qualified and Not Qualified do not sum to Total Leads. Statuses like `Inactive` (2,973), `Call Later` (591) and `Attempted to Contact` (558) sit in neither bucket. Never present them as a two-way split.

**Telephony junk in `Lead_Status`.** `Open - Disconnected` (908), `Network Issue` (45), `Customer Network Issue` (10), `Call Rejected` (8), `Not Reachable` (7), `Unallocated Number` (6), `Receiver is busy` (3), `System Failure` (1). These are Acefone dispositions, not statuses. **Map them into `Attempted to Contact`, do not drop them** — they are real leads someone tried to reach. Doing so takes ATC from 558 to about 1,546, so it materially changes any status distribution.

`Paused Search` (26) is a real status, not junk.

## Seller metrics

| Metric | Definition |
|---|---|
| Seller Leads | Count of **unique sellers, deduplicated on phone number**. Not a row count. |
| Qualified Seller Leads | Unique sellers where `Call_Status` in `Qualified`, `Explore Later`, `Prospect`. |
| Not Qualified Seller Leads | Unique sellers where `Call_Status = 'Not qualified'` (lowercase q). |
| Seller Lead → Qualified % | Qualified ÷ Seller Leads × 100. |
| Cost per Seller Lead | Spend ÷ Seller Leads. |
| Cost per Qualified Seller Lead | Spend ÷ Qualified Seller Leads. |

**Changed on the Notion doc 2026-09-07: `Already sold the flat` dropped from the qualified set, `Prospect` added.** Verified directly against the doc, same day. Note this `Prospect` is `sellers."Call_Status"` (a live, populated status) — a different field from the retired, zero-row `products."Acq_Status" = 'Prospect'` mentioned in the seller-visits Case 2 list below. Don't conflate the two just because they share a name.

Qualified and Not Qualified are independent measures here and **do not add up to Seller Leads**. The doc says this explicitly. Do not build a chart implying they do.

`sellers."Lead_Type"` is dead and must not be used for any of this. See known-traps.

### Seller visits

**This replaced the old single-exclusion rule on 2026-09-01.** A visit used to be any property whose `Acq_Status` was filled, except five statuses. It is now three cases, and `Visit_Date` decides both whether a property counts and which quarter it lands in. **The three cases below are the New-cohort rule — Old is different, see the Old Visit row further down, easy to miss on a fast read.**

The three cases, with the live `products."Acq_Status"` spellings and counts (VCV excluded, all time, checked 2026-09-07):

**Case 1 — never a visit, whatever the dates say.**

| Status | Properties |
|---|---|
| `Visit to be Scheduled` | 512 |
| `Explore Later - Pre Visit` | 231 |
| `Visit Scheduled` | 129 |
| `Junk` | 112 |

**Case 2 — a visit may or may not have happened, so it counts only when `Visit_Date` is present, and attributes on that date.** No fallback: no `Visit_Date` means no visit.

| Status | Properties | With `Visit_Date` |
|---|---|---|
| `Internally Rejected` | 604 | 395 |
| `Valuation Range Received` | 75 | 31 |
| `Request Valuation Range` | 19 | 0 |
| `Pitched to Seller` | 5 | 5 |
| `Recycled` | 4 | 3 |

**Case 3 — a visit is always conducted, so it always counts *for the New cohort*. Attributes on `Visit_Date`, falling back to the parent seller's creation date when there is no `Visit_Date`.**

**This "always counts" exception is New-cohort only — read the Old Visit row below before assuming it's universal.** The Notion doc's Old Visit section drops Case 3 entirely: for an Old-cohort seller, *every* non-Case-1 status (both what's Case 2 and Case 3 for New) needs a `Visit_Date` that falls **within the current reporting quarter**, with no fallback to any other date. This makes sense once you think about why the fallback exists at all — for a New seller, "falls back to the parent seller's creation date" lands the visit in the current quarter, because New means created this quarter. For an Old seller, that same fallback would be meaningless (they weren't created this quarter), and the status alone can't tell you *which* quarter the visit happened in — a `Deal Lost` property could have reached that status in any quarter since the seller was created. An in-quarter `Visit_Date` is the only evidence available. Verified against the Notion doc directly, 2026-09-07 — the "Old Visit" section is not the "New Visit" rule re-applied, it's a materially different one, and it's easy to miss because Case 1/2/3 aren't relabelled for it, so a fast read assumes the New-cohort table above still governs.

| Status | Properties | With `Visit_Date` |
|---|---|---|
| `Deal Lost` | 1,686 | 1,270 |
| `Explore Later - Post Visit` | 274 | 245 |
| `MoU Signed` | 246 | 246 |
| `Sent for Valuation` | 53 | 53 |
| `Offer Made to Broker` | 46 | 46 |
| `Valuation Completed` | 44 | 43 |
| `Offer Made to Seller` | 24 | 23 |
| `Offer Range Rolled Out` | 19 | 11 |
| `Negotiations` | 11 | 11 |
| `Awaiting Data from Acquisitions` | 9 | 9 |
| `Visit Completed` | 8 | 8 |
| `Revaluation Requested` | 4 | 4 |

`Attempted to Contact` is explicitly ignored. So is the empty-string status (3 properties), which belongs to no case — the old rule excluded it as "not filled", and the case lists exclude it by omission.

**What this changed, in numbers.** On the mirror the old rule qualified **2,527** properties; the three cases qualify **2,858**. That is **+331, or +13%**, and almost all of it is one status: `Internally Rejected` moved from never-count to count-with-a-visit-date, worth +395 on its own. Anyone still running the old rule is 13% low. See known-traps.

The doc's own Case 2 list also names `Qualified` and `Prospect`, and its "ignore" line names `Attempted to Contact`. **All three return zero rows in `products."Acq_Status"` today.** They existed on 2026-08-29 (`Prospect` 10, `Qualified` 5, `Attempted to Contact` 5) and were cleaned out in the week after. Keep them in any `IN (...)` list so the rule still holds if they come back.

| Metric | Definition |
|---|---|
| New Visit | Parent seller created in the current quarter. Case 3 always counts; Case 2 counts with any `Visit_Date`. |
| Old Visit | Parent seller created before the current quarter. **No "always counts" exception** — every non-Case-1 status needs a `Visit_Date` falling **within the current quarter**, same rule for what's Case 2 and Case 3 on the New side. |
| Total Visits | New + Old. |
| Unique Sellers Visited | Distinct sellers with at least one qualifying visited property. |
| Cost per Visit | Spend ÷ **New** Visits. |
| Qualified Properties | Count of every property (any `Acq_Status`) belonging to a Qualified seller. Renamed from "Properties" and rescoped to Qualified sellers only in the Notion doc on 2026-09-07 — it previously read "count of properties for the Micromarket + Channel, regardless of acquisition status" with no Qualified-seller restriction. |
| Properties per Seller | Properties ÷ Seller Leads. |

Join properties to sellers on `products."Seller"` (text) → `sellers."_id"`. Never the bigint `id`.

**Unresolved: is a seller visit counted per property or per seller?** The doc opens the section with "if a seller has multiple properties, even if 1 of his property qualifies for a visit... we will count that as a unique seller visit", which reads as deduplicated to the seller. It then lists **Unique Sellers Visited** as a separate metric alongside Total Visits and Properties, which only makes sense if Total Visits is per property. Both readings cannot hold. Until the growth team settles it, count per property and show Unique Sellers Visited beside it, and say which one a number is.

**The `Deal Lost` caveat still stands, and the new rule makes it explicit rather than fixing it.** `Deal Lost` is 1,686 of the 2,858 qualifying properties, 59% of all seller visits. It is a terminal status reachable from any stage, so it does not by itself prove a visit happened, and 416 of those rows have no `Visit_Date` at all. **The consequence now splits by cohort, which the all-time count above doesn't distinguish:** for a New-cohort seller, a date-less `Deal Lost` still counts, attributed to the quarter the seller arrived, on no evidence a visit occurred. For an Old-cohort seller, the same date-less row now counts for **nothing** — no fallback applies, so it silently drops out of every Old Visit count rather than being misattributed. Both are worth saying out loud before anyone presents a number, for opposite reasons (one overcounts on weak evidence, the other undercounts on missing data) — the 2,858/416 figures haven't been re-split by cohort to know which effect dominates.

### Seller conversions

A conversion is a property with `Acq_Status = 'MoU Signed'` (323 properties all-time) **whose `Seller_MoU_Signing_Date` falls within the current reporting quarter.** The signing-date requirement was added to the Notion doc on 2026-09-07 — before that, status alone was sufficient. Verified directly against the doc, same day.

**This mostly changes Old conversions, not New.** A New-cohort seller's MoU date, if present, can't predate the seller's own in-quarter creation and (viewed from inside that same quarter) can't be in the future either — so it's already guaranteed to fall in-quarter, and the gate is a no-op for New. An Old-cohort seller could have signed in any quarter since they were created, and `Acq_Status = 'MoU Signed'` alone can't tell you which one — the signing-date gate is what actually does the filtering there.

New and Old follow the parent seller's creation quarter, same as visits. Total Conversions = New + Old. Conversion % = Total Conversions ÷ Total Visits × 100. Cost per New Conversion = Spend ÷ New Conversions.

## Target and DRR calculations

Targets are entered manually per Quarter + Micromarket + Channel.

| Metric | Definition |
|---|---|
| Target Achievement % | Actual ÷ Target × 100. |
| Expected Achievement % | Days elapsed in quarter ÷ total days in quarter × 100. |
| Expected Value | Quarterly Target × Expected Achievement %. |
| Gap vs Expected | Actual − Expected Value. |
| Required Future Pace | Remaining Target ÷ remaining days or weeks. |

Expected Achievement assumes demand is flat across the quarter. It is a pacing yardstick, not a forecast. Say so if someone reads a gap as underperformance.

## Micromarkets and clusters

| Cluster | Micromarkets |
|---|---|
| PAV | Powai, Vegas, Athens |
| GLAM | Glasgow, Amsterdam |
| BABU | Boston, Barcelona, Singapore |
| HABIBI (Bangalore) | Berlin, Hong Kong, Helsinki |

The doc has a typo, "Hong Kond". The live value is `Hong Kong`.

**`Truva_Micromarket` on `leads` is a text array**, because a lead can carry several. Where a record has multiple tags, **use the first**: `"Truva_Micromarket"[1]` in Postgres. On `products`, `events` and `sellers` it is a plain text column.

`VCV` is not a real cluster and is excluded from everything. See the always-on defaults in SKILL.md.

Cluster data quality is poor on sellers: `Unknown` is the largest bucket at 4,733 of 9,749. Cluster-level seller reporting will have a large unknown segment. Show it, don't hide it.

## Open questions

Raise these when they become load-bearing, rather than quietly picking an answer.

1. **Is a seller visit per property or per seller?** The doc says both in the same section. See the seller-visits section. This is the one that changes a headline number, so settle it first.
2. **Does the Notion doc get updated to match the buyer dashboard, or does the dashboard get reverted?** The buyer side now has two authorities that disagree on qualified statuses, the visit definition and four population rules. Right now anyone reading the doc and anyone reading the dashboard get different numbers and both think they are right.
3. `Awaiting Data from Acquisitions` sits in Case 3, so it counts as a visit unconditionally even though the name suggests the visit has not happened yet. Only 9 properties, but it contradicts the logic of Cases 1 and 2.
4. `Qualified`, `Prospect` and `Attempted to Contact` are named in the doc's seller-visit rules but have no rows in `products."Acq_Status"` any more. Were they retired deliberately, or renamed into something now being counted elsewhere?
5. **The growth-reporting dashboard now counts "Seller Visits" as unique sellers, not properties, in its Quarterly Performance pacing table, QLTV% and conversion rate** — changed 2026-09-07, in a working session building the Seller tab's Overall Funnel chart. This directly overrides this doc's own stated interim guidance on open question #1 above ("count per property and show Unique Sellers Visited beside it"): the session was asked to redefine it dashboard-wide and did, knowingly diverging. **It does not settle question #1** — it is one more reader picking an answer, which is the exact failure this list exists to prevent. The per-property count survives only as funnel-diagram context ("Qualifying Properties"), no longer as an actual, target or rate anywhere. The growth team needs to either ratify this reading or have the dashboard reverted to per-property. See `lib/seller/derive.ts`'s `computeActuals` (the `visits`/`qualifyingProperties` split) and `components/seller/OverallFunnel.tsx`.

6. **The growth-reporting dashboard applies a Call_Status ("Qualified seller") gate to Qualifying Properties, Unique Seller Visits and Visits in Pipeline — partially, but not fully, confirmed since.** Added 2026-09-07 as a dashboard-only extension, reasoning that Qualified Leads and property-based metrics come from two independent Zoho fields (`Call_Status` vs `Acq_Status`) with no natural subset relationship. The same-day Notion update (see "Resolved" below) confirms the gate belongs on the **"Qualified Properties"** metric specifically — that metric is now explicitly "properties of each qualified seller" in the doc itself. But the doc still says nothing about gating **Qualifying Properties (the Acq_Status-qualifying count), Unique Seller Visits, or Visits in Pipeline** on `Call_Status` — those three remain a dashboard-only addition beyond what's written here, not yet ratified. See `lib/seller/derive.ts`'s `computeActuals` (the `seller.isQualified` check in the qualifying-property and pipeline loops).

**Resolved since the last revision.** The dashboard adopted the 2026-09-01 three-case visit rewrite on 2026-09-07 (`lib/seller/types.ts`'s `ACQ_NEVER_VISIT_STATUSES`/`ACQ_DATED_VISIT_STATUSES`/`ACQ_ALWAYS_VISIT_STATUSES`, `lib/seller/derive.ts`'s `classifyAcqStatus`) — it no longer runs the pre-rewrite single-exclusion rule, so the ~13% undercount this doc measured against that rule no longer applies to this dashboard. The Notion doc's `Properties` metric was renamed `Qualified Properties` and rescoped to Qualified sellers only, same day — this independently confirms the dashboard's `qualifiedSellerProperties` metric (see item 6 above for the part that's still unconfirmed). The Notion doc also added a `Seller_MoU_Signing_Date`-in-quarter requirement to Seller Conversions, same day — the dashboard adopted it in `lib/seller/derive.ts`'s conversions loop; in practice this mostly changes Old conversions, since a New seller's signing date (if present) is already guaranteed to fall in-quarter.

**Answered since the last revision.** `Channel Partner`, `Builder`, `NoBroker` and `Society Partners` are excluded from the buyer population — the dashboard settled this. `Seller Referral` was also excluded until 2026-09-16, when the growth team reversed it; it now counts as direct, under Referral & WOM (see the buyer-channels section above). `Deal Lost` without a `Visit_Date` keeps counting, and Case 3 now attributes it on the parent seller's creation date instead of leaving it undefined.

7. **"Qualified Property Leads" target = 1.2× the Total Leads target has no basis in the doc or
   the target grid — it is a placeholder the growth team gave verbally in a 2026-09-08 working
   session (building the Seller "Target vs Achieved" table), with an explicit request to be
   reminded to double-check it before treating it as final.** The target grid has no column for
   this metric at all; every other target on that row (leads, QL, visits, conversions) comes
   straight from the channel × micromarket grid, but this one number is invented. See
   `lib/seller/derive.ts`'s `QUALIFIED_PROPERTY_LEADS_TARGET_MULTIPLIER`.
8. **The Overall Funnel's new "Total Conversions (Channel Partner + Direct)" float box is a
   dashboard-only reading with no equivalent in the doc.** Channel Partner-sourced sellers are
   excluded from the DRR population everywhere else on this dashboard (per the exclusion above);
   this one box adds their MoU-Signed, in-window conversions back on top of Direct's own New+Old
   total, per an explicit 2026-09-08 request. It is not documented anywhere as an agreed DRR
   metric — flagging so nobody mistakes it for one. See `lib/seller/derive.ts`'s
   `computeChannelPartnerConversions` and `lib/seller/aggregate.ts`'s `channelPartnerProducts`
   pool.

   **Updated 2026-09-09, per an explicit growth-team request: this box now honours the
   Micromarket/Cluster filter.** The 2026-09-08 reasoning above ("Channel Partner sellers have
   no channel taxonomy of their own to filter by") turned out to be only half right — it's true
   of channel/source, but Channel Partner sellers ARE real `Sellers` records and Zoho's
   `Truva_Micromarket`/`Truva_Cluster` fields are already fetched for every seller regardless of
   source. They just weren't being carried through to this pool. Picking a micromarket now
   shrinks the Channel Partner portion of this box the same way it already shrunk the Direct
   portion — verified live 2026-09-09: JAS 2026 unfiltered is 40, filtered to Powai drops to 9.
   The box still ignores channel/source and the visit/conversion scope pills (New/Old) — that
   part of the 2026-09-08 reasoning still holds. See `lib/seller/filters.ts`'s `placeMatches`
   and `lib/seller/facts.ts`'s `channelPartnerPlaces`.
9. **The Visits and Conversions scope pills (New/Old) default to BOTH selected ("Overall") on
   this dashboard, not to New-only.** Changed 2026-09-09, per an explicit growth-team request.
   Metabase's own pills default to New only — this is a deliberate divergence, not a bug, so a
   seller-side visit/conversion number here that reads higher than the equivalent Metabase card
   is expected: this dashboard is combining both cohorts where Metabase's default view is not.
   Affects the Overall Funnel's `uniqueSellerVisits`/`conversions` (and everything downstream of
   the visitScope/conversionScope filter, e.g. the Micromarket Analysis visits bullet chart) —
   NOT the Target vs Achieved table's own New/Old/Total rows, which were already unconditional
   regardless of these pills (CLAUDE.md's "Three different 'visits' numbers coexist" note) and
   are unaffected either way. See `lib/seller/filters.ts`'s `EMPTY_SELLER_FILTERS`.
10. **The seller reporting quarter start moved from Jul 5 to Jul 1, matching the Buyer tab's
    calendar quarter exactly.** Changed 2026-09-09, per an explicit growth-team request. This
    is a deliberate divergence from Metabase, made with the tradeoff explained up front: Jul 5
    was not arbitrary — it mirrors Metabase card 739's own hardcoded pacing/cohort-split anchor
    (`CURRENT_DATE - DATE '2026-07-05'`, verified live 2026-09-02 against real Metabase numbers).
    From this quarter on, this dashboard's seller pacing % and New/Old seller cohort counts will
    disagree with Metabase's own card by construction — any seller created Jul 1–4 now counts as
    New here but would still read as pre-quarter (effectively Old/excluded) against Metabase's
    Jul 5 anchor. The Seller side's spend/cost-per figures also shift slightly: the "Seller side
    spends" sheet has real spend rows dated Jul 1–4 that were previously excluded and are now
    in-window. See `lib/seller/types.ts`'s `SELLER_QUARTER_START_ISO` doc comment.
11. **The Target vs Achieved table's editable "Next 2wk Target" column (and the separate "Next
    Actionables" section) were removed entirely, 2026-09-29, per an explicit growth-team
    request, on both Buyer and Seller.** Replaced by a computed "Weekly Pace Needed" column:
    `(quarter target − QTD achieved) ÷ weeks remaining in the real quarter` — always measured
    against the true quarter (today through quarter-end), never the Time filter's window, so a
    filter narrowing to a channel/micromarket/source still changes the number (through the
    target/achieved it's built from) but a filter narrowing to a past date range does not change
    what "weeks remaining" means. Null for rate metrics (a % or cost-per-X row doesn't
    accumulate) and floored at 0 once already past target. This replaces both the old hand-typed
    per-channel/per-micromarket "Next 2wk Target" breakdown (items previously described here)
    and the free-text "Next Actionables" box — the growth team no longer types in a projection
    that goes stale; the dashboard computes what's actually required. No Metabase equivalent
    (same as item 8 below). See `lib/buyer/derive.ts`'s and `lib/seller/derive.ts`'s
    `weeklyPaceNeededFor`.
12. **New buyer-side metric, "Direct % of Bids" — a company-wide Direct-vs-Channel-Partner
    split, with no doc or Metabase equivalent.** Added 2026-09-15, per an explicit growth-team
    request to see "where we stand against CP" — until now Channel Partner was only ever an
    *exclusion* (CP-sourced bids drop their visit, warm flag and conversion everywhere else on
    this dashboard, per the population rule above), and nothing measured how large the excluded
    slice actually is. Scope is **bids (Deals), not leads** — `deals."Lead_Source"` is the bid's
    own source, same field the CP exclusion itself reads. Formula: Direct bids ÷ (Direct +
    Channel Partner bids) × 100, over the same QTD and Last-2wk windows as every other Target vs
    Actuals row; bids with no `Lead_Source` (~17 of ~10,933 over 24 months, historically) are
    excluded from both sides rather than guessed at. **Deliberately company-wide**: unlike every
    other row in that table, this one ignores the dashboard's Channel/Micromarket/Source filters
    — it always reads the true overall split, by design, not a bug if it doesn't move when you
    filter. No target exists for it (nobody's set one) — renders as "—" in the Target/Lag
    columns, same as the existing `Total Leads (LSH)` row's own no-target treatment. See
    `lib/buyer/derive.ts`'s `directShare()` and `lib/buyer/facts.ts`'s `BidSourceFact`.

    **⚠️ Unverified against live Zoho as of 2026-09-15.** The session that built this had no Zoho
    credentials available, so the new query (`lib/buyer/aggregate.ts`'s `bidSourcesQ` — a 4th
    Deals fetch, `SELECT id, Lead_Source, Created_Time FROM Deals WHERE Created_Time BETWEEN
    ...`, since none of the other 3 Deal fetches cover "every bid in the quarter") could not be
    run against the real CRM. It degrades to an empty result (row reads "—") rather than
    breaking the dashboard if the field name or query shape turns out to be wrong, but that
    degradation itself is also unverified live. **Confirm this row shows a real, sane number the
    first time it runs against production Zoho before trusting it**, and update this note once
    checked (Step 9 of `docs/metric-skill/SKILL.md`: append what was verified and when).
13. **New buyer-side metric, "Unique Gross Visits" — dedupes on (person, property), not person
    alone, per explicit growth-team request.** Added 2026-09-15. Every other visit metric on this
    dashboard (`Unique Visits`, the Target vs Actuals table's `New/Old/Total Visits` rows) dedupes
    a visit purely on the buyer's phone number: today, the same person visiting two different
    flats in one week already counts as one visit. This new metric relaxes that specifically for
    a new WoW chart in the Pre-sales section: the same buyer revisiting the **same** flat still
    counts once, but visiting a **different** flat counts as a second "unique gross visit." Same
    per-week-bucket grain as `Unique Visits` (not per-quarter) — computed in the same loop over
    `facts.visits` in `lib/buyer/derive.ts`, just with `${idx}|${person}` extended to
    `${idx}|${person}|${propertyId}`. A visit whose bid carries no property value is grouped under
    `'Unknown'` rather than dropped, same null-safe treatment as every other exclusion/grouping
    key in this codebase.

    **Property identity, and its own live-Zoho caveat.** No property/unit identifier was fetched
    anywhere in this codebase before this change — `VisitFact` only ever carried a micromarket.
    The field used, `Deals.Products` (the bid's own property, added to `warmDealsQ`/`wonDealsQ`/
    the event-referenced-deals fetch in `lib/buyer/aggregate.ts`), is documented in
    `docs/metric-skill/references/table-map.md` against the Postgres/Metabase mirror ("a Bid is on
    a Property"; `Products` holds the text id, `Products__name` the display name — only `Products`
    is fetched here) but **has never been selected in any COQL query in this codebase and was not
    verified live** (no Zoho credentials in the session that added it) — unlike `Lead_Source`,
    which CLAUDE.md documents as probed with a real `SELECT` against production. **Confirm
    `Deals.Products` returns real, populated property ids the first time this runs against
    production Zoho** (the same probe method: `SELECT Products FROM Deals LIMIT 1` and check for
    `INVALID_QUERY` naming the column, then spot-check that IDs look sane and aren't mostly
    blank) before trusting the "different flat" half of this metric — a field that's silently
    empty for most bids would make every visit fall into the `'Unknown'` bucket and this chart
    would read identically to the existing `Unique Visits` chart. See `lib/buyer/facts.ts`'s
    `VisitFact.propertyId` and `lib/buyer/derive.ts`'s comment above the extended dedup loop.
14. **New buyer-side chart, "WoW Bids Ever Warm" — deliberately does NOT reconcile against the
    existing "Ever Warm %" row in the Target vs Actuals table.** Added 2026-09-15. The existing
    row (`computeFunnelActuals`'s `everWarmLeads` ÷ `totalVisits`) divides two populations on
    different windows — its numerator is windowed on the **lead's created date**, its denominator
    on the **visit's own date** — an existing quirk of that computation, not something this chart
    introduces. The new chart instead buckets cleanly by **visit week**, reusing the exact same
    per-week/per-person dedup as `Unique Visits`, and splits each week's unique visitors into
    "Ever Warm" vs "Not Warm" by `lead.hasWarmBid`. **Do not treat a mismatch between this chart's
    weekly numbers and the Ever Warm % row's quarter figure as a bug** — they're answering related
    but different questions. Also: `hasWarmBid` is a live snapshot with no record of *when* a lead
    went warm (same as `HouseWarmBar`/the Overall Funnel elsewhere on this tab), so a past week's
    bar can still shift on a later rebuild if that lead places a bid afterward. See
    `lib/buyer/derive.ts`'s comment above the visits loop where `everWarmByWeek` is built.
15. **New Overall Funnel tile, "Total Conversions" — the one place on this entire dashboard where
    a Channel-Partner-sourced conversion is counted at all.** Added 2026-09-16, per an explicit
    growth-team request: "Channel + Direct, all conversion — if one person buys two properties
    then it is count 2. Basically how many properties we sold altogether." Every other conversion
    figure on this dashboard — this same funnel's `Unique Conversions` box (see below), and the
    Target vs Actuals table's `Total Conversions`/`New Conversions`/`Old Conversions` rows — is
    **Direct-only**, per the bid-level Channel Partner exclusion rule above ("the bid drops — its
    visit, its warm flag, its conversion"), **and** deduped to one count per buyer
    (`lib/buyer/derive.ts`'s `conversionFirstCreated`, keyed on phone). This new tile lifts both
    restrictions on purpose: every Closed-Won deal in the quarter counts, Channel Partner and
    Direct alike, one count per deal — a buyer closing two properties counts as 2. No new Zoho
    query was needed: `wonDealsQ` already fetches every Closed-Won deal in the window
    unfiltered by source. It is built as its own fact array (`ClosedWonBidFact` /
    `BuyerFacts.closedWonBids`) and counted in `lib/buyer/derive.ts`'s `computeFunnelActuals`
    as `totalConversionsRaw`; every existing conversions figure is untouched. No target exists
    for it (nobody's set one — there's no established "expected CP share" of conversions to
    pace against), same "—" no-target treatment as the funnel's own `Total Leads` tile.

    **Why it needs its own fact array — the trap that made the first attempt undercount.**
    "Excluding Channel Partner" happens in *two independent places*, and lifting only the
    obvious one is not enough. (a) Bid level: `isChannelPartnerDeal(d)` drops the bid when
    `Deals.Lead_Source = 'Channel Partner'`. (b) Lead level: `channel partner` is also in
    `EXCLUDED_SOURCES` (`lib/buyer/shared.ts`), so a LEAD whose own `Leads.Lead_Source` is
    Channel Partner never becomes a `LeadFact` at all — and since `ConversionFact` is only
    emitted when the deal's lead resolves in `leadFactById`, such a sale has no
    `ConversionFact` in the first place. A CP-sourced bid usually belongs to a CP-sourced
    lead, so the first implementation of this tile — which only stopped applying (a) —
    still lost almost all of them and read barely above the Direct-only figure. Counting off
    `allDeals` directly, with no `LeadFact` join, is the only way to see them. The same trap
    applies to `Builder` / `Seller Referral` / `NoBroker` / `Society Partners` leads.

    **The one exclusion kept: the VCV test cluster.** Test data is not a real sale, so a bid
    whose lead sits in `Truva_Cluster = 'VCV'` is still dropped — checked against
    `rawLeadById` (the pre-eligibility raw leads, which `aggregate.ts` patches with every
    Closed-Won deal's lead regardless of source), and null-safe: a lead with no cluster, or
    one that could not be resolved at all, still counts. Nothing else is applied — no
    dashboard filter (Time aside, which windows it), no per-buyer dedupe, no micromarket or
    virtual-micromarket rule.

    **A blocking counts as a sale, not just a signed MoU** (added 2026-09-16, same request).
    A *blocking amount* (token) is paid to reserve a unit and comes BEFORE the MoU in Truva's
    buyer journey, so blockings are not a subset of Closed-Won — a bid can block in one
    quarter and sign in the next, or never. The tile counts a bid when EITHER
    `Stage = 'Closed - Won'` with `Buyer_MoU_Signing_Date` in window, OR
    `Blocking_received_date` in window; deal ids are deduped across the two, and a bid that
    did both in the same window is counted once, on its MoU date. **Lapsed blockings are
    excluded** — per the growth team, a blocking taken and then refunded is not a property
    sold, so a bid whose Stage has since reached `Closed - Rejected` or `Cancelled` drops out
    (`BLOCKING_COLLAPSED_STAGES` in `lib/buyer/aggregate.ts`). New fetch: `blockingDealsQ`;
    the resulting facts are `SoldBidFact` / `BuyerFacts.soldBids`, each flagged `viaBlocking`.

    **Verified live 2026-09-16 via the Zoho CRM connector** (JAS 2026, 1 Jul – 30 Sep, raw
    Zoho with none of the dashboard's own exclusions applied):

    | Measure | Total | Direct | Channel Partner |
    |---|---|---|---|
    | `Closed - Won` with MoU in window | 23 | 11 | 12 |
    | `Blocking_received_date` in window | 32 | 13 | 19 |
    | Blocking in window, not already Closed-Won | 16 | 6 | 10 |
    | Union of both | 39 | 17 | 22 |

    Of those 16 additions, 10 sit at Stage `Blocking Received`, 5 at `Closed - Rejected` (the
    ones this metric now drops) and 1 at `Active - Cold`. The dashboard's own figure will run
    slightly below the raw union because of the VCV exclusion above.

    **Field notes from that same live check — worth keeping.**
    - `Blocking_received_date` (datetime, IST offset) is the field to use.
      **`Blocking_Ever_Received` (boolean) is unreliable and must not be used: 58 deals carry
      a real blocking date while the flag reads `false`.** `Blocking_Amount` (currency) holds
      the token value; `Token_to_Seller` is a seller-side payout, not buyer blocking; and
      `Deal_Blocker` is a false friend — it holds objection reasons ("Vastu", "Price"). No
      EoI/Booking/Reservation fields exist on Deals.
    - **Live `Deals.Stage` values** (observed in real records, since the field metadata omits
      populated values in this org): `Unassigned`, `NA`, `Pre-Visit`, `Visit`, `Active - Cold`,
      `Active - Warm`, `Active - Hot`, `Offer Negotiation`, `Blocking Received`, `Closed - Won`,
      `Closed - Rejected`, `Closed - Sold`, `Cancelled`. **Trap:** the metadata's
      `actual_value` disagrees with what the API returns (`Closed - Won` is stored as
      `Closed Won`, `Pre-Visit` as `Qualification`, `Active - Warm` as `Closed`) — query and
      compare using the display spellings above, which are what records actually carry.
    - **121 `Closed - Won` deals have no MoU date at all** (all pre-~June 2026). Harmless for
      JAS 2026, but any historical comparison built on `Buyer_MoU_Signing_Date` silently
      drops them.

    **Why this counts BIDS and not property statuses.** The growth team asked on 2026-09-16
    for "Transaction Complete, Buyer Found, Blocking Received" to be included. Those are three
    values of **`Products.Status`** — the PROPERTY's own status, a different module from the
    Deals this tile counts (full live list: Prospect, To Be Verified, Qualified, Staging, Live,
    Blocking Received, Buyer Found, Transaction Complete, Acquired, NPA, De-listed
    Temporarily). Checked live the same day, and the conclusion was to keep counting bids,
    because:
    - **Two of the three are already what this tile counts.** A property reaches `Buyer Found`
      when the MoU is signed and `Blocking Received` when the blocking lands — the same two
      events the bid-level rule above already unions.
    - **`Transaction Complete` cannot be windowed.** Its date is `Registration_Date`, which is
      effectively dead in 2026: 4 rows all year, latest real value 2026-03-07, and the only
      one falling in JAS 2026 is a VCV test record. Registration also lags the sale by months,
      so such a property was already counted in an earlier quarter when its MoU was signed —
      adding it would double-count, not add.
    - **The property's own date is less trustworthy than the bid's.** `Products.
      Buyer_MoU_Signing_Date` clusters hard on month-ends (30 Jun, 31 Mar, 31 May) and four
      properties carry 2026-06-30 while their winning Deal records early July — the property
      field reads target-driven, the Deal field actual. (`Products.Blocking_Amount_Date`, Zoho
      label "Blocking Received Date", is sound — but only exists from ~Oct 2025.)
    - **It changes almost nothing anyway.** In-window, the 32 blocking Deals map to 29 distinct
      properties (31 by property date) and the 23 Closed-Won Deals to 23 (21 by property date)
      — differences of 1-3 records, not structural.
    - **Property-status counting also undercounts structurally**: one property can back several
      sales over time, but carries only one current status, so a re-sold unit is counted once.

    Two more live traps recorded the same day, both in this area:
    **`Products.Registered_Sale_Date` is a forecast, not a fact** — 47 rows fall in JAS 2026 but
    24 of those properties sit at Status `Qualified` and 3 at `NPA`, i.e. never sold; never
    report off it. And **statuses revert**: two K L Astoria properties carry in-window blocking
    dates yet are back at Status `Live`, matching the five in-window blocking Deals now at
    `Closed - Rejected` that this metric excludes. Of the properties sitting at these three
    statuses, 29 are VCV test records (Ocean Drive Township, Bunch of Tools Township, Prawn
    Island), all with every date field null — one of them carries a Closed-Won Deal literally
    named "sachin test garg".

    **Naming note — same words, two different numbers, on purpose.** The funnel's bottom spine
    box was renamed **`Conversions` → `Unique Conversions`** as part of this change (a display
    label only, not a lookup key read anywhere else) so the funnel reads `Total Conversions` →
    `Unique Conversions`, exactly matching the funnel's existing `Total Leads` → `Unique Leads`
    and `Total Visits` → `Unique Visits` pairs. The Target vs Actuals table's own `Total
    Conversions` row is untouched — it is still the Direct-only, per-buyer-deduped figure, and
    equals what the funnel now calls `Unique Conversions`, **not** the new funnel tile of the
    same name. If a session sees the funnel's `Total Conversions` tile disagree with the Target
    table's `Total Conversions` row, that is these two intentionally different definitions, not
    a bug — see `lib/buyer/derive.ts`'s comment above `totalConversionsRaw`.
16. **Open — does `Closed - Sold` mean a LOST bid, and should it be excluded from "Total
    Conversions"?** Raised 2026-09-16 while adding blockings to that tile. `Closed - Sold` is a
    distinct live Stage from `Closed - Won`, and reading the records it appears to mean *the
    unit sold to someone else* — i.e. a bid we lost, not a sale. It is **not** currently
    excluded, because nobody has confirmed that reading and this file's rule is that a metric
    definition is not a session's to invent. **Impact today is zero** — no in-window bid has
    both a blocking and this stage — so nothing is being misreported right now, but that could
    change in any quarter. Someone who knows the CRM convention (growth team / Raj) should
    settle it, after which either exclude it alongside `Closed - Rejected` / `Cancelled` in
    `BLOCKING_COLLAPSED_STAGES` or record here that it legitimately counts.
17. **Open — should a sale be dated by its blocking or its MoU?** Raised 2026-09-16 with the
    same change. A bid that blocks in one quarter and signs its MoU in the next currently lands
    in the **blocking** quarter (the tile takes whichever of the two dates falls in the window,
    preferring the MoU when both do). That is a defensible reading of "when did we sell it",
    but it is a choice, and it means a quarter's Total Conversions can include a sale whose MoU
    is never signed. The alternative — always date by MoU, and count blockings only as a
    separate pipeline figure — would report later and lower. Nobody has ruled on this; the
    current behaviour was implemented to satisfy "include blocking received as well" and should
    be confirmed before this number is used for anything with a target attached to it.

18. **New buyer-side chart, "WoW Visits: Direct vs Channel Partner" — the second place on this
    dashboard that counts Channel Partner activity at all.** Added 2026-09-16, per an explicit
    growth-team request. Every other visit figure on this tab (`Unique Visits`, `Unique Gross
    Visits`, `Total Visits`, `Bids Ever Warm`, the funnel's visit boxes) is Direct-only **twice
    over**, and this is the trap to understand before touching it: `lib/buyer/aggregate.ts`
    drops a CP-sourced bid's events when building `completedEvents`
    (`if (!deal || isChannelPartnerDeal(deal)) return false`), **and** the `visits` loop then
    requires the bid's lead to resolve in `leadFactById`, which a CP bid's lead usually cannot
    because `Leads.Lead_Source = 'Channel Partner'` is in `EXCLUDED_SOURCES`. Either exclusion
    alone is enough to erase the CP series, so lifting one is not enough — the same
    double-exclusion that made the first build of item 15's tile undercount.

    Rather than loosen `facts.visits` (which every Metabase-reconciled visit number depends on
    staying exactly as it is), the chart reads its own array, `VisitSplitFact` /
    `BuyerFacts.visitSplit`: one row per completed visit EVENT in the window, tagged
    `isChannelPartner` off the **bid's** own `Deals.Lead_Source`. No new Zoho query — the events
    and the CP bids were already being fetched and then discarded. Kept from the normal rules:
    the completed-visit definition (bid `Stage` past `Unassigned`/`Pre-Visit`/`Cancelled`), the
    `(Virtual)` micromarket exclusion (a place rule, not a source rule) and the VCV test cluster
    (null-safe, off the pre-eligibility raw leads).

    **Three things it deliberately does NOT do, all consequences of CP leads being outside the
    population rather than choices:**
    - **It does not reconcile with any other visit chart.** Different population (CP included)
      *and* different grain (one count per visit event, not per person). Do not try to make them
      agree.
    - **It ignores the Cluster/Micromarket and Source filters**, always showing the company-wide
      split — same deliberate exception as `Direct % of Bids` (item 12). Those are lead-level
      dimensions and a CP visit has no eligible lead, so applying them would silently erase the
      entire CP series the moment anyone touched a filter. The time filter still applies.
    - **It has no drill-down.** Every other WoW chart opens a lead list on click; this one
      records no `leadIds` at all, because a click could only ever show the Direct half of a bar
      — worse than showing nothing. A test asserts `leadIds` stays empty so this cannot regress
      into a half-truthful drill-down.

    If the growth team ever wants this chart filterable or clickable, that means bringing CP
    leads into the population, which is a far larger decision than this chart and belongs here
    as its own question first.

    **Verified live 2026-09-16 via the Zoho CRM connector** (Events `Module = 'Bid'`,
    `Start_DateTime` 1 Jul – 30 Sep 2026 IST, joined to the linked Deal; exact, month-sliced
    pagination — note a quarter-wide query silently caps at 2,000 rows):

    | | Events | Channel Partner | Direct |
    |---|---|---|---|
    | Raw visit events | 2,755 | 1,448 (52.6%) | 1,307 (47.4%) |
    | After the completed-stage rule | **1,663** | **910 (54.7%)** | **753 (45.3%)** |

    **Channel Partner is the MAJORITY of visits, and always has been** — the dashboard's other
    visit charts have therefore been showing under half the real activity. The share is steady
    across the quarter (52-62%, no drift): Jul 551 events at 54.6% CP, Aug 732 at 55.6%,
    Sep-to-date 380 at 53.2%. **If this chart ever shows Direct ahead, it is undercounting** —
    that is the cheapest possible regression check on it.

    The completed-stage rule removes 1,092 events (39.6%): `Cancelled` 967, `Pre-Visit` 125,
    `Unassigned` 0. **Null-source is a non-issue here** — 0 of 2,420 linked deals, so unlike
    `Direct % of Bids` (item 12) this really is a clean two-way split with nothing dropped in
    the middle. No orphan `What_Id`s either: all 2,755 events resolved to a Deal.

    Three more things that check out or bite:
    - **Right-censoring dominates the current week**, harder than elsewhere on this tab: the week
      of 14 Sep had 86 raw events but only 13 completed, with 60 still at `Pre-Visit`, making its
      15.4% CP share pure artifact. The chart already hatches and labels the running week
      "(partial)", which is what keeps this honest — do not remove that. Through 13 Sep the
      quarter reads 1,649 completed, 908 CP / 741 Direct (55.1%).
    - **Test bids leak in and skew Direct.** 58 in-window events sit on obvious test deals
      ("Bruce N", "sachin test garg", "Arjun (iGNORE) TESTER"); 24 survive the stage filter, 20
      of them Direct. Only ~1.4% of the total, but it is a systematic tilt and the VCV cluster
      rule does not catch them — there is no naming convention to filter on safely, so this is
      recorded rather than coded around.
    - **1,663 events sit on only 1,427 distinct bids** (207 bids carry more than one). Correct
      for an event-count chart; the reason this must never be relabelled "unique visits".
    - `Events.Visit_Source` exists but holds TruAssistant / Walk-in and similar — it is **not** a
      shortcut to the CP/Direct split. Use the linked Deal's `Lead_Source`, as this chart does.
    - 539 `Module = 'Property'` events fall in the window; those are seller-side and correctly
      never enter this count.

19. **Verified 2026-09-16: `Lead_Source_History`'s micromarket field is API name `Micromarket`,
    but its Zoho UI LABEL is "Truva Micromarket".** There is exactly one micromarket field on
    that module — `getFields` on `Lead_Source_History` returns a single match, `Micromarket`
    (picklist), whose `field_label` is "Truva Micromarket". There is **no**
    `LSH.Truva_Micromarket` API field; selecting that name returns nothing rather than erroring,
    so a query written from the UI label silently comes back empty and would blank out every 3P
    lead's micromarket.

    This came up because the growth team asked for 3P to "take the micromarket from Truva
    Micromarket in Lead Source History" — which `lib/buyer/lsh.ts` already does, via
    `SELECT ... Micromarket ... FROM Lead_Source_History`. No change was needed. Note this is a
    different field from `Leads.Truva_Micromarket`, which CLAUDE.md documents as unreliable and
    which this dashboard deliberately never reads: the LSH one is sound and is the 3P source of
    truth, with `Leads.UTM_Micromarket` filling in only when the LSH first touch is blank (see
    the 3P fallback note in CLAUDE.md).

    Live sample the same day also confirms **`Ibiza` is a real, populated LSH micromarket value**
    with exactly that spelling — 3 of 12 most-recently-modified serial-1 rows carried it —
    which is the string now added to `VALID_MICROMARKETS` and to `CLUSTER_TREE.HABIBI`.

20. **Visit-by-micromarket audit, run live 2026-09-16 — the counting logic is sound, and the
    allow-list drops nothing this quarter.** The growth team asked for a check on Powai,
    Singapore and the other micromarkets. Exact counts (not sampled) for `Module='Bid'` Events
    with `Start_DateTime` in 1 Jul - 30 Sep 2026 IST, split by the event's own
    `Truva_Micromarket` and by whether the linked bid's Stage clears
    `Unassigned`/`Pre-Visit`/`Cancelled`:

    | Micromarket | Events | Completed |
    |---|---|---|
    | Powai | 1,002 | 603 |
    | Glasgow | 786 | 431 |
    | Vegas | 371 | 209 |
    | Barcelona | 182 | 138 |
    | Amsterdam | 145 | 106 |
    | Boston | 126 | 96 |
    | Athens | 43 | 20 |
    | Hong Kong | 36 | 20 |
    | Singapore | 21 | 16 |
    | Viceport / Leaf Links / Mainland / Airport **(Virtual)** | 54 | 24 |
    | **Total** | **2,766** | **1,663** |

    **`Events.Truva_Micromarket` is a strict picklist with no free text**, and the 13 values
    present sum to exactly the grand total — so there is **no stray casing, no typo variant, no
    semicolon-joined multi-value and no blank** hiding anywhere, and nothing is silently lost
    between the raw data and the charts. Charted completed visits come to **1,639**; the 24
    missing are exactly the `(Virtual)` ones this dashboard excludes on purpose. Blank/null
    micromarket: **zero events**. The completed-stage rule removes 1,103 of 2,766 (~40%),
    consistent with item 18's quarter-wide figure.

    Two dead entries surfaced, both harmless but worth knowing before anyone trusts them:
    **`Bangalore` is not a valid `Events.Truva_Micromarket` picklist value at all** (it is still
    meaningful as the lumped HABIBI row in the target grid via `CLUSTER_TARGET_ALIAS` — do not
    remove it on the strength of this), and the three `MICROMARKET_FIX` corrections
    (`VEGAS`, `Glassgow`, `Andheri (E)`) match nothing on Events. Neither was checked against
    `Leads.UTM_Micromarket`, where they may still apply, so treat both as "unused on Events"
    rather than dead outright.

    Also worth recording: **`Hong Kong` and `Singapore` are codenames for real stock**, not junk
    — Hong Kong covers F1 Versova Sky (560093) and Purva Westend (560048), Singapore covers
    Fairfield by S Raheja. Their small numbers are genuine.

    **On Ibiza specifically** (added to `VALID_MICROMARKETS` / `CLUSTER_TREE.HABIBI` the same
    day): the value exists on the Events picklist spelled exactly `Ibiza`, but has **0 Events
    ever** and 0 Products. It does have **214 Leads** carrying `UTM_Micromarket = 'Ibiza'`, all
    created 11-16 Sep 2026 — a micromarket that has just launched. Expect Ibiza to appear in
    lead charts immediately and to show an **empty visit bar** until its first visits land;
    that emptiness is real, not a mapping failure.

    *Caveat on the method:* bid stages came from a snapshot taken at 05:45 IST that day plus
    live spot-checks (all of which matched), so a stage that moved later that day would not be
    reflected.

21. **Open — nothing defines what counts as "procured" for the procurement dashboard, and the
    candidates disagree.** Raised 2026-09-22 while establishing that the data is reachable at
    all (see `pre_qualified_data` in `table-map.md`). The numerator is that table, but it is not
    obvious which of its 57,759 rows should count, and each of these choices moves the headline
    percentage:
    - **Does a row count once it exists, or only at some `Status`?** The module carries a
      `Status` picklist plus an `EE_Agent` / `No_of_attempts` calling history, so "we hold the
      number" and "we reached them" are different populations.
    - **`Type_of_Data` exists on the module** and nothing here reads it yet.
    - **Is the unit of the numerator the record or the property?** One record can carry several
      properties in its `Property_details` subform, and the top-level `Society_Name` is only the
      first of them (trap 41). Counting records under-counts a seller who owns two units in one
      society, and mis-attributes one who owns units in two.
    - **Is a co-owner a second procured unit or the same one?** §2.3 of the requirements doc
      says procured count may legitimately exceed total units, which implies the former, while
      the dedup rule it states in the same breath ("distinct mobile numbers") implies the
      latter.

    **Do not let this get settled by whichever session builds the first chart** — that is
    exactly the failure this list exists to prevent. The growth team and whoever owns the
    acquisitions funnel have to rule on it, and the ruling belongs in this file.
