---
name: truva-growth-reporting
description: Build charts, reports and numbers from Truva's Zoho CRM data in Metabase. Use whenever someone asks for a metric, chart, dashboard or report about leads, bids, visits, calls, sources, channels, campaigns, properties or sellers, or when a number in Metabase looks wrong. Claude clarifies what should be measured, agrees the definition in plain English, then produces SQL for the person to paste into Metabase and chart there.
---

# Truva growth reporting on Metabase

> **This folder is the single home for these definitions.** It lives in the dashboard repo on
> purpose: the buyer metrics here are the ones `lib/buyer/` implements, so a PR that changes a
> metric must change the doc in the same diff. `product-os/Skills/truva-growth-reporting/` is a
> pointer to here, not a copy. The zip published to the growth team's Claude account is built
> from this folder — never edit the zip or a downloaded copy and expect it to survive.
>
> **Updating it after a session:** see Step 9. Verified facts and traps can be appended.
> Metric definitions cannot — those get raised as open questions instead.

## How this works

You write the query. The person makes the chart.

Truva's Zoho CRM data is copied into a Postgres database on Metabase called **Zoho DB Sync**. The person you are helping does not read SQL. They will paste what you give them into Metabase's SQL editor, run it, and build a chart from the result. If it breaks, they come back to you.

That splits the work cleanly. Metabase is where charts and data live. You are where the decision about *what to measure* gets made. Your real job is not writing SQL, it is making sure the number means what the person thinks it means before they put it on a slide.

Because they cannot read the SQL, they cannot catch your mistakes. Everything below exists to handle that.

## Read this first, every time

**Read `references/metric-definitions.md` first if the request is for a DRR metric** — leads, qualified leads, visits, conversions, CPL, CPQL, cost per visit, target achievement, anything cut by quarter, micromarket or channel. It holds the growth team's agreed definitions, the channel mappings, and the exact live status strings. Do not agree a fresh definition for a metric that already has one.

Read `references/table-map.md` before answering anything. It has the nine tables that matter, their exact column names, and the Zoho labels the growth team actually sees in the CRM. Use it as the source of truth for column names.

Read `references/known-traps.md` before writing any SQL. Several fields in this database look correct and are not. Skipping this file produces confident, wrong answers.

Check `references/query-library.md` before building anything new. If someone has already defined and verified this metric, reuse that query. Do not rebuild a metric that already exists, because two versions of "leads per week" means the team stops trusting both.

**Then check Slack.** If you have the Slack connector, search **#growth-reporting-feedback** for the metric, table or field this request touches. Every past session on this account gets logged there by step 8, so it holds things the library has not caught up on yet: metrics someone built last week, errors already solved, fields that turned out to be wrong.

Treat the two sources differently. The library is authoritative and verified. The Slack log is recent working memory, written by Claude in an earlier conversation and not reviewed by anyone. So reuse a library query directly, but treat a Slack log entry as a strong lead to verify rather than a fact. If a log entry and the reference files disagree, the reference files win, and say out loud that you found a conflict so it gets fixed.

If you find that someone already built this exact chart, say so and point at it rather than building a second version.

## Always-on defaults: apply these, never ask about them

These are settled. Apply them silently to every query, state them on the definition card so the person can see what you did, and do not turn them into clarifying questions. Asking a question whose answer is always the same is friction, not rigour.

**Exclude the test cluster, always.** `Truva_Cluster = 'VCV'` is a test environment, on every table that carries the column. It is never wanted in any report.

Write it null-safe. A plain `!=` drops rows where the cluster is null, which silently shrinks every number:

```sql
AND "Truva_Cluster" IS DISTINCT FROM 'VCV'
```

`IS DISTINCT FROM` is the idiom to use. It excludes VCV and keeps nulls, which is what you want.

Verified VCV row counts on 2026-08-10: `products` 110, `events` 18, `sellers` 11. All three tables also hold nulls and empty strings, which is why the null-safe form matters.

**Weeks run Monday to Sunday, in IST.** Every time. `date_trunc('week', "<date_column>" AT TIME ZONE 'Asia/Kolkata')` gives exactly this. Metabase's own query builder defaults to Sunday-start weeks in UTC, so a card built by clicking will disagree with a card built from SQL. Always SQL, so the dashboard agrees with itself.

**Growth reporting means direct growth right now.** Channel-partner and society-partner sourced records are out of scope by default.

On **sellers**, exclude `Seller_Source` of `Channel Partner` and the society-partner sources.

On **buyers**, the excluded `Lead_Source` list is longer than the doc's, and settled by the dashboard: `Channel Partner`, `Builder`, `Seller Referral`, `NoBroker`, `Society Partners` (plural). `Seller Referral` is therefore not a buyer channel, even though the doc lists it as one. Buyer visits and conversions additionally drop any bid whose **own** `Lead_Source` is `Channel Partner`, and the whole buyer population drops micromarkets containing `(virtual)`. See `metric-definitions.md`.

Say so on the definition card, and if someone actually wants CP included they will tell you.

**Never drop leads because their status is telephony junk.** Values like `Network Issue`, `Call Rejected` and `Open - Disconnected` are real leads that someone tried to reach and failed. Map them into the **Attempted to Contact** bucket. Deleting them understates the top of the funnel. See `known-traps.md` for the full mapping.

## Chart conventions: apply these to every chart, never ask about them

Same standing as the query defaults above. These are all fixes that were made once, on one
chart, and then had to be made again on the next one because nobody wrote them down.

**Legend labels render in dark ink, never in the series colour.** Recharts colours a legend
label to match its series by default, and half this palette is pale by design, so those labels
come out barely legible on the cream card. The swatch already carries the colour. In the
dashboard repo, pass both exports from `components/shared/chartLegend.tsx` to every `<Legend>`:

```tsx
<Legend wrapperStyle={LEGEND_STYLE} formatter={legendFormatter} />
```

**A bucket that is still in progress gets hatched and labelled `(partial)`.** Week and month
buckets are admitted as soon as their start is in the past, so the current one always holds
only the days elapsed — 2 of 7 on a Tuesday. Rendered at full weight it reads as a collapse,
and a page with six WoW charts reads as six collapses. Do not hide it: the current week is the
one people most want to see. Keep the bar, lay a diagonal-stripe pattern over the fill, and put
`(partial)` in the axis label so it survives a small bar and a printout.

**A cost-per, rate or ratio with a zero numerator or denominator shows a dash, never a zero.**
`₹0` for a cost-per reads as free, and free is the one wrong answer nobody double-checks. A
volume metric is different: `₹0` spend is a true statement and should render as `₹0`.

**Nothing-versus-nothing is neutral, not green.** Zero achieved against a zero target is not
ahead of pace. Colour it muted and drop the ▲/▼, the same as an absent target.

**A number that ignores the filters says so, in its own sub-label.** Any tile, box or card that
deliberately does not respond to the filter bar must carry the reason where the number is — the
way "a live snapshot, the time filter does not apply here" sits under the pipeline card. A
figure that stays at 20 while everything around it goes to 0 is read as a bug otherwise.

**A badge on a connector must be derivable from the two numbers it connects.** If a ratio's
numerator is not one of the values on screen, either show that value or drop the badge. And do
not mix `×` and `%` across badges that sit in the same row.

**Wide tables scroll inside their own container.** Give any table with more than about four
columns an `overflow-x: auto` wrapper, or its right-hand columns become unreachable on a narrow
window instead of merely cramped.

## Definitions you do not get to settle in the conversation

Some words mean different things to different teams at Truva, and the person asking you for a chart is not the person who owns the definition. If you let each requester define these in the moment, the team ends up with five incompatible numbers, which is the exact failure this skill exists to prevent.

**Most of these are now settled, but by two different authorities.** `references/metric-definitions.md` holds the definitions and wins over anything agreed in the conversation. What it draws on differs by side:

- **Seller** definitions come from the growth team's DRR standardisation doc in Notion, last changed 2026-09-01, which rewrote the seller-visit rule into three cases.
- **Buyer** definitions come from the live buyer dashboard, which has deliberately diverged from that doc — different qualified statuses, a different visit definition, and four extra population rules.

So "what does the DRR doc say" is no longer the same question as "what does the dashboard show" on the buyer side. If someone asks for "qualified leads" and means something different from what is written there, stop and say so rather than building both.

Two things the standardisation does **not** settle, so keep flagging them:

- **Conversion %** has an agreed formula (conversions ÷ total visits) but the denominator is visits, not leads. People often mean leads. Confirm which they want and put it on the card.
- **"Visit"** means an `events` row on the buyer side and a property acquisition status on the seller side. These are not comparable. Never put them on the same chart without labelling which is which.

The open items listed at the end of `references/metric-definitions.md` are genuine gaps in the standardisation, not things for you to resolve. Surface them, name them as open, and carry on with the rest.

## Step 1: Find out what they actually want

Do not write SQL yet. Do not write SQL in your first reply. Almost every wrong report starts here, with a reasonable-sounding request that meant something different to the person asking.

Ask about the things that change the answer:

- What decision or conversation is this for? A number for a weekly review needs different framing than one for diagnosing a drop.
- What counts as one row? One lead, one bid, one visit, one call?
- Which date decides the bucket? The date the lead came in, or the date the thing you're measuring happened? These give genuinely different charts and people rarely realise they've picked one.
- What time range, and weekly or monthly?
- Split by what? Source, channel, campaign, micromarket, owner?
- Anything unusual to leave out? Do **not** ask about test data or the test cluster — those are always-on defaults, already handled. Ask only about exclusions specific to this request, like a particular source or a known bad period.

Ask in plain English. Say "the date the lead first came in" not "cohort date on `Created_Time`". Never show a column name in this step.

Ask three or four questions at a time, not twelve. If they have already answered something, don't ask again.

## Step 2: Write the definition card and get it approved

This is the gate. Write back what you are about to measure, in plain English, and wait for a yes.

The card looks like this:

> **What we're counting:** one row per buyer lead.
> **Population:** leads created between 1 April and 31 July 2026.
> **Bucketed by:** the week the lead was created (weeks start Monday, IST).
> **The measure:** of those leads, how many have at least one visit booked, and how many have at least one completed visit.
> **Split by:** first channel the lead came through.
> **Excluded:** nothing.
> **You'll get columns:** week, channel, leads, visits booked, visits completed, booked %, completed %.
> **Chart:** line chart, one line per channel, using the % columns.
>
> Does that match what you wanted?

Do not skip this because the request seemed obvious. Do not merge it into the same message as the SQL, because then nobody reads it and the gate does nothing.

If they correct something, update the card and confirm again. Only move on after an explicit yes.

## Step 3: Write the SQL

Now write it, following the rules in `references/known-traps.md`. The ones that matter most:

- Join and filter on the text ID columns only. Never the bigint `id` column, on any table. It holds silently wrong values.
- Every date boundary carries an explicit IST offset: `'2026-04-01T00:00:00+05:30'`.
- Build visit metrics on the `events` table, never on the rollup fields on leads or bids.
- Handle the messy real values: mixed-case sources, both visit-status spellings, stage-name variants.

Write it as one query that returns a table ready to chart. Do not hand over something that needs further work in Metabase.

Keep it readable. Use CTEs with clear names. The person cannot read it, but you will be debugging it with them later, and so will whoever inherits this.

## Step 4: Verify before you hand it over

Never hand over an unverified query with no way for them to tell it's wrong.

**With the Metabase connector:** check the pieces you can. Confirm the columns exist. Confirm a filter value actually appears in the data, because filtering on a status that is spelled differently returns a clean, believable zero. Get the population count on its own. Then tell them the number you expect, so they have something to compare against:

> "This should return about 12 rows, and the total leads across all weeks should come to roughly 3,400. If your total is wildly different, something's off. Tell me what you get."

**Without the connector:** you cannot test it, so give them a self-check instead. Ask them to run the query and report back the row count and one total before they build the chart. Give them a rough figure you'd expect and why. If your expectation and their result disagree, work out which is wrong before anyone charts anything.

Either way, apply one sanity test yourself: does this number look plausible for a Mumbai resale business doing the volumes in the table map? A visit-completion rate of 4% or 96% is a bug, not an insight.

## Step 5: Hand it over

Give them one block with everything, and nothing to figure out:

> **1. Open Metabase → New → SQL query, and pick "Zoho DB Sync" from the database dropdown.** This matters. Other databases exist and picking the wrong one gives an error that looks like the query is broken.
>
> **2. Paste this and hit run:**
> ```sql
> ...
> ```
>
> **3. What you're looking at:** `cohort_week` is the week the lead came in. `new_leads` is how many leads that week. `booked_rate_pct` is the share of them that got a visit booked.
>
> **4. To chart it:** click Visualization, pick Line, set X to `cohort_week`, Y to `booked_rate_pct`, and series to `channel_group`.
>
> **5. Sanity check:** you should get about 12 rows and around 3,400 total leads. If not, come back to me.

Explain what the columns mean in their language. `booked_rate_pct` means nothing on its own to someone who did not write it.

## Step 6: When it breaks

They will come back with errors. Ask for the full error message, exactly as Metabase showed it, and which database they had selected. Do not guess from a paraphrase.

Common ones:

| What they see | What it means |
|---|---|
| `relation "leads" does not exist` | Wrong database selected. Switch to Zoho DB Sync. |
| `column "X" does not exist` | Column name is wrong. Check the table map, or look it up live if you have the connector. |
| Runs fine, returns zero rows | Usually a filter value that doesn't match the real data, often a spelling or casing difference. Check what values actually exist before changing anything else. |
| Runs fine, numbers look too small | Often a join on the wrong column, or a date filter without the IST offset. |
| `operator does not exist: text = bigint` | Something is comparing a text ID to a bigint `id`. Fix the join to be text-to-text. |

When you fix it, say what was wrong in one sentence. They are learning what this data is like, and "fixed it" teaches them nothing.

## Step 7: If it's worth keeping

If the query is one the team will run again, write it up as a library entry in `references/query-library.md`: the plain-English definition, the SQL, the verified number, and the date.

This skill now lives in the dashboard repo, so you can open a PR against it directly — you no longer have to route it through Raj. Use the same branch-and-PR flow as any dashboard change (see the repo's `CLAUDE.md`).

That is how the team ends up with one definition of each metric instead of one per person.

## Step 8: Log the session to Slack

Once the person confirms the chart worked, write the log and post it to **#growth-reporting-feedback** using the Slack connector. Do not ask them to copy and paste it.

Show them the draft and ask once: "Shall I log this to #growth-reporting-feedback?" Then post it yourself. One confirmation, because it posts under their Slack identity, not yours. If they say no, drop it and move on.

```
**Asked for:** <their original request, in their words>
**Agreed definition:** <one line from the approved definition card>
**Tables used:** <tables and the key columns>
**Verified how:** <what you checked it against, or "not verified">
**Broke on:** <any Metabase error and what fixed it, or "nothing">
**I got wrong:** <any column, field or definition you were corrected on, or "nothing">
**Chart:** <chart type and what is on each axis>
**Still unresolved:** <any definition that needs an owner's decision, or "nothing">
```

Do not skip a line because it is unflattering, and do not soften it. **"I got wrong" is the most valuable line in the block** — it is the only record of where this skill is out of date, and nobody else is going to write it down.

If the Slack connector is unavailable or posting is blocked, fall back to showing the block and asking them to paste it. Say which one you are doing so they are not left wondering whether it got logged.

Keep it to the eight lines.

## Step 9: Fold what you learned back into the skill

Step 8 logs the session to Slack. This step is what stops that log dying in the channel.

The `I got wrong` and `Still unresolved` lines from Step 8 are the raw material: the first says where this skill is out of date, the second says where the definitions are. Turn the first into an edit here. Turn the second into an open question. Neither happens on its own, and until it does the skill goes stale while everyone assumes it is current — which is exactly how the buyer definitions drifted away from the dashboard for weeks.

The skill only stays useful if what each session learns lands in it. It only stays *trustworthy* if sessions can add facts without quietly rewriting definitions. Those are different things, and the line between them is the point of this step.

### What you may append

Verifiable observations, each with what you checked and the date:

- a field that turned out to be dead, empty, or lossy → `known-traps.md`
- a casing or spelling mismatch between a doc and the database → `known-traps.md` and the casing table in `metric-definitions.md`
- a live value list or row count you actually ran → `table-map.md`
- a query that returned the wrong number, and why → `known-traps.md`
- a reusable, verified query → `references/query-library.md`

Write these the way the rest of the file is written: what was checked, what the wrong result looked like, the date, and the cost of getting it wrong. A trap without a number attached gets ignored.

### What you may not append

**Metric definitions.** What counts as qualified. What a visit is. What is excluded from the population. How a target is paced. Which cohort a record belongs to.

These are agreements between people, not observations about data, and this skill exists precisely so they are not re-decided in a conversation. If a session concludes a definition is wrong, incomplete, or contradicts the dashboard, **add it to the Open Questions list at the end of `metric-definitions.md` and stop there.** Name the conflict, the evidence, and who needs to settle it.

Do not resolve it, do not implement both, and do not record your reading as the definition. A wrong number that matches the agreed definition is a known problem. A number built on a definition one session invented is an unknown one, and it will be presented to leadership as fact.

### How to propose the change

Show the person what you intend to edit before you edit it, in three lines:

> **Skill update**
> - **Verified:** `products."Acq_Status"` holds 22 values; `Deal Lost` is 1,686 of them. Ran on the mirror, 2026-09-07.
> - **Appending:** new trap in `known-traps.md` — `Acq_Status` is never NULL, it holds an empty string, so `IS NOT NULL` does not filter blanks.
> - **Raising, not answering:** is a seller visit counted per property or per seller? The DRR doc says both in the same section. Needs the growth team.

Then open a PR with it, same flow as any dashboard change. Small and frequent beats a quarterly rewrite — a one-line trap added the day it was found is worth more than a tidy document nobody trusts.

If nothing was learned, say so. An empty skill update is a fine outcome and better than padding it.

## Rules you do not break

1. **No SQL before an approved definition card.** Every time, however obvious the request looks.
2. **Never claim you verified something you couldn't run.** Say what you checked and what you didn't.
3. **Never use a bigint `id` column** for a join, a filter, or a link back to Zoho.
4. **Every date literal carries `+05:30`.**
5. **Never invent a column name.** If it isn't in the table map and you can't check it live, say you need to confirm it rather than guessing.
6. **Read `known-traps.md` before writing SQL.** Not after the number looks odd.
7. **Talk in Zoho labels, not API names.** Say Bids, Meetings, Properties, Channel Partners. See the table map for the full mapping.
8. **One query, ready to chart.** No manual steps left for them in Metabase.
9. **Apply the always-on defaults silently.** Test cluster excluded, Monday-to-Sunday IST weeks, direct-growth scope. State them on the card, never ask about them.
10. **Never invent a definition that `metric-definitions.md` already gives.** Restate it from there; flag a mismatch instead of building both.
11. **Always end with the session log block (Step 8), then fold it back in (Step 9).** Step 8 is the only feedback loop this skill has; Step 9 is what turns it into an actual change. Step 9 is also the gate that stops a session inventing a definition.
