# CLAUDE.md — growth-reporting

Guidance for Claude Code working in this repo. Written 2026-09-01 as a handoff.

## What this is

A standalone Next.js dashboard replicating Truva's **Metabase "Buyer Weekly Report"** against the
**Zoho CRM**, read from growth's copy of the Zoho sync mirror (`lib/crm.ts` → growth's
`POST /api/crm-mirror/records`; it called the live Zoho API directly until 2026-09-28). Two top-level tabs: **Buyer** (built) and **Seller** (placeholder).

Forked from `repos/monorepo/apps/wire` (a property-health dashboard) for its UI toolkit and Zoho
plumbing, then stripped of all wire-specific pages. It is **not** part of the monorepo pnpm
workspace — it's a separate repo with its own deps.

- GitHub: `truvahomes/growth-reporting` (private)
- Dev: `pnpm dev` → http://localhost:5002 (wire uses 5001, don't collide)
- Node >= 22.2.0, pnpm 10.9.0

## Working with the growth team — the change workflow (follow this for every dashboard change)

This dashboard is operated by the **growth team, who aren't engineers**. They'll ask for a change
in plain terms — "make the funnel bars blue", "the status chart is hard to read", "add a filter for
X". Your job is to take it from that plain description all the way to a reviewed PR, following these
five steps **in order**. Never skip one.

**1. Understand first, in plan mode.**
Talk plainly — never jargon. Pin down exactly what should change and where: which chart, which
number, which filter, and what it should look like. Ask clarifying questions when it's ambiguous.
Then **enter plan mode**, write a short plain-English plan of what you'll change, and get their
approval before writing any code. Do not touch code until they've said yes to the plan.

**2. Build on its own branch — never on `main`.**
Create a branch named `growth/<short-description>` (e.g. `growth/status-chart-colours`) and make the
change there. `main` is the live dashboard; you never edit it directly.

**3. Regression must pass before a PR — no exceptions.**
The dashboard has to keep working. Run all of these, and they must all pass:

```
npx tsc --noEmit
npx eslint lib components app
npx vitest run
npx next build
```

If the change is visible, also start the dev server (`pnpm dev`) and confirm it renders. If anything
fails, fix it and run again. **Do not raise a PR until every check is green.**

**4. Raise a PR and send it for approval — you never merge.**
- Push the branch. PRs are raised by the growth team's **shared account, not an individual's** — so
  Raj can be the approver (GitHub won't let someone review their own PR).
- Open the PR against `main`, requesting Raj as reviewer (his handle on this repo is `raj-truva` — **not** `raj-savla`,
  which is a real GitHub account but not a collaborator here, so `gh` accepts it and attaches
  nobody; verified 2026-09-22 after PR #10 came out with no reviewer):
  ```
  gh pr create --base main --reviewer raj-truva --title "<plain title>" \
    --body "<what changed, in plain language, and confirmation every regression check passed>"
  ```
- Post the PR link with a one-line friendly summary to Slack **#growth-reporting-feedback**
  (`C0BPBK02D1A`), tagging Raj to review and approve.
- **Stop there.** Raj reviews and approves; merging to `main` is what deploys to the live dashboard.
  You do not push to `main`, you do not merge, and you do not deploy.

**5. Fold what you learned back into the skill.**
A session that discovers something and doesn't write it down leaves the next person to rediscover it
at the same cost. At the end, do one pass over `docs/metric-skill/` and follow **Step 9** in its
`SKILL.md`. The line it draws is the important part:

- **Append verified facts** — a dead or empty field, a casing mismatch, a live value list you
  actually ran, a query that returned the wrong number and why. Date it and say what you checked.
- **Never append a metric definition.** What counts as qualified, what a visit is, what's excluded
  from the population, how a target is paced. If a session concludes one of those is wrong, add it
  to Open Questions in `metric-definitions.md` and stop. Name the conflict and who has to settle it.

That second rule is not bureaucracy. This whole file exists because metric definitions get decided
by whoever spoke last, and the growth team is the audience least placed to tell an assumption from a
verified fact. A number built on a definition one session invented gets presented to leadership as
fact, and nobody can tell afterwards where it came from.

Skill edits ride in the same PR as the change, or their own PR if the session changed no code.

**Always:**
- Never push to `main`, never merge a PR, never deploy — only Raj's approval + merge does that.
- Never skip or fake the regression checks.
- Keep every message to the growth team plain and friendly — they operate the dashboard, they don't
  read code.
- Everything else in this file still applies while you make the change — the metric definitions, the
  "never read `.env`" rule, and the eligibility rules below are not optional.

**One-time setup this depends on (flag it if it isn't in place, don't work around it):** the
environment must be signed in to GitHub as the **shared growth account** (not `raj-truva`) with push
access to `truvahomes/growth-reporting`, and able to post to `#growth-reporting-feedback`.

## Hard rules

1. **Never read `.env` or any gitignored file** — not with Read, not with `cat`/`grep`/`sed`, not
   even a "redacted" inspection command. Next.js loads env vars itself; you never need to open the
   file. This rule exists because a broken redaction one-liner previously dumped real Zoho, Auth0,
   Upstash and Google service-account secrets into a transcript.
2. **The metric definitions are not yours to invent.** See below.

## The source of truth for every metric

**`docs/metric-skill/`, in this repo** — read before touching any metric:

| File | What it holds |
|---|---|
| `docs/metric-skill/SKILL.md` | Method, always-on defaults (VCV exclusion, Monday-start IST weeks, direct-growth scope), and Step 9: how to fold a session's learnings back in |
| `docs/metric-skill/references/metric-definitions.md` | Every metric's definition. Buyer definitions are the ones this repo implements; seller definitions come from the Notion DRR doc. Divergences are marked `[dashboard]`. **Exact live status spellings.** |
| `docs/metric-skill/references/known-traps.md` | Dead fields, casing traps, telephony junk, right-censoring |
| `docs/metric-skill/references/table-map.md` | Exact columns, live value lists, Zoho-label ↔ API-name mapping |
| `docs/metric-skill/references/query-library.md` | Verified queries with the numbers they returned |

It moved here from `product-os/Skills/` on 2026-09-07 (that path is now just a pointer). The reason
matters: **the buyer definitions in that folder are the ones `lib/buyer/` implements.** While the
doc lived in another repo the two drifted apart — the dashboard changed its qualified-status list,
its visit definition and its population rules, and the doc went on describing the older Notion doc
for weeks with nobody aware.

So treat them as one artifact. **A PR that changes a buyer metric must change
`metric-definitions.md` in the same diff.** If you find yourself editing `lib/buyer/` without
touching that file, either the change is not a metric change or you are about to recreate the
drift.

The zip published to the growth team's Claude account is built from this folder. Never edit a
downloaded copy.

**One caveat on reading it here.** It was written against the Postgres mirror ("Zoho DB Sync")
that Metabase reads. Since 2026-09-28 this dashboard reads the same mirror, but through growth,
which rebuilds each record in the Zoho API's shape from the mirror's `_raw` JSON. The column names
are identical, so the definitions and the status spellings transfer directly. The Postgres-only
traps are growth's to handle, not this repo's: the bigint-`id` corruption, the inverted bulk-read
booleans and the stale multi-select type are all corrected there (see known-traps.md trap 43).

Talk in Zoho labels with people: `Deals` = **Bids**, `Events` = **Meetings**, `Products` = **Properties**.

### Rules that bite if forgotten

- Exclude `Truva_Cluster = 'VCV'` (test cluster) — but **null-safe**; a null cluster must still count.
- Exclude these `Lead_Source` values from the buyer population: `Channel Partner`, `Builder`,
  `Seller Referral`, `NoBroker`, **`Society Partners`**. The last two are ours, not Metabase's —
  see the reconciliation section. **`Society Partners` is PLURAL**; the singular does not exist in
  Zoho and matching on it excludes nothing. It is *not* the same as the direct sources
  `Society WA Groups` / `Society Management App` / `Society Data`, which stay in the population.
- Exclude any micromarket containing **`(Virtual)`** — from leads, qualified leads, visits and
  conversions, not just from the per-micromarket charts. Live values are `Airport (Virtual)`,
  `Mainland (Virtual)`, `Viceport (Virtual)`, `Leaf Links (Virtual)`; matched on the substring
  because the names are free-form. A lead keeps its real micromarkets and only drops out when
  *every* one it has is virtual. A blank micromarket is not virtual and still counts.
- Exclude bids whose **own** `Deals.Lead_Source` is `Channel Partner` — the bid drops (its visit,
  its warm flag, its conversion) but the lead behind it stays and can still qualify. This is
  bid-level and independent of the lead's own source. Null-safe: the 17 source-less bids survive.
- **A lead is a phone number, not a Zoho record.** `LeadFact.dedupKey` is the last 10 digits of
  `Phone` (falling back to `Mobile`), or `id:<id>` when neither has 10 — so phone-less leads never
  merge with each other. Rows are *not* merged; one per group is flagged `isPrimary` (most advanced
  status wins, earliest `Created_Time` breaks ties) and the counting cards filter on that, which
  keeps drill-downs pointing at real records. `assignLeadIdentity` must run **after** every
  exclusion so a dropped lead can never be elected the survivor.
- **Never AND cluster against micromarket on a lead.** They come from two unrelated Zoho fields
  (`Truva_Cluster` vs `UTM_Micromarket`/LSH) that disagree on about a third of records. Clicking a
  cluster in the picker also selects its micromarkets, so `micromarkets` already carries the whole
  intent — `leadMatches`/`visitMatches` therefore skip the cluster check whenever micromarkets are
  selected. Measured 2026-09-02: GLAM + Paid Ads for JAS 2026 is 996 leads by micromarket but only
  690 also carry `Truva_Cluster = GLAM`, so the old AND under-reported it by 31%. The live-house
  card still filters on cluster, and correctly — there the cluster sits on the Property.
- **3P micromarket falls back to `UTM_Micromarket`** when the LSH first touch has none.
  `fetchFirstTouches` only pulls LSH rows inside the window, so a 3P lead created before it had no
  micromarket at all — which is why the visit-pipeline card was almost all "Unknown" under a 3P
  filter (26 of its 28 3P leads predate the quarter). LSH still wins when present, so in-window 3P
  attribution is unchanged. Fixed 26 Unknowns down to 1.
- **COQL returns a multiselect as one semicolon-joined string**, so `toList` splits on `;`. Without
  it, `"Powai;Vegas"` and `"Powai; Glasgow"` stayed whole, matched no micromarket filter, and drew
  their own junk bars. Only `;` is split — free-text junk like `"Glasgow / Amsterdam"` is left
  alone rather than guessed at. (Typos such as `Glagow`, `Amesterdam`, and non-micromarkets like
  `Barberry` / `kanakia silicon valley` are still unhandled; add to `MICROMARKET_FIX` if they matter.)
- **The three by-source WoW cards stack by SOURCE, not channel** — "99Acres", not "3P". The channel
  taxonomy still exists and still drives targets, the source filter's grouping and the funnel; only
  those three charts show the leaf. Three things hang together and must stay in step:
  `SOURCES_BY_CHANNEL`/`SOURCE_ORDER` (`types.ts`, display order), `SOURCE_LABEL`/`sourceLabel()`
  (`shared.ts`, folds casing junk so `ig` and `Instagram` are one series), and `CHANNEL_RAMPS`
  (`palette.ts`, one hue family per channel so a stack still reads as its channel — greens Paid
  Ads, reds 3P, blues Organic). A test asserts every `SOURCE_LABEL` value appears in `SOURCE_ORDER`;
  a source missing from it sorts to the end of the stack and falls off its channel's ramp. This is
  why the 9-colour `SERIES_COLORS` ramp could not simply be reused — ~18 sources would wrap it and
  silently give two sources the same colour.
- Weeks are **Monday-start, IST**. Every date literal carries `+05:30`.
- Never drop telephony-junk statuses (`Network Issue`, `Open - Disconnected`, `Call Rejected`, …) —
  **fold them into `Attempted to Contact`**. They're real leads someone failed to reach.
- Never let an unmapped `Lead_Source` vanish — bucket it as `Unmapped` and keep it visible. (There
  is currently exactly 1 such lead; it's a useful canary that the mapping is still complete.)
- Qualified + Not Qualified **≠** Total Leads. Statuses like `Inactive`/`Call Later` sit in neither.
  Don't add a residual bucket to force it to reconcile.
- Build visit metrics on `Events` (`Module = 'Bid'`) joined to the linked Bid, and read completion
  off the **Deal's `Stage`** — anything other than `Unassigned` / `Pre-Visit` / `Cancelled` is a
  completed visit. (This replaced the older `Event.Visit_Status IN ('Visit Complete','Visit
  Completed')` reading; the two were reconciled live at 92.5% agreement before the switch.) The
  rollup fields on Leads/Bids remain dead or lossy — don't reach for them.

## Zoho module API names (verified live)

`Leads`, `Lead_Source_History`, `Deals`, `Events`, `Calls`, `Products`, `Sellers`,
`Leads_Property_Waitlist` (the "coming soon waitlist"; a linking module, needs a different fetch
approach than a normal module).

Do **not** use `Buyer_Lead_Source_History` — Zoho labels it "Lead source history test". Use
`Lead_Source_History`.

### Fields verified live 2026-09-02

Probed with real COQL queries, not `/settings/fields` — that endpoint omits real, populated
picklist values (it missed `Pre-Visit`, `Cancelled` and `Active - Cold` on `Deals.Stage`). To
check whether a field exists, `SELECT` it and read the error: a missing column returns
`{"code":"INVALID_QUERY","details":{"column_name":"…"}}`.

- **`Deals.Lead_Source` exists** and is the bid's own source. Over 24 months the *only* values are
  `Channel Partner` (6,578), `Direct` (4,338), null (17). There is no `Source`, `Bid_Source`,
  `Deal_Source` or `Channel` on Deals. `Deals.Truva_Micromarket` also exists but is unused.
- **`Leads.Phone`** is the phone field (91% filled); **`Leads.Mobile`** exists as a sparse
  secondary (28%). Using Phone with a Mobile fallback reaches 99.9% coverage. No
  `Secondary_Phone` / `Home_Phone` / `Other_Phone` / `Phone_Number`.
- **`Leads.Lead_Source`** distinct values over 24 months, for reference when editing the channel
  map: Meta 11018 · Channel Partner 3521 · 99Acres 2482 · Paid Ads (Unattributed) 1726 · Website
  1351 · Google Ads 1240 · Housing 882 · Instagram 572 · Magicbricks 443 · Offline Branding 399 ·
  Society WA Groups 362 · Organic 311 · Word of Mouth 207 · WhatsApp 155 · Referral 84 · Society
  Management App 58 · Seller Referral 58 · LinkedIn 32 · Society Data 24 · Nobroker 14 · Builder 13
  · **Society Partners 2** · ig 2 · google 1 · meta 1. Note the lowercase junk casings at the tail.

## Zoho API gotchas found the hard way

- **COQL caps any single query at 10,000 rows.** Fetching all ~10.3k Deals hits it. `lib/buyer/
  aggregate.ts` works around this with three targeted Deal slices (warm bids, closed-won in
  quarter, bids referenced by the quarter's visit Events) unioned in memory.
- **COQL rejects two-sided range filters (`col >= a AND col < b`) on Events/Deals**, failing with a
  misleading `SYNTAX_ERROR near "where"`. Use `BETWEEN` instead. (Leads tolerates `>=`/`<`.)
- **Don't run COQL calls concurrently.** With `Promise.all`, whichever query landed 2nd/3rd
  intermittently threw that same spurious syntax error. All Zoho calls are sequential — slower
  (~9–12s for a full `/api/buyer` build) but deterministic.
- COQL subqueries (`where X in (select ...)`) silently cap the inner result set — useless for
  filtering against thousands of ids. Fetch and join in memory instead.

## Layout

```
app/page.tsx                  Buyer/Seller tab shell (useHashState)
app/api/buyer/route.ts        GET /api/buyer → BuyerReportData
lib/buyer/aggregate.ts        All Zoho fetching + all 12 metrics (~560 lines)
lib/buyer/types.ts            BuyerReportData and friends
lib/zoho.ts                   Generic COQL/REST helpers (inherited from wire, unchanged)
components/buyer/             BuyerTab + 5 chart components + palette
components/shared/            ChartCard, StatTile, LeadListModal, Nav, Footer, ZohoLink,
                              StatusBadge, auth wrapper/login screen
lib/auth0/, lib/sentry/       Vendored from @workspace/* (this repo isn't in the workspace)
app/api/procurement/route.ts  GET /api/procurement → ProcurementReport
lib/procurement/growth.ts     Reads growth's /api/procurement/society-progress
lib/procurement/priority.ts   Airtable P0/P1/P2, the degradable source
lib/procurement/report.ts     Attaches priority to growth's rows and rolls up by band
```

`/api/buyer` payload: `leadsBySource` / `leadsByStatus` / `qualifiedBySource` / `qualifiedByCluster`
/ `uniqueVisitsBySource` / `totalVisitsByMicromarket` are `WeekSeriesPoint[]`
(`{weekStart, weekLabel, counts: {dim: n}, leadIds: {dim: [ids]}}`); plus `visitPipeline`,
`notQualifiedReasons`, `funnelOverview`, `visitedByEverWarm`, and `leadsById` (drill-down lookup).

Clicking any bar segment / pie slice opens `LeadListModal` with the underlying leads, each
deep-linked to Zoho via `ZohoLink` (`https://crm.zoho.in/crm/tab/Leads/{id}`).

## Local auth bypass

`WireAuthWrapper.tsx` and `lib/auth0/middleware.ts` skip the Auth0 gate when
`NODE_ENV=development` **and** `LOCAL_PREVIEW_SKIP_AUTH=true`. This exists because the repo has no
Auth0 app of its own yet. It's inert anywhere Auth0 is really configured.

Side effect: `Auth0Provider` isn't mounted, so `useUser()` in `Nav.tsx` produces harmless repeated
`GET /api/unprotected/auth/profile 401`s locally. Not a bug; won't happen in a real deployment.

## How to verify metrics (do this — don't trust reasoning alone)

Metabase's public API returns each card's **computed results**, no auth needed:

```
curl -s "https://metabase.truva.in/api/public/dashboard/195e1d42-17c5-49d0-8977-8abee715c9b6/dashcard/<dashcardId>/card/<cardId>"
```

dashcard/card pairs: 848/727 Quarter Overview · 849/728 same as table · 850/729 Last 2-week TvsA ·
851/730 Leads by Source · 852/731 Leads by Status · 853/732 Qualified by Source · 854/733 Unique
Visits by Source · 855/734 Total Visits by Micromarket · 856/735 Not Qualified Reasons · 857/736
Qualified by Cluster · 858/737 Visit Pipeline · 859/738 Visited leads per live house.

The **mirror can also be queried directly** via the Metabase MCP tools (authenticated): db 6,
`leads` = table 192, `deals` = table 203. Invaluable for deciding whether a mismatch is our bug or
theirs.

**The bar is not exact equality.** Metabase reads the Postgres mirror's typed columns; we read its
`_raw` JSON through growth, which matched live Zoho exactly when checked on 2026-09-28. Older weeks
should match closely and any gap should be *explainable*.

> ⚠️ **The parity baseline below is historical and no longer reproducible.** On 2026-09-02 four
> eligibility rules were added (see "Rules that bite if forgotten") that deliberately move our
> numbers away from Metabase. Do **not** treat a gap against Metabase as a bug any more without
> first accounting for these four. Measured on the JAS 2026 window at the time of the change:
>
> | Rule | Effect |
> |---|---|
> | `Society Partners` excluded | ~0 this quarter (2 leads in 24 months); Metabase keeps them |
> | `(Virtual)` micromarkets excluded | −33 lead rows; Metabase keeps them in totals |
> | Channel-Partner **bids** excluded | **visits 569 → 485 (−15%)**, conversions 11 → 10. The single biggest divergence — 60% of all bids (6,578 of 10,933 over 24 months) are CP-sourced, though far fewer of them have completed visits in-quarter. Metabase does not filter bids by source at all. |
> | Phone identity | −22 leads (0.4%); Metabase's lead cards don't dedupe on phone, though its per-quarter visit card does |
>
> The house card (`Visited Leads per Live House`) is the one card that **cannot** honour the CP-bid
> rule: it reads the Zoho rollups `Unique_visits_Direct` / `Active_warm_bids_Direct`, computed
> inside the CRM, which already include CP visits and cannot be netted out from here.

The historical baseline, as of 2026-09-01 and *before* the four rules — ours vs Metabase:
Total Leads 4180 vs 4181; Paid Ads/Organic/Offline/Society/Ref+WOM/Unmapped **exact**; 3P 852 vs
853; Qualified **930 exact**; New Visits **194 exact**; Total Visits 359 vs 360; Conversions
**4/7/11 exact**; Not Qualified **all 7 reasons exact**; Visit pipeline **251 exact**.

### Three different "visits" numbers coexist, and all are correct

402 raw `Events` rows → 397 deduped per-week (summed) → 360 deduped per-quarter (phone, last 10
digits). Do not try to reconcile them; each card means a different thing.

## ⚠️ Metabase's "Every Warm Leads" is wrong — ours is right

Metabase shows **325**; we show **15**. **We are correct.** The mirror's `deals.Was_Bid_Warm` is
broken by the sync:

- Mirror, all time: **10,859 true vs 76 false**, zero nulls — 99.3% of every bid flagged warm
- Mirror, this quarter: **1,710 true vs 65 false** (96.3%)
- Live Zoho, this quarter: **72** warm bids — a **24× gap**

So that card degenerates to "leads with *any* bid". Live Zoho's ~8% all-time warm rate (821 of
~10.3k) is the believable figure. **Business impact:** the Every Warm target is 144.56, so Metabase
renders a badly-missed metric as 225% of target (capped to a green 100% bar). This trap is not yet
in `known-traps.md` and should be added.

## State as of 2026-09-01

**Working:** 11 of 12 cards, verified above. `tsc --noEmit` clean, `eslint` clean.

**Open:**
1. **Card 729 (Last 2-week Target-vs-Achieved) not built** — `twoWeekTable` exists in the type but
   returns `[]`. 17 metrics × w2/quarter × target/actual with a hardcoded per-channel × micromarket
   target grid; the most complex card.
2. **Card 738 ever-warm-per-house: 469 vs 394 (+19%), unexplained.** Reads
   `Products.Unique_visits_Direct` / `Active_warm_bids_Direct` rollups directly. Given rollups are
   documented as unreliable *and* what we just learned about `Was_Bid_Warm`, verify those rollups
   are trustworthy at all before charting them.
3. **Old Visits 165 vs 159 (+6)** — minor, likely visits completed between snapshots.
4. **Seller tab is a placeholder.** The skill has full seller definitions (`Call_Status`, the
   lowercase-q `Not qualified` trap, seller visits measured on `products.Acq_Status`, dedup on
   phone).
5. **Caching looks ineffective** — repeated ~10s `/api/buyer` calls rather than cache hits. Partly
   a dev/Turbopack artifact (module state resets), but confirm it holds in production.
6. **Targets are a hardcoded constant** for JAS 2026 (7753 / 2494 / 563.7 / 159 / 722.8 / 144.56 /
   21 / 9 / 30), mirroring what Metabase hardcodes. Needs updating each quarter.

## Deployment

Vercel, chosen for fast/shareable deploys. **Blocked**: the Vercel GitHub App needs approval from a
`truvahomes` org owner (Raj is not an owner). Login connection is done; the app-install approval is
not. Once granted, link the repo to Vercel (project `growth-reporting`, team
`team_Sn1yKNSnCGcm1QwA97JjScV2` — a personal hobby account; consider a shared Truva team instead).

Env vars needed in Vercel — see `.env.example`, which is the authoritative list:
`GROWTH_LEDGER_BASE_URL` / `GROWTH_LEDGER_API_KEY` (every Zoho record comes through growth — the
Zoho OAuth vars are no longer read by the app); `AUTH0_SECRET` / `AUTH0_DOMAIN` /
`APP_BASE_URL` / `AUTH0_CLIENT_ID` / `AUTH0_CLIENT_SECRET`; `NEXT_PUBLIC_AUTH0_PREFIX` /
`NEXT_PUBLIC_AUTH0_LOGIN` / `NEXT_PUBLIC_AUTH0_LOGOUT`; **`GOOGLE_SA_CREDENTIALS_JSON`**; Sentry is optional. Do **not** set
`LOCAL_PREVIEW_SKIP_AUTH`.

The procurement dashboard adds only `AIRTABLE_API_KEY` / `AIRTABLE_BASE_ID` /
`AIRTABLE_TQ_TABLE`. It reaches growth with the `GROWTH_LEDGER_*` pair already set for the spend
ledger — same service, same `x-api-key` gate — so there is no new growth secret to add or rotate,
and one variable decides where both go. To point the dashboard at a local growth, set
`GROWTH_LEDGER_BASE_URL="http://localhost:4003"`.

Note growth answers a bad `x-api-key` with **403**, not 401 (401 is the separate
`/api/external/` branch, which this does not use). `lib/procurement/growth.ts` names the variable
to check in that error.

**It deliberately has no Metabase or database credentials.** The procurement ratio is computed
by growth and read from `GET /api/procurement/societies`, because every source it needs is
private to the VPC and Vercel has no static egress IP to allowlist — `known-traps.md` trap 42
has the measurements. Anything this dashboard needs from a private source arrives the same way:
a service inside the VPC computes it and serves it.

The `NEXT_PUBLIC_*` ones are inlined into the browser bundle, so set them as Vercel **Config**,
not Secret. `AUTH0_DOMAIN` is the bare tenant domain with no protocol; `APP_BASE_URL` is a full
URL. These are the v4 SDK names — v3's `AUTH0_BASE_URL` and `AUTH0_ISSUER_BASE_URL` are read by
nothing and setting them silently does nothing.

> ⚠️ **`GOOGLE_SA_CREDENTIALS_JSON` is required, fails closed, and is easy to paste wrong.**
> `SessionRevalidator` re-checks every ~30 min that a `@truva.in` user is still an active
> employee. If the variable is missing *or* unparseable it returns `invalid`, and the middleware
> 401s every `@truva.in` session — the whole team loses the dashboard, roughly 30 minutes after
> each login. It was missing from Vercel and from `.env.example` until 2026-09-07 and caused
> exactly that outage; the retry was then broken for another round because the JSON had been
> pasted **wrapped in single quotes** (`startsWithQuote: true`), so paste it raw: the value must
> start with `{` and end with `}`. Symptoms are in the runtime logs under `[SessionRevalidator]`.
> Note env-var changes need a **redeploy** to take effect.

**No Upstash and no cron.** `KV_REST_API_*`, `REDIS_URL` and `CRON_SECRET` are inert: nothing
imports `@upstash/redis` (only a stale `serverExternalPackages` entry in `next.config.ts`), and
the cron route was deleted with the wire pages. The buyer cache is a 5-minute in-process
variable, so on Vercel every cold lambda rebuilds from Zoho.

Auth0 currently shares wire's application. Each new deployment URL therefore has to be added to
that app's Allowed Callback URLs (`{APP_BASE_URL}/api/unprotected/auth/callback`), Logout URLs
and Web Origins. It should get its own Auth0 application before this goes wide.

## Still branded from the fork

`WireAuthWrapper.tsx` / `WireLoginScreen.tsx` keep their filenames and The Wire's login-screen
quotes. Functional, just not rebranded. `docs/the-wire.md` is stale wire documentation.
