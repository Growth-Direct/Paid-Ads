# Verified query library

Metrics the team has agreed on, with the SQL that produces them.

**Check this file before building anything new.** If the metric someone is asking for is here, use this query. Do not write a fresh version, because two definitions of "leads per week" means the team stops trusting both numbers.

Every entry has an agreed plain-English definition, the SQL, and a verified number with the date it was checked. An entry without those three things does not belong here.

Only Raj can add to this file, since it ships inside the skill. When you build something worth keeping, tell the person to send it to him.

---

## 1. Weekly visit-booked and visit-completed rate, by channel

**Question it answers:** of the leads that came in each week, what share got a visit booked, and what share actually completed one? Split by whether they came through WhatsApp or anything else.

**Definition**

- One row per week and channel group.
- Population: leads by `Created_Time`, bucketed into IST weeks starting Monday.
- Channel group: `First_Channel = 'WhatsApp'` is WhatsApp, everything else is Non-WhatsApp.
- Visit booked: the lead has at least one bid with at least one `events` row where `Module = 'Bid'`, any status.
- Visit completed: at least one of those events has `Visit_Status` of `Visit Complete` or `Visit Completed`.
- A lead counts once per week no matter how many bids or visits it has.
- Nothing excluded.

**This query pre-dates the 2026-09-01 buyer definition change** and still uses `Visit_Status`. Its totals were verified against live Zoho at the time and remain correct for that definition, but they will not tie to the buyer dashboard, which now reads visit completion off the bid's `Stage`. Swap the `Visit_Status` predicate for a `Stage NOT IN ('Unassigned', 'Pre-Visit', 'Cancelled')` join if the number has to match the dashboard.

**Verified:** 2026-08-05, cross-checked against a live Zoho pull for the same population. Every aggregate total matched exactly.

**Chart:** line chart. X is `cohort_week`, Y is `booked_rate_pct` and `completed_rate_pct`, series is `channel_group`.

```sql
WITH new_leads AS (
  SELECT
    "_id" AS lead_id,
    CASE WHEN "First_Channel" = 'WhatsApp' THEN 'WhatsApp' ELSE 'Non-WhatsApp' END AS channel_group,
    date_trunc('week', "Created_Time" AT TIME ZONE 'Asia/Kolkata') AS cohort_week
  FROM leads
  WHERE "Created_Time" >= '2026-04-01T00:00:00+05:30'
    AND "Created_Time" <  '2026-08-05T00:00:00+05:30'
),
bid_leads AS (
  SELECT "_id" AS bid_id, "Lead" AS lead_id
  FROM deals
),
visit_events AS (
  SELECT
    bl.lead_id,
    bool_or(e."Visit_Status" IN ('Visit Complete', 'Visit Completed')) AS completed
  FROM events e
  JOIN bid_leads bl ON bl.bid_id = e."What_Id"
  WHERE e."Module" = 'Bid'
  GROUP BY bl.lead_id
)
SELECT
  nl.cohort_week,
  nl.channel_group,
  COUNT(DISTINCT nl.lead_id) AS new_leads,
  COUNT(DISTINCT CASE WHEN ve.lead_id IS NOT NULL THEN nl.lead_id END) AS visit_booked,
  COUNT(DISTINCT CASE WHEN ve.completed THEN nl.lead_id END) AS visit_completed,
  ROUND(100.0 * COUNT(DISTINCT CASE WHEN ve.lead_id IS NOT NULL THEN nl.lead_id END)
        / NULLIF(COUNT(DISTINCT nl.lead_id), 0), 1) AS booked_rate_pct,
  ROUND(100.0 * COUNT(DISTINCT CASE WHEN ve.completed THEN nl.lead_id END)
        / NULLIF(COUNT(DISTINCT nl.lead_id), 0), 1) AS completed_rate_pct
FROM new_leads nl
LEFT JOIN visit_events ve ON ve.lead_id = nl.lead_id
GROUP BY nl.cohort_week, nl.channel_group
ORDER BY nl.cohort_week, nl.channel_group;
```

**Why it is written this way:** every join is text to text (`_id`, `Lead`, `What_Id`), no bigint `id` anywhere. Both date bounds carry `+05:30`. Booked and completed both come from `events`, never from a rollup field on leads or bids. Adapt the date range by editing the two literals in `new_leads`, keeping the offset.

**To change the split:** swap `First_Channel` for `First_Source`, `Lead_Source`, or `Truva_Micromarket` in the `new_leads` CTE. If you switch to `Lead_Source`, group case-insensitively, since live data has both `Meta` and `meta`.

---

## Template for new entries

```
## N. <plain-English name of the metric>

**Question it answers:** <one sentence, in the words the person asking would use>

**Definition**
- One row per <unit>.
- Population: <which records, over what window, by which date field>
- <each column defined>
- <what is excluded, and why>

**Verified:** <date>, <how it was checked, and against what>

**Chart:** <chart type, which column on which axis>

```sql
<the query>
```

**Why it is written this way:** <anything non-obvious that a future editor would otherwise break>
```

---

## 2. New seller leads by source, week on week (direct growth)

**Question it answers:** how many new seller leads did we get each week, and which sources did they come from? Direct growth only.

Live as **"New Leads by Source WoW"** on the Growth Seller Reporting dashboard.

**Definition**

- One row per week and clean source bucket.
- Population: seller leads by `Created_Time`, Monday-to-Sunday IST weeks, 12 weeks.
- Excludes the test cluster.
- Excludes `channel partner` and `society partners` sources, because reporting scope is direct growth right now.
- Raw source values folded into clean buckets. Anything unrecognised falls to `Other`.

**Verified:** 2026-08-10, live with the growth team. Last three complete weeks returned 185, 137 and 141 leads.

**Chart:** stacked bar. X is `cohort_week`, Y is `new_leads`, series is `seller_source_group`. Lives in the **Growth - Seller Reporting** collection, Truva business team view. External users have no access.

```sql
WITH seller_leads AS (
  SELECT
    date_trunc('week', "Created_Time" AT TIME ZONE 'Asia/Kolkata') AS cohort_week,
    CASE
      WHEN lower("Seller_Source") = 'meta'                        THEN 'Meta'
      WHEN lower("Seller_Source") = 'ig'                          THEN 'IG'
      WHEN lower("Seller_Source") IN ('google_ads','google ads')  THEN 'Google Ads'
      WHEN lower("Seller_Source") = 'website'                     THEN 'Website'
      WHEN lower("Seller_Source") IN
           ('99 acres','magicbricks','housing.com','nobroker','squareyards')
                                                                  THEN 'Listing Portals'
      WHEN lower("Seller_Source") LIKE 'society data%'             THEN 'Society Data'
      WHEN lower("Seller_Source") IN ('society management apps','society whatsapp')
                                                                  THEN 'Society Apps & WhatsApp'
      WHEN lower("Seller_Source") = 'mygate'                      THEN 'MyGate'
      WHEN lower("Seller_Source") = 'offline branding'             THEN 'Offline Branding'
      WHEN lower("Seller_Source") IN ('referral','word of mouth')  THEN 'Referral / Word of Mouth'
      ELSE 'Other'
    END AS seller_source_group
  FROM sellers
  WHERE "Created_Time" >= '2026-05-18T00:00:00+05:30'
    AND "Created_Time" <  '2026-08-10T00:00:00+05:30'
    AND "Truva_Cluster" IS DISTINCT FROM 'VCV'
    AND lower("Seller_Source") NOT IN ('channel partner','society partners')
)
SELECT
  cohort_week,
  seller_source_group,
  COUNT(*) AS new_leads
FROM seller_leads
GROUP BY cohort_week, seller_source_group
ORDER BY cohort_week, new_leads DESC;
```

**Why it is written this way**

`IS DISTINCT FROM 'VCV'` is the right way to exclude the test cluster. It keeps rows where `Truva_Cluster` is null, which a plain `!=` would silently drop. Use this idiom everywhere.

Source matching is all lowercased, which is what folds the `google_ads` junk variant in with `google ads`. The `LIKE 'society data%'` pattern catches `Society Data`, `Society Data - Cold Call` and `Society Data - WA Blast` in one bucket.

The upper date bound is the start of the current week, not today, so the last bar is always a complete week. Keep that property if you change the window.

**Two things to fix when someone next touches this**

1. **The dates are hard-coded.** A chart called WoW on a live dashboard will show May to August forever. Make the window relative so it rolls:

   ```sql
   WHERE "Created_Time" >= date_trunc('week', now() AT TIME ZONE 'Asia/Kolkata') - INTERVAL '12 weeks'
     AND "Created_Time" <  date_trunc('week', now() AT TIME ZONE 'Asia/Kolkata')
   ```

2. **`IG` is its own bucket, separate from Meta.** It is 7 records. Instagram is a Meta property, so this is a business call, not a data one: either fold it into `Meta`, relabel it `Instagram` and keep it separate, or leave it. Confirm with Nikita rather than changing it silently.

**One latent issue.** `lower("Seller_Source") NOT IN (...)` drops rows where `Seller_Source` is null, because `NULL NOT IN (...)` is null, not true. Today `sellers` has no null sources, only one empty string that lands in `Other`, so nothing is being lost. If nulls ever appear, this filter starts eating them.

---

## Metrics the growth team needs, not yet built

Nothing goes above the line until it has an agreed definition and a verified number.

- Cost and spend metrics, including cost per lead by campaign. Deferred to Wednesday's session, pending a queryable spend source.
- Leads per week by source and campaign, buyer side
- Lead to visit rate by campaign and ad set, using `lead_source_history`
- Re-engagement volume and its conversion, using `Is_Reactivation`
- CP-sourced versus direct funnel comparison, once direct growth reporting is stable
- First response time distribution, using `FRT` on `lead_source_history`
- Seller funnel by `Call_Status`, once Vidha has settled the qualified definition

## Known data quality issues affecting these

- **~38% of properties have no seller phone number.** Flagged on 2026-08-10, root cause unknown. Anything joining properties to sellers by phone will silently lose those rows.
- **Lead Source History only starts 2026-06-09.** Earlier rows were hand-backfilled that day.
