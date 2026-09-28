# Table map: Zoho DB Sync

Everything here is in Metabase database **Zoho DB Sync**. Select it from the database dropdown before running any query.

Verified live on 2026-08-10 against Zoho module metadata and the Metabase replica schema.

## Zoho renames things. Use the labels when you talk to people.

Zoho's internal API names and the labels the growth team sees in the CRM are different, and the database uses the API names. So the table is called `deals` but everybody at Truva calls it a Bid. Talk in the right-hand column. Write SQL with the left.

| Metabase table | Zoho API name | What the team sees in Zoho | Singular |
|---|---|---|---|
| `leads` | `Leads` | Leads | Lead |
| `deals` | `Deals` | **Bids** | Bid |
| `events` | `Events` | **Meetings** | Meeting |
| `calls` | `Calls` | Calls | Call |
| `products` | `Products` | **Properties** | Property |
| `accounts` | `Accounts` | **Channel Partners** | Channel Partner |
| `sellers` | `Sellers` (`CustomModule4`) | Sellers | Seller |
| `lead_source_history` | `Lead_Source_History` (`CustomModule22`) | Lead Source History | |
| `lead_status_history` | `Lead_Status_History` (`LinkingModule16`) | Lead Status History | |
| `dealhistory` | `DealHistory` | **Stage History** | |

So when someone says "how many bids did we get from Meta", they mean rows in `deals`. When they say "visits", they mean `events`. When they say "properties", they mean `products`.

## Scale, for sanity checks

Row counts as of 2026-08-10. If a query returns a number wildly out of line with these, something is wrong.

| Table | Rows |
|---|---|
| `leads` | 23,498 |
| `deals` (Bids) | 10,269 |
| `events` where `Module = 'Bid'` (buyer visits) | 11,877, of which 7,968 completed |
| `products` (Properties) | 3,906 |

## How the tables connect

Always text column to text column. Never the bigint `id`.

```
leads._id  ←──  deals."Lead"                (a Bid belongs to a Lead)
deals._id  ←──  events."What_Id"            (a Meeting hangs off a Bid, where Module = 'Bid')
deals._id  ←──  dealhistory."Potential_Name" (a stage change belongs to a Bid)
leads._id  ←──  lead_source_history."Lead"  (an engagement belongs to a Lead)
leads._id  ←──  calls."What_Id"             (a Call relates to a Lead)
deals._id  ←──  products via deals."Products" (a Bid is on a Property)
deals._id  ←──  accounts via deals."Account_Name" (a Bid can be tagged to a Channel Partner)
```

A lead can have many bids. A bid can have many meetings. A lead can have many source-history rows, one per engagement.

## `leads` (192) — Leads

319 columns. The ones growth needs:

**Identity and timing**

| Column | What it is |
|---|---|
| `_id` | The lead's Zoho ID as text. Use this for every join. |
| `Full_Name`, `Phone`, `Email` | Contact details |
| `Created_Time` | When the lead came in. This is the usual cohort date. |
| `Owner__name` | Lead owner, readable name |
| `Lead_Status` | Current status. See known-traps for the junk values. |
| `Lead_Status_Updated_Time`, `Qualified_on` | Status timing |

**Source and attribution**

| Column | What it is |
|---|---|
| `Lead_Source` | The channel the lead came from. Mixed casing in live data, see known-traps. |
| `First_Source`, `Last_Source` | First and most recent acquisition source |
| `First_Channel`, `Last_Channel` | First and most recent channel |
| `First_Engagement_Timestamp`, `Last_Re_engagement_Timestamp` | Engagement timing |
| `Total_Engagement_Count` | How many times this lead engaged |
| `Re_engaged` | Boolean |
| `Campaign_Name`, `Platform`, `Form_Name`, `Page_Name` | Meta lead-form metadata |
| `UTM_Source`, `UTM_Medium`, `UTM_Campaign_Name`, `UTM_Adset_Name`, `UTM_Ad_Name`, `UTM_Term` | UTM fields. Often coarser than the per-engagement rows in `lead_source_history`. |
| `UTM_Property_Name`, `UTM_Micromarket` | Set by the UTM builder |
| `GCLID`, `FBCLID` | Click IDs |
| `Listing_Platform` | Third-party portal, e.g. 99acres, Housing |
| `Channel_Partner__name` | CP on the lead |
| `Truva_Micromarket`, `Truva_Cluster` | Standard splits |

**Buyer profile**, if you need to segment: `Budget_range`, `Minimum_Budget`, `Maximum_Budget`, `Preferred_Configuration`, `Preferred_Area`, `Use_Case`, `Funding`, `Customer_Age`, `Family_Composition`.

**Do not use for visit metrics:** `Visit_Booked_On`, `Visited`, `First_visited_at`. See known-traps.

## `deals` (203) — Bids

189 columns. A Bid is one buyer's interest in one specific property.

| Column | What it is |
|---|---|
| `_id` | The Bid's ID as text |
| `Deal_Name` | Bid name |
| `Lead`, `Lead__name` | The lead this bid belongs to. `Lead` is the text ID, join on it. |
| `Products`, `Products__name` | The property. `Products` is the text ID. |
| `Account_Name`, `Account_Name__name` | Channel Partner, if tagged |
| `Stage` | Bid stage. Exact spellings in known-traps. |
| `Stage_Modified_Time` | When the stage last changed |
| `Lead_Source` | **On a Bid this is only Direct or Channel Partner.** It is not the lead's acquisition source. Different field, same name, different meaning. |
| `Created_Time` | When the bid was created |
| `Owner__name` | Bid owner |
| `Truva_Micromarket`, `Truva_Cluster` | Standard splits |
| `Selling_Price`, `Revenue`, `Blocking_Amount`, `Buyer_side_Brokerage` | Money |
| `Blocking_received_date`, `Buyer_MoU_Signing_Date` | Closing milestones |
| `Once_active_bid`, `Was_Bid_Warm` | Booleans for whether the bid was ever active or warm |

**Do not use:** `No_of_Visits` is always NULL. `First_completed_visit_time` only captures the first visit.

## `events` (155) — Meetings, i.e. visits

**This is the only reliable source for whether a visit was booked or completed.**

| Column | What it is |
|---|---|
| `_id` | The meeting's ID as text |
| `What_Id`, `What_Id__name` | The record it hangs off. For a buyer visit this is the Bid. Join on `What_Id`. |
| `Module` | What kind of meeting. **`Module = 'Bid'` means a buyer visit.** Always filter on this. |
| `Visit_Status` | `Scheduled`, `Visit Complete`, `Cancelled`, `Rescheduled`. See known-traps for spelling. |
| `Start_DateTime` | When the visit was scheduled for. **Use this as the visit date, not `Modified_Time`.** |
| `Created_Time` | When the meeting was booked. `Start_DateTime - Created_Time` is booking lead time. |
| `Owner__name` | The host who took the visit |
| `Visit_Rating` | 1 to 4 |
| `Truva_Micromarket`, `Truva_Cluster` | On the meeting itself, no join needed |
| `Feedback_Submitted_At`, `Feedback_Submit_Time`, `Time_to_Submit_Feedback_in_Hrs_dec` | Feedback timing |
| `Created_Via` | App or Others |
| `Visit_Source`, `Channel_Partner` | Visit-level source fields |

Definitions the team already uses: **visit booked** = any `events` row for the bid with `Module = 'Bid'`, any status. **Visit completed** = `Visit_Status IN ('Visit Complete', 'Visit Completed')` for the field itself — but the buyer DRR metric now reads the linked bid's `Stage` instead, counting anything except `Unassigned`, `Pre-Visit` and `Cancelled`. See `metric-definitions.md` before using either in a DRR number.

**Do not use `Type_of_meeting`** to split first from repeat visits. It is empty on every row.

## `lead_source_history` (157) — Lead Source History

One row per engagement on a lead. **This is the richest attribution data in the CRM and the best table for growth reporting.** The lead-level UTM fields are a coarser summary of this.

| Column | What it is |
|---|---|
| `_id` | Row ID as text |
| `Lead`, `Lead__name` | The lead. Join on `Lead`. |
| `Serial_Number` | Which engagement this was for that lead, 1, 2, 3... |
| `Timestamp` | When the engagement happened. Use this, not `Created_Time`. |
| `Source` | Source for this specific engagement |
| `Channel` | Channel for this specific engagement |
| `Campaign_Name`, `Campaign_ID` | Campaign |
| `Ad_Set_Name`, `Ad_Set_ID` | Ad set |
| `Ad_Name`, `Ad_ID` | Ad |
| `UTM_Medium`, `UTM_Term`, `UTM_Network` | UTM detail. `UTM_Medium` carries platform detail like `Facebook_Mobile_Reels`. |
| `GCLID`, `FBCLID` | Click IDs |
| `Property_Name`, `Property_ID` | The property in this engagement. `Property_Name` is long and raw, trim before showing. |
| `Micromarket` | Micromarket for this engagement |
| `Society_WA_Group_Name`, `Society_ID` | Society channel |
| `Channel_Partner_Name` | CP for this engagement |
| `Referrer_Name` | Referrer |
| `Is_Reactivation` | Boolean, was this a reactivation |
| `Days_Since_Previous_Re_engagement` | Gap since last engagement |
| `FRT`, `EE_Call_Timestamp` | First response time and the pre-sales call timestamp |
| `Visit_Booked_By_Bot`, `Bot_Initial_Intent`, `Bot_Chat_Disposition` | Bot fields |
| `Lead_Status` | Lead status at the time of this engagement |
| `Truva_Cluster` | Cluster |
| `LSH_Dedup_Key` | Dedup key |

Two caveats. Records only start from **2026-06-09**; anything before that was backfilled by hand on that date. And **a CP engagement writes its row when the bid is created, not when the lead is created**, so a CP lead with no bid has no row here at all.

## `calls` (143) — Calls

| Column | What it is |
|---|---|
| `_id` | Call ID as text |
| `What_Id`, `What_Id__name` | The related record. For lead calls this is the lead. Join on `What_Id`. |
| `Call_Start_Time` | When the call happened |
| `Call_Duration_in_seconds` | Duration in seconds. `Call_Duration` is text, use the seconds one for maths. |
| `Call_Type` | Inbound or outbound |
| `Call_Purpose`, `Call_Agenda` | Purpose |
| `Call_Result` | Outcome |
| `Outgoing_Call_Status` | Status of an outbound call |
| `Owner__name` | Who made the call |
| `EE_Agent` | Pre-sales agent |
| `Acefone_Call_ID`, `Acefone_Call_Status`, `Acefone_Recording_URL` | Acefone telephony fields |
| `Dialled_Number`, `Caller_ID` | Numbers |

**`Call_Status` is not a real column here.** It only exists inside the `_raw` JSON. Use `Call_Result`, `Outgoing_Call_Status`, or `Acefone_Call_Status` instead.

## `lead_status_history` (178) — Lead Status History

One row per status stint for a lead. Use it to answer "when did this lead become X".

The semantics are back-to-front from what people expect. `Moved_To__s` is the status the lead moved **into**. `Modified_Time` is when that move happened. The status column is what it moved **out of**. So "when did this lead become Qualified" is the `Modified_Time` of the row where `Moved_To__s = 'Qualified'`.

Leads whose status changed before this tracker started have no rows here.

## `dealhistory` (151) — Stage History, for Bids

One row per stage stint for a bid. Same back-to-front semantics as above.

| Column | What it is |
|---|---|
| `_id` | Row ID as text |
| `Potential_Name`, `Potential_Name__name` | The Bid. Join on `Potential_Name`. |
| `Stage` | The stage the bid was in, i.e. moved **out of** |
| `Moved_To__s` | The stage it moved **into**. Null on the current stint. |
| `Stage_Duration_Calendar_Days` | Days spent in the from-stage |
| `Modified_Time` | When that stint ended |
| `Modified_By__name` | Who changed it |

A bid moving **into** a stage X = a row where `Moved_To__s = 'X'`.

## `products` (153) — Properties

3,906 rows. Truva's property records.

**Do not confuse this with `property_details` (195), which has 42,295 rows and is a different module.** 195 is not Truva's inventory. If someone wants properties, they want `products`.

Key columns: `_id`, `Status` (overall lifecycle, `Status = 'Live'` is live inventory), `Acq_Status` (acquisition pipeline stage), `Go_Live_Date`, `Buyer_MoU_Signing_Date`, `Seller_MoU_Signing_Date`, `NPA_Date`, `Date_of_Recycle`, `Truva_Micromarket`, `Truva_Cluster`, `Current_Offer_Cr`, `No_of_Offers`.

These column names come from verified Zoho field metadata and the sync convention that database columns match Zoho API names, which holds on every other table here. They were not re-checked column by column on 2026-08-10. If you have the Metabase connector and are writing a property-heavy query, confirm the columns live first.

Exclude `Truva_Cluster = 'VCV'` from any real-inventory number. That is a test environment.

### `Acq_Status` — live values

The acquisition pipeline stage, and the field the whole seller-visit definition rests on. Counts are all properties with `Truva_Cluster IS DISTINCT FROM 'VCV'`, checked 2026-09-07. `Visit_Date` matters because Cases 2 and 3 attribute on it.

| Value | Properties | With `Visit_Date` | Visit case |
|---|---|---|---|
| `Deal Lost` | 1,686 | 1,270 | 3 |
| `Internally Rejected` | 604 | 395 | 2 |
| `Visit to be Scheduled` | 512 | 6 | 1 |
| `Explore Later - Post Visit` | 274 | 245 | 3 |
| `MoU Signed` | 246 | 246 | 3 |
| `Explore Later - Pre Visit` | 231 | 9 | 1 |
| `Visit Scheduled` | 129 | 14 | 1 |
| `Junk` | 112 | 8 | 1 |
| `Valuation Range Received` | 75 | 31 | 2 |
| `Sent for Valuation` | 53 | 53 | 3 |
| `Offer Made to Broker` | 46 | 46 | 3 |
| `Valuation Completed` | 44 | 43 | 3 |
| `Offer Made to Seller` | 24 | 23 | 3 |
| `Offer Range Rolled Out` | 19 | 11 | 3 |
| `Request Valuation Range` | 19 | 0 | 2 |
| `Negotiations` | 11 | 11 | 3 |
| `Awaiting Data from Acquisitions` | 9 | 9 | 3 |
| `Visit Completed` | 8 | 8 | 3 |
| `Pitched to Seller` | 5 | 5 | 2 |
| `Recycled` | 4 | 3 | 2 |
| `Revaluation Requested` | 4 | 4 | 3 |
| `` (empty string) | 3 | 1 | none |

22 distinct values, 4,118 properties. Everything is **Title Case** — the Notion doc writes eleven of these in sentence case, see the casing section in `metric-definitions.md`.

Note the empty string: `Acq_Status` is never NULL here, so `IS NOT NULL` does **not** filter out the blank ones. Use a case list, not a null check.

`Prospect`, `Qualified` and `Attempted to Contact` were live values on 2026-08-29 (10, 5 and 5 properties) and have no rows at all now. The seller-visit rules still name them.

## `sellers` (144) — Sellers

Seller lead records, before a property record exists. This is the growth team's first live reporting area, so it is documented in more detail than the rest.

| Column | What it is |
|---|---|
| `_id` | Seller lead ID as text |
| `Created_Time` | When the seller lead came in. The cohort date. |
| `Seller_Source` | Where the seller lead came from. Real values below. |
| `Call_Status` | **The live funnel status.** Real values below. |
| `Reason_for_Lead_Drop` | Why the lead dropped |
| `Truva_Micromarket`, `Truva_Cluster` | Standard splits. Always exclude `Truva_Cluster = 'VCV'`. |
| `Property_Created`, `First_property_created_at` | Boolean and timestamp marking handoff to a property record |
| `First_property_visit_date`, `First_Property_Valuation_Date`, `First_Seller_Offer_Date`, `First_Seller_MoU_Signing_Date` | Funnel milestones |
| `Campaign_Name`, `Campaign_ID`, `Adset_Name`, `Ad_Name`, `Campaign_Source`, `Platform` | Paid campaign metadata |
| `UTM_Source`, `UTM_Medium`, `UTM_Campaign`, `UTM_Adset_Name`, `UTM_Ad_Name`, `UTM_Micromarket` | UTM fields |
| `AI_Call_Made`, `Outcome_AI`, `Attempt_AI`, `Last_Called_At_AI` | Outbound AI calling |
| `EE_FRT_In_seconds`, `Last_Called_by_EE`, `EE_Response_Time` | Pre-sales response time |
| `Filled_Get_an_Offer` | Boolean, filled the Get an Offer form |
| `Locality_Society_Name`, `Address`, `Tower`, `Unit` | Property location on the lead |

**`Lead_Type` is dead. Do not use it.** The team stopped maintaining it. Seller funnel status is now `Call_Status` here, and `Acq_Status` on `products` once a property record exists.

### `Call_Status` — live values

Counts for leads created since 2026-05-01, checked 2026-08-10.

| Value | Rows |
|---|---|
| `Not qualified` | 1,970 |
| `Qualified` | 360 |
| `Attempted to Contact` | 331 |
| `Inactive` | 281 |
| `Explore Later` | 67 |
| `Invalid number` | 60 |
| `To call` | 55 |
| `Open - Disconnected` | 39 |
| `Already sold the flat` | 23 |
| `Prospect` | 8 |
| `Call Back` | 7 |
| `Network Issue` | 4 |
| `Call Rejected` | 1 |

Note the lowercase `q` in `Not qualified`. The old dead field spelled it `Not Qualified`.

The last three values are telephony dispositions, not real statuses. **Map them into `Attempted to Contact`, do not drop them.** See known-traps.

### `Seller_Source` — live values

Same window. 20 distinct values.

| Value | Rows | Note |
|---|---|---|
| `Meta` | 1,452 | |
| `Website` | 863 | |
| `google_ads` | 189 | **Junk casing.** Map to Google Ads. |
| `Offline Branding` | 156 | |
| `99 Acres` | 141 | |
| `Channel Partner` | 111 | Out of scope for direct growth |
| `Society Data - Cold Call` | 77 | |
| `Magicbricks` | 52 | |
| `Word of Mouth` | 32 | |
| `Housing.com` | 27 | |
| `Society Whatsapp` | 25 | |
| `NoBroker` | 18 | |
| `Society Data` | 16 | |
| `Referral` | 13 | |
| `Society Management Apps` | 11 | |
| `MyGate` | 8 | |
| `IG` | 7 | **Junk.** Map to Instagram. |
| `Ads` | 5 | Ambiguous, ask before bucketing |
| `Society Data - WA Blast` | 2 | |
| `` (empty) | 1 | |

There is no `Society Partners` value in this window, though it exists in the Zoho picklist. If the direct-growth filter needs to exclude society partners, confirm the exact string with Raj rather than guessing at which `Society *` values are meant.

### `Channel` is not usable on sellers

Of 3,206 seller leads since 2026-05-01: 2,122 blank, 590 `Unknown`, 13 null. **85% has no channel.** Do not offer it as a split. `Seller_Source` is the field that works, and its sub-source detail is inside the values themselves, like `Society Data - Cold Call`.

`Source_Category` is not a real column either. It exists only inside `_raw`, so reaching it needs JSON extraction.

**Unit of analysis:** the seller funnel starts on the seller lead and moves to the property record once `Property_Created` is set. Anything from visit onward should be measured on `products`, not here.
## `pre_qualified_data` (198) — Pre-Qualified Data, i.e. procured homeowner data

Added 2026-09-22 for the procurement dashboard. 57,759 rows, matching live Zoho exactly, so the
sync is current on this table.

One row is one procured seller contact, keyed on `Primary_Phone`. Read traps 38, 40 and 41 before
using it — every one of them returns a plausible wrong number rather than an error.

| Column | Notes |
|---|---|
| `_id` | Text, the exact Zoho id. Use this, never the bigint `id` (trap 1). |
| `Primary_Phone` | The module's natural key. `Spouse_Phone` exists as a second contact on the same record — it is not a second procured unit. |
| `Society_Name` | Free text, 99% populated, `''` not NULL when missing (trap 38). A projection of the FIRST `Property_details` row only. |
| `Tower_Name` | Free text, **37%** populated (trap 41). |
| `Unit_Number` | Free text, 40% populated (trap 41). |
| `Truva_Micromarket` | A Zoho **picklist**, so a controlled vocabulary — the one reliable coarse dimension on this table. |
| `Property_details` | The subform, as text. The multi-property truth behind the three fields above. |
| `_raw` | The whole Zoho record as jsonb, subform included. |
| `Status`, `Type_of_Data`, `Seller_Lead_created_in_Zoho` | Candidate gates for "what counts as procured" — **not settled**, see open question 11 in `metric-definitions.md`. |

There is **no lookup to the Societies module** on this table. Checked against Zoho's field
metadata on 2026-09-22: the module's only structured field is the `Truva_Micromarket` picklist.
Society and tower are text, which is why exactly one fuzzy match is unavoidable (trap 40).

## TruIQ Production (db 2) — the procurement denominator

A **different Metabase database** from Zoho DB Sync, and a different engine (MySQL). Select it
explicitly; nothing here can be joined to anything above in one query (trap 40).

| Table | Notes |
|---|---|
| `societies` (35) | `_id`, `name`, `federation_id`, `truva_qualified` (seven values — trap 39), and `zoho_record_id`, which joins back to db 6 `societies._id`. |
| `towers` (14) | Towers per society. |
| `units` (11) | One row per unit — the denominator is a count of these. Carries `tower_id` (a generated column) plus denormalised `societyName`/`towerName`/`federationName` lookups. |
| `federations` (32) | Federation, the level above society. |

The full hierarchy is City → Micromarket → Neighbourhood → Township → Federation → Society →
Tower → Series → Unit.

**`generic_airtable` is not exposed in this database.** TruIQ holds an Airtable-record-id to
entity-id mapping table of that name, which would make the P0/P1/P2 priority join an exact one,
but it is not synced into Metabase — checked 2026-09-22. Priority has to come from Airtable's own
API until that changes.

## Tables that look useful and are not

| Table | Why to avoid it |
|---|---|
| `buyer_lead_source_history` (161) | Its Zoho label is literally **"Lead source history test"**. It is a test module. Use `lead_source_history` (157). |
| `visits` (179) | Raw JSON only, no usable columns. Use `events` (155) for visits. |
| `property_details` (195) | A different module, 42,295 rows. Not Truva's property inventory. Use `products` (153). |
| `status_history` (149), `status_history_tracking` (173) | Generic status trackers for other modules. For bid stages use `dealhistory` (151). |
| `leads_x_leads` (213), `leads_x_leads2` (199) | Lead merge and dedup plumbing, not reporting data. |
