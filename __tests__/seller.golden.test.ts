import { deriveReport } from '@/lib/seller/derive'
import { EMPTY_SELLER_FILTERS, type SellerFilters } from '@/lib/seller/filters'
import { foldSellerStatus, isSellerQualified, mapSellerChannel } from '@/lib/seller/shared'
import type { SellerFact, SellerFacts, SellerProductFact, SellerSpendFact } from '@/lib/seller/facts'
import { EMPTY_SELLER_SPEND_INGEST } from '@/lib/seller/spend/parse'
import { SELLER_MICROMARKETS } from '@/lib/seller/types'
import { describe, expect, it } from 'vitest'

// Characterisation test for the seller cards. A hand-built fact fixture, run through the real
// derive, locks the full deriveReport output. Mirrors __tests__/derive.golden.test.ts.

const ISO = (m: number, d: number, h = 9) =>
    `2026-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T${String(h).padStart(2, '0')}:00:00+05:30`

let seq = 0
function seller(p: Partial<SellerFact> & { createdAt: string; rawSource: string }): SellerFact {
    seq += 1
    const id = p.id ?? `S${seq}`
    const callStatusRaw = p.callStatusRaw ?? 'Qualified'
    return {
        id,
        name: p.name ?? `Seller ${id}`,
        phoneKey: p.phoneKey ?? `${id}`,
        dedupKey: p.dedupKey ?? `id:${id}`,
        isPrimary: p.isPrimary ?? true,
        inPopulation: p.inPopulation ?? true,
        callStatusRaw,
        callStatusFolded: p.callStatusFolded ?? foldSellerStatus(callStatusRaw),
        // Through the real normalisers so the fixture can't drift from production behaviour.
        isQualified: p.isQualified ?? isSellerQualified(callStatusRaw),
        reasonForDrop: p.reasonForDrop ?? null,
        notTruvaQualifiedReasons: p.notTruvaQualifiedReasons ?? [],
        rawSource: p.rawSource,
        channel: p.channel ?? mapSellerChannel(p.rawSource)!,
        micromarkets: p.micromarkets ?? ['Powai'],
        clusters: p.clusters ?? [],
        createdAt: p.createdAt,
        responseAt: p.responseAt ?? null,
        acefoneLeadId: p.acefoneLeadId ?? null,
    }
}

const sellers: SellerFact[] = [
    // New cohort, Paid Ads Powai, Qualified — a lead, a QL, a new visit and a new conversion.
    seller({ id: 'S1', createdAt: ISO(7, 10), rawSource: 'Meta', micromarkets: ['Powai'] }),
    // New cohort, 3P Glasgow, Not qualified — a lead, not a QL, and NOT a qualifying-property
    // seller either despite holding a Case-3 always-counts status below (the new Call_Status
    // gate: Qualifying Properties/Unique Seller Visits/pipeline only count a Qualified seller's
    // properties). Also proves Not Qualified Reasons buckets a populated reason correctly.
    seller({
        id: 'S2',
        createdAt: ISO(7, 12),
        rawSource: '99acres',
        micromarkets: ['Glasgow'],
        callStatusRaw: 'Not qualified',
        reasonForDrop: 'Budget mismatch',
    }),
    // New cohort, Cold Outreach Amsterdam, Explore Later — a lead, a QL, two qualifying
    // properties (Case 2 with a date, Case 3 without one).
    seller({ id: 'S3', createdAt: ISO(7, 20), rawSource: 'society data', micromarkets: ['Amsterdam'], callStatusRaw: 'Explore Later' }),
    // Old cohort (before the quarter, not population) — an old visit + old conversion carrier.
    seller({ id: 'S4', createdAt: ISO(6, 1), rawSource: 'Meta', micromarkets: ['Powai'], inPopulation: false }),
    // New cohort, Organic Vegas, telephony junk folded to Attempted to Contact — a lead, no QL.
    seller({ id: 'S5', createdAt: ISO(7, 8), rawSource: 'Website', micromarkets: ['Vegas'], callStatusRaw: 'Network Issue' }),
    // New cohort, Paid Ads Powai, Qualified — a lead, a QL, but its only property is Case 2
    // with no Visit_Date, so it contributes zero qualifying properties (the "no fallback" rule).
    seller({ id: 'S6', createdAt: ISO(7, 14), rawSource: 'Meta', micromarkets: ['Powai'] }),
    // Old cohort, Qualified, Case-3 status with NO Visit_Date — proves the Old-cohort rule has
    // no "always counts" exception (unlike New): this must NOT count as an Old visit.
    seller({ id: 'S8', createdAt: ISO(6, 1), rawSource: 'Meta', micromarkets: ['Powai'], inPopulation: false }),
    // Old cohort, Qualified, Case-2 status with a Visit_Date OUTSIDE the current window —
    // proves Old needs the date IN-WINDOW, not just present.
    seller({ id: 'S9', createdAt: ISO(6, 1), rawSource: 'Meta', micromarkets: ['Powai'], inPopulation: false }),
    // Old cohort, Qualified, MoU Signed but the signing date is from a PRIOR quarter — proves
    // the 2026-09-07 Notion update (MoU signing date must fall in the current quarter) drops
    // this from Old Conversions, even though the status alone would have qualified before.
    seller({ id: 'S10', createdAt: ISO(6, 1), rawSource: 'Meta', micromarkets: ['Powai'], inPopulation: false }),
    // New cohort, "Already sold the flat" — a lead, AND a QL again. The 2026-09-07 Notion update
    // dropped this status from the qualified set; a 2026-09-24 explicit growth-team request
    // reinstated it dashboard-wide (see the 'reinstates "Already sold the flat"' test below).
    seller({ id: 'S11', createdAt: ISO(7, 16), rawSource: 'Meta', micromarkets: ['Powai'], callStatusRaw: 'Already sold the flat' }),
    // New cohort, "Prospect" — a lead, AND a QL. Proves the same update added this status
    // (sellers.Call_Status, a live field — not to be confused with the retired, zero-row
    // products.Acq_Status = 'Prospect' in the Case 2 list above).
    seller({ id: 'S12', createdAt: ISO(7, 17), rawSource: 'Meta', micromarkets: ['Powai'], callStatusRaw: 'Prospect' }),
]

const products: SellerProductFact[] = [
    // S1: Case 3 (always counts), has a date incidentally — dates never gate Case 3. Same
    // Visit_Date as the MoU Signed property below, so both land in the same week/source on
    // Property Visits by Source — used to prove that chart doesn't dedupe by seller.
    { sellerId: 'S1', acqStatus: 'Valuation Completed', visitDate: '2026-07-15', mouSigningDate: null, createdAt: '2026-07-10T09:00:00+05:30', minGuarantee: 0, source: '', valuationRequestDate: null, pricingCompletionDate: null, offerDate: null },
    // S1: MoU Signed → a new conversion, and a Case-3 qualifying property too. Also carries a
    // Min_Guarantee, so it's one of the two properties behind the "GMV Acquired" row's sum.
    { sellerId: 'S1', acqStatus: 'MoU Signed', visitDate: '2026-07-15', mouSigningDate: '2026-08-05', createdAt: '2026-07-10T09:00:00+05:30', minGuarantee: 5000000, source: '', valuationRequestDate: null, pricingCompletionDate: null, offerDate: null },
    // S1: Junk (Case 1, never a qualifying visit) — but S1 IS Qualified, so this counts toward
    // Qualified Properties (any status) even though it never counts toward Qualified Property
    // Visits. Proves the two float boxes are genuinely different numbers.
    { sellerId: 'S1', acqStatus: 'Junk', visitDate: null, mouSigningDate: null, createdAt: '2026-07-10T09:00:00+05:30', minGuarantee: 0, source: '', valuationRequestDate: null, pricingCompletionDate: null, offerDate: null },
    // S2: Case 3, would qualify on status alone, but S2 is Not qualified → excluded from both
    // Qualified Properties and Qualified Property Visits by the Call_Status gate.
    { sellerId: 'S2', acqStatus: 'Deal Lost', visitDate: '2026-07-13', mouSigningDate: null, createdAt: '2026-07-12T09:00:00+05:30', minGuarantee: 0, source: '', valuationRequestDate: null, pricingCompletionDate: null, offerDate: null },
    // S3: Case 2 (Internally Rejected et al.) WITH a Visit_Date → counts. Dated 3 Aug, a
    // DIFFERENT week than S3's own creation (20 Jul) — proves Property Visits by Source
    // attributes on the property's own Visit_Date, not the seller's week.
    { sellerId: 'S3', acqStatus: 'Pitched to Seller', visitDate: '2026-08-03', mouSigningDate: null, createdAt: '2026-07-20T09:00:00+05:30', minGuarantee: 0, source: '', valuationRequestDate: null, pricingCompletionDate: null, offerDate: null },
    // S3: second qualifying property, Case 3 with no Visit_Date → still counts (no date needed
    // for Case 3), falling back to the seller's own creation date (20 Jul) for attribution.
    // Same seller, so this does not add a second unique-seller visit.
    { sellerId: 'S3', acqStatus: 'Negotiations', visitDate: null, mouSigningDate: null, createdAt: '2026-07-20T09:00:00+05:30', minGuarantee: 0, source: '', valuationRequestDate: null, pricingCompletionDate: null, offerDate: null },
    // S4 (old cohort, created before the quarter): MoU Signed (Case 3) → an old visit + old
    // conversion. S4 defaults to Qualified, but it's outside this window's Qualified Leads
    // population (not in `windowSellers`), so it never counts toward Qualified Properties. Also
    // carries a Min_Guarantee — the OLD-cohort half of the "GMV Acquired" row's sum.
    { sellerId: 'S4', acqStatus: 'MoU Signed', visitDate: '2026-08-01', mouSigningDate: '2026-08-01', createdAt: '2026-06-01T09:00:00+05:30', minGuarantee: 3000000, source: '', valuationRequestDate: null, pricingCompletionDate: null, offerDate: null },
    // S6: Case 2 with NO Visit_Date → does not count as a qualifying visit (no fallback), but
    // DOES count toward Qualified Properties (any status), since S6 is Qualified. Created the
    // same week as S6 itself (14 Jul).
    { sellerId: 'S6', acqStatus: 'Internally Rejected', visitDate: null, mouSigningDate: null, createdAt: '2026-07-14T09:00:00+05:30', minGuarantee: 0, source: '', valuationRequestDate: null, pricingCompletionDate: null, offerDate: null },
    // S2: scheduled but not yet visited — would be a New-cohort pipeline property on status
    // alone, but S2 is Not qualified → excluded by the same gate as qualifying properties.
    { sellerId: 'S2', acqStatus: 'Visit Scheduled', visitDate: null, mouSigningDate: null, createdAt: '2026-07-12T09:00:00+05:30', minGuarantee: 0, source: '', valuationRequestDate: null, pricingCompletionDate: null, offerDate: null },
    // S6: Qualified, so this pipeline property counts toward both pipelineCount and Qualified
    // Properties. Same week as S6 itself (14 Jul) — together with the property above, this
    // gives S6 TWO properties in the same week/source, proving Qualified Properties by
    // Source's drill-down lists one entry per property (not deduped to the seller).
    { sellerId: 'S6', acqStatus: 'Visit to be Scheduled', visitDate: null, mouSigningDate: null, createdAt: '2026-07-14T09:00:00+05:30', minGuarantee: 0, source: '', valuationRequestDate: null, pricingCompletionDate: null, offerDate: null },
    // S6: a THIRD property, created a different week (21 Jul) than S6 itself (14 Jul) — proves
    // Qualified Properties by Source attributes on the property's own Created_Time, not the
    // seller's: S6 shows up in two different weeks on this chart.
    { sellerId: 'S6', acqStatus: 'Junk', visitDate: null, mouSigningDate: null, createdAt: '2026-07-21T09:00:00+05:30', minGuarantee: 0, source: '', valuationRequestDate: null, pricingCompletionDate: null, offerDate: null },
    // S8 (old cohort): Case 3, no Visit_Date. Old-cohort rule has no "always counts" fallback,
    // so this must NOT count as an Old qualifying visit — even though the identical status
    // would count unconditionally for a New-cohort seller (see S1's Valuation Completed).
    { sellerId: 'S8', acqStatus: 'Deal Lost', visitDate: null, mouSigningDate: null, createdAt: '2026-06-01T09:00:00+05:30', minGuarantee: 0, source: '', valuationRequestDate: null, pricingCompletionDate: null, offerDate: null },
    // S9 (old cohort): Case 2, Visit_Date present but BEFORE the window (2026-05-01, window
    // starts 2026-07-05). Must NOT count — Old needs the date falling IN the current quarter,
    // not merely present.
    { sellerId: 'S9', acqStatus: 'Recycled', visitDate: '2026-05-01', mouSigningDate: null, createdAt: '2026-06-01T09:00:00+05:30', minGuarantee: 0, source: '', valuationRequestDate: null, pricingCompletionDate: null, offerDate: null },
    // S10 (old cohort): MoU Signed, but Seller_MoU_Signing_Date (2026-04-01) is before the
    // window (starts 2026-07-05) — must NOT count as a conversion. No Visit_Date, so it's
    // already excluded from Old visits by the Case-3-no-date rule (S8's scenario), isolating
    // this test to the conversion-specific date gate.
    { sellerId: 'S10', acqStatus: 'MoU Signed', visitDate: null, mouSigningDate: '2026-04-01', createdAt: '2026-06-01T09:00:00+05:30', minGuarantee: 0, source: '', valuationRequestDate: null, pricingCompletionDate: null, offerDate: null },
]

// No spend in the fixture, so the snapshot locks every Spend/cost row at null — the point is
// that the cost block cannot perturb any other metric. computeSellerSpendForWindow has its own
// tests in __tests__/seller-costs.test.ts.
const facts: SellerFacts = {
    sellers,
    products,
    channelPartnerProducts: [],
    channelPartnerPlaces: {},
    spend: [],
    spendIngest: EMPTY_SELLER_SPEND_INGEST,
    windowStart: ISO(7, 5, 0),
    windowEnd: '2026-10-05T00:00:00+05:30',
}

const opts = {
    quarterStart: new Date('2026-07-05T00:00:00+05:30'),
    quarterEnd: new Date('2026-10-05T00:00:00+05:30'),
    now: new Date('2026-08-15T12:00:00+05:30'),
    // Pinned to New-only, NOT EMPTY_SELLER_FILTERS itself: this whole suite was built around
    // isolating New-cohort behavior from Old (see the many `visitScope: ['Old']` overrides
    // below), before EMPTY_SELLER_FILTERS's own default changed to both New+Old on 2026-09-09.
    // The 'defaults visitScope/conversionScope to New+Old' test below locks the real default.
    filters: { ...EMPTY_SELLER_FILTERS, visitScope: ['New'], conversionScope: ['New'] } satisfies SellerFilters,
}

describe('seller deriveReport golden', () => {
    const report = deriveReport(facts, opts)
    const row = (metric: string) => report.targetVsAchieved.find((r) => r.metric === metric)!

    it('produces the same full output (locks the six cards)', () => {
        expect(report).toMatchSnapshot()
    })

    it('splits WoW Property Visits by the PROPERTY\'s own Source into Direct vs Channel Partner', () => {
        // S1 already has a qualifying visit with source: '' (Direct, per the fixture default).
        // Add a second qualifying property, same week, explicitly Source = 'Channel Partner'.
        const cpSeller = seller({ id: 'SDCP', createdAt: ISO(7, 10), rawSource: 'Meta', micromarkets: ['Powai'] })
        const cpProduct: SellerProductFact = {
            sellerId: 'SDCP',
            acqStatus: 'Valuation Completed',
            visitDate: '2026-07-15',
            mouSigningDate: null,
            createdAt: '2026-07-10T09:00:00+05:30',
            minGuarantee: 0,
            source: 'Channel Partner',
            valuationRequestDate: null,
            pricingCompletionDate: null,
            offerDate: null,
        }
        const withCp = deriveReport({ ...facts, sellers: [...facts.sellers, cpSeller], products: [...facts.products, cpProduct] }, opts)
        const bucket = withCp.propertyVisitsByDirectCp.find((w) => w.weekStart === '2026-07-13')!
        expect(bucket.counts['Direct']).toBe(2) // S1's own two visits that week (see the base snapshot)
        expect(bucket.counts['Channel Partner']).toBe(1)
    })

    it('computes FRT (First Response Time) from EE_Response_Time - Created_Time, working hours only, Acefone-gated', () => {
        // Working-hours seller (10AM IST) with a real Acefone lead id and a response 30 minutes
        // later — must produce a real, non-null FRT bucket.
        const frtSeller = seller({
            id: 'SF1',
            createdAt: '2026-07-10T10:00:00+05:30',
            rawSource: 'Meta',
            acefoneLeadId: 'ACE1',
            responseAt: '2026-07-10T10:30:00+05:30',
        })
        // Same working hours and response, but NO Acefone lead id — must be excluded.
        const noAcefoneSeller = seller({
            id: 'SF2',
            createdAt: '2026-07-10T10:00:00+05:30',
            rawSource: 'Meta',
            acefoneLeadId: null,
            responseAt: '2026-07-10T10:30:00+05:30',
        })
        // Created at 8PM IST (after working hours) — must be excluded even with a real Acefone id.
        const afterHoursSeller = seller({
            id: 'SF3',
            createdAt: '2026-07-10T20:00:00+05:30',
            rawSource: 'Meta',
            acefoneLeadId: 'ACE3',
            responseAt: '2026-07-10T20:15:00+05:30',
        })
        const withFrt = deriveReport(
            { ...facts, sellers: [...facts.sellers, frtSeller, noAcefoneSeller, afterHoursSeller] },
            opts
        )
        const bucket = withFrt.frtByWeek.find((w) => w.weekStart === '2026-07-06')!
        expect(bucket.count).toBe(1)
        expect(bucket.avgMinutes).toBe(30)
    })

    it('shows Attempted to Contact % and Not Qualified % as a share of Total Leads, with no grid target', () => {
        // S5 (Organic Vegas, telephony junk 'Network Issue' folded to Attempted to Contact) and
        // S2 (99acres Glasgow, 'Not qualified') are the only two matches in the New-cohort
        // population for the default (unfiltered) scope. Total Leads (New cohort) is 7, so each
        // is 1/7 = 14.3%. Changed from an absolute count to a % of Total Leads 2026-09-24, per
        // an explicit growth-team request ("ATC% and NQ% in place of absolute numbers").
        const atc = row('Attempted to Contact %')
        const nq = row('Not Qualified %')
        expect(atc.qAchieved).toBe(14.3)
        expect(nq.qAchieved).toBe(14.3)
        // No grid target exists for either, same treatment as Visits in Pipeline.
        expect(atc.qTargetFull).toBeNull()
        expect(nq.qTargetFull).toBeNull()
        expect(atc.qTarget).toBeNull()
        expect(nq.qTarget).toBeNull()
    })

    it("uses the sheet's own 'All clusters' row (plus Bangalore) for the truly unfiltered Overall target, not a sum of the 9 micromarkets", () => {
        // Confirmed with the user 2026-09-24: summing the 9 named-micromarket 'Overall' rows
        // gives a materially different (and wrong) LTQL — 29% vs the sheet's own headline 14.8%
        // (Leads 4723, QL 701 — the 'All clusters' row PLUS Bangalore, added 2026-09-24 once the
        // same Bangalore-omission gap already fixed for every other channel turned out to apply
        // here too) — because the sheet's own total doesn't decompose the way a simple
        // per-micromarket sum would. See ALL_CLUSTERS_TOTAL's doc comment in targets.ts.
        expect(row('Total Leads').qTargetFull).toBe(4723)
        expect(row('Total Qualified Seller Leads').qTargetFull).toBe(701)
        expect(row('LTQL %').qTargetFull).toBe(14.8)

        // A Channel or Cluster/MM filter still sums the grid as before — this override applies
        // ONLY to the true no-filter case.
        const filtered = deriveReport(facts, { ...opts, filters: { ...EMPTY_SELLER_FILTERS, channels: ['Paid Ads'] } })
        const filteredRow = (metric: string) => filtered.targetVsAchieved.find((r) => r.metric === metric)!
        expect(filteredRow('Total Leads').qTargetFull).not.toBe(4147)
    })

    it('sums GMV Acquired over the same MoU-Signed population as Total Property Conversions, New+Old combined', () => {
        // S1 (New, ₹50L) and S4 (Old, ₹30L) are the two MoU Signed properties in-window — the
        // same two behind Total Property Conversions' qAchieved of 2. Unconditional on the
        // conversionScope pill (opts pins it to New-only), same as Spend itself.
        const gmv = row('GMV Acquired')
        expect(gmv.qAchieved).toBe(8000000)
        expect(gmv.qTargetFull).toBeNull()
        expect(gmv.qTarget).toBeNull()

        // % Spends of GMV = Spend / GMV * 100 — no spend in this fixture, so it's null (0/x is
        // still a real ratio, but ratioPct itself guards the DENOMINATOR being 0, not the
        // numerator, so a 0 numerator correctly reads as a real 0%, not blank).
        const pct = row('% Spends of GMV')
        expect(pct.qAchieved).toBe(0)
    })

    it('computes nextW2TargetProRata as a deficit-based catch-up, separate from the flat nextW2Target', () => {
        // Total Leads is well behind pace in this fixture (qAchieved 7 vs qTargetFull well above
        // it) — the pro-rata figure spreads the FULL remaining deficit over the days left, so it
        // must be steeper (higher) than the flat run-rate nextW2Target for the same metric.
        const totalLeads = row('Total Leads')
        expect(totalLeads.qTargetFull).not.toBeNull()
        expect(totalLeads.nextW2TargetProRata).not.toBeNull()
        expect(totalLeads.nextW2TargetProRata!).toBeGreaterThan(totalLeads.nextW2Target!)

        // Rate metrics skip the deficit math entirely and just carry the flat qTargetFull —
        // same as nextW2Target already does for them.
        const ltql = row('LTQL %')
        expect(ltql.nextW2TargetProRata).toBe(ltql.qTargetFull)
        expect(ltql.nextW2TargetProRata).toBe(ltql.nextW2Target)

        // A metric with no grid target at all (qTargetFull null — Visits in Pipeline isn't a
        // visit count, so there's nothing to reuse) floors to a real 0, not null — matches the
        // confirmed "no coverage -> 0" rule.
        const pipeline = row('Visits in Pipeline')
        expect(pipeline.qTargetFull).toBeNull()
        expect(pipeline.nextW2TargetProRata).toBe(0)
    })

    it('counts population sellers only, deduped by phone', () => {
        expect(row('Total Leads').qAchieved).toBe(7) // S1, S2, S3, S5, S6, S11, S12 — S4 is old cohort, out of population
        // S1 (Qualified), S3 (Explore Later), S6 (Qualified), S11 (Already sold the flat), S12
        // (Prospect) — reinstated 2026-09-24, see SELLER_QUALIFIED_STATUSES's own doc comment.
        expect(row('Total Qualified Seller Leads').qAchieved).toBe(5)
    })

    it('reinstates "Already sold the flat" as Qualified, dashboard-wide (2026-09-24 reversal of the 2026-09-07 change)', () => {
        // Verified directly against the Notion doc back on 2026-09-07: Qualified Seller Leads
        // used to be Qualified/Explore Later/Already sold the flat, became Qualified/Explore
        // Later/Prospect. Reinstated 2026-09-24 per an explicit growth-team request — now
        // Qualified/Explore Later/Prospect/Already sold the flat, a deliberate dashboard
        // divergence from the Notion doc as of this date.
        expect(report.sellersById['S11']).toBeDefined() // Already sold the flat — still a lead
        expect(report.sellersById['S12']).toBeDefined() // Prospect — still a lead
        const qlIds = new Set(
            report.leadsByStatus.flatMap((p) => Object.entries(p.leadIds)).flatMap(([status, ids]) =>
                status === 'Already sold the flat' || status === 'Prospect' ? ids : []
            )
        )
        expect(qlIds.has('S11')).toBe(true)
        expect(qlIds.has('S12')).toBe(true)
        expect(report.overallFunnel.qualified.actual).toBe(5) // both S11 and S12 count toward QL now
    })

    it('counts New Visits as UNIQUE SELLERS with >=1 qualifying property', () => {
        // Deliberate departure from the skill's per-property definition (see the doc comment
        // on Actuals.visits in derive.ts) — S1 and S3 each have >=1 qualifying property, so
        // New Visits is 2. S2's qualifying-looking property is gated out (not a Qualified
        // seller); S6's only property is Case 2 with no date, so it never qualifies in the
        // first place. S4 is Old cohort, so it never counts toward New — the funnel's New/Old
        // arms are unconditional now (see the 'stay the same regardless of the scope pills'
        // test below), not gated by filters.visitScope the way the old single node was.
        expect(report.overallFunnel.newVisits.actual).toBe(2)
    })

    it("the funnel's New/Old arms and total stay the same regardless of the Visits/Conversions scope pills — unconditional now, mirroring the Target vs Achieved table's own New/Old rows", () => {
        // EMPTY_SELLER_FILTERS is the app's real default (SellerTab's initial React state) — this
        // suite's own `opts` pins the scope pills to New-only instead (see the comment on `opts`
        // above). The funnel no longer has a single pill-scoped number to compare — both arms
        // always show — so this test proves that directly: the same facts, run through two very
        // different scope-pill selections, produce identical funnel numbers.
        expect(EMPTY_SELLER_FILTERS.visitScope).toEqual(['New', 'Old'])
        expect(EMPTY_SELLER_FILTERS.conversionScope).toEqual(['New', 'Old'])
        const both = deriveReport(facts, { ...opts, filters: EMPTY_SELLER_FILTERS })
        // S1+S3 New, S4 Old = 3 unique seller visits total; S1 New + S4 Old = 2 conversions total.
        expect(both.overallFunnel.newVisits.actual).toBe(2)
        expect(both.overallFunnel.oldVisits.actual).toBe(1)
        expect(both.overallFunnel.totalVisits.actual).toBe(3)
        expect(both.overallFunnel.newConversions.actual).toBe(1)
        expect(both.overallFunnel.oldConversions.actual).toBe(1)
        expect(both.overallFunnel.totalConversions.actual).toBe(2)
        // `report` uses `opts`' New-only scope pin — identical numbers either way.
        expect(report.overallFunnel.newVisits.actual).toBe(both.overallFunnel.newVisits.actual)
        expect(report.overallFunnel.oldVisits.actual).toBe(both.overallFunnel.oldVisits.actual)
    })

    it('applies the three-case rule and the Qualified-seller gate to qualifying properties and pipeline', () => {
        // S1: 2 Case-3 properties (Junk doesn't count here). S3: 1 Case-2-with-date +
        // 1 Case-3-no-date, both count. S2's Case-3 property is excluded by the gate (Not
        // qualified). S6's Case-2-no-date property never qualifies regardless of the gate.
        // Total: 2 + 2 = 4. The per-property count now lives only on the Target vs Achieved
        // table ("New Property Visits") — the funnel itself dropped its property-level floats.
        expect(row('New Property Visits').qAchieved).toBe(4)
        expect(report.overallFunnel.newVisits.actual).toBe(2)
        // S2's pipeline property is gated out (Not qualified); S6's counts (Qualified).
        expect(report.overallFunnel.pipelineCount).toBe(1)
    })

    it('counts EVERY property of a Qualified seller for Qualified Properties, any Acq_Status', () => {
        // S1 (Qualified): 3 properties, including the Junk one. S3 (Explore Later, qualified):
        // 2 properties. S6 (Qualified): 3 properties, including the never-qualifying Internally
        // Rejected one and a second Junk one. S2 (Not qualified) and S4 (outside this window's
        // population) contribute nothing, even though S4 is itself Qualified. S12 (Prospect,
        // qualified) has no properties at all, so it contributes zero too. Total: 3 + 2 + 3 = 8.
        // Lives only on the table now ("Qualified Property Leads") — removed from the funnel,
        // which is entirely seller-level since the 2026-09-21 New/Old-arm redesign.
        expect(row('Qualified Property Leads').qAchieved).toBe(8)
    })

    it('counts New-cohort MoU conversions by default', () => {
        expect(row('New Conversions').qAchieved).toBe(1) // S1; S4 is old cohort
    })

    it('computes the three rates as percentages', () => {
        expect(report.ltqlPct).toBe(71.4) // QL 5 (incl. S11, "Already sold the flat") / Leads 7
        // Unique Seller Visits (2) and QL (5) are not a subset relationship by construction —
        // a seller can have a qualifying property without ever being marked Qualified elsewhere
        // in a real quarter — so this can land anywhere, including above 100%.
        expect(report.qltvPct).toBe(40) // Unique Seller Visits 2 / QL 5
        expect(report.convRatePct).toBe(50) // Conversions 1 / Unique Seller Visits 2
    })

    it('computes rate targets from ratios of the target grid\'s own values', () => {
        expect(report.overallFunnel.ltqlTarget).toBeGreaterThan(0)
        expect(report.overallFunnel.newQltvTarget).toBeGreaterThan(0)
        expect(report.overallFunnel.oldQltvTarget).toBeGreaterThan(0)
        expect(report.overallFunnel.newConvRateTarget).toBeGreaterThan(0)
        expect(report.overallFunnel.oldConvRateTarget).toBeGreaterThan(0)
    })

    it('folds telephony junk into Attempted to Contact on the status chart', () => {
        const statuses = report.leadsByStatus.flatMap((p) => Object.keys(p.counts))
        expect(statuses).toContain('Attempted to Contact')
        expect(statuses).not.toContain('Network Issue')
    })

    it('stacks WoW Leads by Channel by channel, not raw source', () => {
        const channels = report.leadsByChannel.flatMap((p) => Object.keys(p.counts))
        expect(channels).toContain('Cold Outreach') // 'society data' folds to this channel
        expect(channels).toContain('Paid Ads') // 'Meta' folds to this channel
        expect(channels).toContain('3P') // '99acres' folds to this channel
        expect(channels).toContain('Organic') // 'Website' folds to this channel
        expect(channels).not.toContain('Meta') // never a raw source name on this chart
    })

    it('attributes Qualified Properties by Channel to the property\'s own created date, not the seller\'s', () => {
        // S6 was created 14 Jul; two of its properties share that week, but the third is dated
        // 21 Jul — a different week — so S6 shows up in two different weeks on this chart.
        const weeksWithS6 = report.qualifiedPropertiesByChannel
            .filter((p) => (p.leadIds['Paid Ads'] ?? []).includes('S6'))
            .map((p) => p.weekStart)
        expect(new Set(weeksWithS6).size).toBe(2)
    })

    it('lists one drill-down entry per property on Qualified Properties by Channel, not deduped to the seller', () => {
        const bucket = report.qualifiedPropertiesByChannel.find(
            (p) => (p.leadIds['Paid Ads'] ?? []).filter((id) => id === 'S6').length >= 2
        )
        expect(bucket).toBeDefined()
    })

    it('attributes WoW Property Visits to the qualifying property\'s own Visit_Date, excluding a date-less Case-3 property outright (no seller-week fallback)', () => {
        // S3 has two qualifying properties: 'Negotiations' (no Visit_Date) and 'Pitched to
        // Seller' (dated 3 Aug). Rebuilt 2026-09-24, per an explicit growth-team request, WITHOUT
        // the Case-3 seller-creation-date fallback every other visit metric on this tab still
        // uses (e.g. sellerVisitsByChannel/leadsByChannel) — an event chart can't place an
        // undated event, so the date-less property is excluded from this chart entirely rather
        // than mis-dated to S3's own 20 Jul creation week.
        const s3LeadsWeek = report.leadsByChannel.find((p) => (p.leadIds['Cold Outreach'] ?? []).includes('S3'))!.weekStart
        const s3VisitWeeks = report.propertyVisitsByCohort
            .filter((p) => (p.leadIds['New'] ?? []).includes('S3'))
            .map((p) => p.weekStart)
        expect(s3VisitWeeks).not.toContain(s3LeadsWeek) // the no-date Negotiations property: excluded
        expect(s3VisitWeeks.length).toBe(1) // only the dated Pitched to Seller appears
    })

    it('dedupes Seller Visits by Channel per seller per bucket; WoW Property Visits does not', () => {
        // S1's two qualifying properties (Valuation Completed, MoU Signed) share a Visit_Date,
        // so both land in the same week/cohort on WoW Property Visits (keyed 'New', S1's cohort).
        const propertyBucket = report.propertyVisitsByCohort.find((p) => (p.leadIds['New'] ?? []).includes('S1'))!
        const sellerBucket = report.sellerVisitsByChannel.find((p) => (p.leadIds['Paid Ads'] ?? []).includes('S1'))!
        expect(propertyBucket.leadIds['New']!.filter((id) => id === 'S1').length).toBe(2) // one per property
        expect(sellerBucket.leadIds['Paid Ads']!.filter((id) => id === 'S1').length).toBe(1) // deduped
    })

    it('picks New visit/conversion targets from the grid by default', () => {
        // Both filters empty ⇒ all cells summed; default scope New ⇒ new_visits/new_conv columns.
        expect(row('Unique Seller Total Visits').qTarget).toBeGreaterThan(0)
        expect(row('Total Leads').qTarget).toBeGreaterThan(0)
    })

    it('prorates targets to the selected time window, not the whole quarter', () => {
        // Mirrors lib/buyer/derive.ts's windowFraction — a 14-day slice of the 92-day quarter
        // (Jul 5 – Oct 5) should show ~14/92 of the full quarterly target, not the whole thing,
        // so a filtered window's target/pace stays meaningful instead of dwarfing its actuals.
        // `now` is set past both windows' ends so each is fully paced (pace = 1), isolating the
        // window-fraction proration from the days-elapsed pacing that's layered on top of it.
        const afterBoth = new Date('2026-10-10T12:00:00+05:30')
        const full = deriveReport(facts, { ...opts, now: afterBoth })
        const windowed = deriveReport(facts, {
            ...opts,
            now: afterBoth,
            filters: {
                ...EMPTY_SELLER_FILTERS,
                periods: [{ start: '2026-08-24T00:00:00+05:30', end: '2026-09-07T00:00:00+05:30' }],
            },
        })
        const fullLeadsTarget = full.targetVsAchieved.find((r) => r.metric === 'Total Leads')!.qTarget!
        const windowedLeadsTarget = windowed.targetVsAchieved.find((r) => r.metric === 'Total Leads')!.qTarget!
        expect(windowedLeadsTarget).toBeLessThan(fullLeadsTarget)
        expect(windowedLeadsTarget / fullLeadsTarget).toBeCloseTo(14 / 92, 1)
    })

    it('shows Unique Seller New/Old Visits and New/Old Conversions unconditionally, not gated by the scope pills', () => {
        // This suite's `opts` scopes both visitScope and conversionScope to ['New'] only (the
        // app's real default is New+Old — see EMPTY_SELLER_FILTERS), but the table must still
        // show the Old-cohort rows (S4's Old visit/conversion) regardless of scope — they are
        // not gated by the scope pills at all, under either default.
        expect(row('Unique Seller Old Visits').qAchieved).toBe(1) // S4
        expect(row('Old Conversions').qAchieved).toBe(1) // S4
        // New (S1, S3 — 2) + Old (S4 — 1) = 3, unconditionally, unlike the Overall Funnel's own
        // scoped `uniqueSellerVisits.actual` (2, New only by default — see the earlier test).
        expect(row('Unique Seller Total Visits').qAchieved).toBe(3)
        // Renamed from 'Total Conversions' — this table row was always property-level/undeduped;
        // the Overall Funnel (Unique Seller)'s own Conversions arms are now seller-deduped
        // instead (see the dedicated seller-dedup test below), which is why the two can disagree.
        expect(row('Total Property Conversions').qAchieved).toBe(2) // New (S1) + Old (S4)
    })

    it("dedupes the Overall Funnel (Unique Seller)'s Conversions to one per seller, unlike the table or the Overall Funnel (Unique Property)", () => {
        // The main fixture has no seller with 2+ converted properties, so it can't distinguish
        // deduped from undeduped — S1 and S4 each have exactly one, and both readings happen to
        // agree by coincidence. Build one seller with two MoU Signed properties to actually prove
        // the dedup: property-level count goes up by 2, seller-deduped count goes up by only 1.
        const dualConvertSeller = seller({ createdAt: ISO(7, 18), rawSource: 'Meta', micromarkets: ['Powai'] })
        const dualConvertProducts: SellerProductFact[] = [
            {
                sellerId: dualConvertSeller.id,
                acqStatus: 'MoU Signed',
                visitDate: '2026-07-20',
                mouSigningDate: '2026-08-10',
                createdAt: dualConvertSeller.createdAt,
                minGuarantee: 0,
                source: '',
                valuationRequestDate: null,
                pricingCompletionDate: null,
                offerDate: null,
            },
            {
                sellerId: dualConvertSeller.id,
                acqStatus: 'MoU Signed',
                visitDate: '2026-07-25',
                mouSigningDate: '2026-08-12',
                createdAt: dualConvertSeller.createdAt,
                minGuarantee: 0,
                source: '',
                valuationRequestDate: null,
                pricingCompletionDate: null,
                offerDate: null,
            },
        ]
        const withDual = deriveReport(
            { ...facts, sellers: [...facts.sellers, dualConvertSeller], products: [...facts.products, ...dualConvertProducts] },
            opts
        )
        // Property-level (undeduped): S1's 1 + this seller's 2 = 3 — matches the table and the
        // Overall Funnel (Unique Property).
        expect(withDual.targetVsAchieved.find((r) => r.metric === 'New Conversions')!.qAchieved).toBe(3)
        expect(withDual.overallFunnelProperty.newConversions.actual).toBe(3)
        // Seller-deduped: S1 (1 seller) + this seller (1 seller, despite its 2 properties) = 2.
        expect(withDual.overallFunnel.newConversions.actual).toBe(2)
    })

    it('computes QLTV % on New visits only, even when the visit scope filter is set to Old', () => {
        const oldScope = deriveReport(facts, {
            ...opts,
            filters: { ...EMPTY_SELLER_FILTERS, visitScope: ['Old'], conversionScope: ['Old'] },
        })
        // QLTV % must still read New visits (2) over QL (5) = 40%, regardless of the Old-only
        // scope filter selected for the Overall Funnel's own single number.
        expect(oldScope.targetVsAchieved.find((r) => r.metric === 'QLTV %')!.qAchieved).toBe(40)
    })

    it('reuses the seller-level visit targets for the three Property Visits rows; Visits in Pipeline still has none', () => {
        // Added 2026-09-24 per the user: the property-visit rows are the property-level reading
        // of the exact same underlying visit population as the seller-level rows above them, so
        // they now share that same target instead of showing a dash — no separate grid column
        // exists (or is needed) for property-level visits specifically.
        expect(row('Unique Property Total Visits').qTargetFull).toBe(row('Unique Seller Total Visits').qTargetFull)
        expect(row('New Property Visits').qTargetFull).toBe(row('Unique Seller New Visits').qTargetFull)
        expect(row('Old Property Visits').qTargetFull).toBe(row('Unique Seller Old Visits').qTargetFull)
        expect(row('Unique Property Total Visits').qTargetFull).not.toBeNull()
        // Visits in Pipeline isn't a visit count at all — still nothing to reuse, stays null.
        expect(row('Visits in Pipeline').qTarget).toBeNull()
        // The actuals ARE real, sourced from the existing per-property qualifying count. New
        // (S1 x2, S3 x2) + Old (S4's in-window MoU Signed, Case 3) = 4 + 1 = 5 — same basis as
        // the Overall Funnel (Unique Property)'s own totalVisits (also unconditional New+Old,
        // per-property).
        expect(row('Unique Property Total Visits').qAchieved).toBe(5)
        expect(row('New Property Visits').qAchieved).toBe(4)
        expect(row('Old Property Visits').qAchieved).toBe(1)
        expect(row('Visits in Pipeline').qAchieved).toBe(1)
    })

    it("counts Visits in Pipeline's Last 2wk Achieved as New-cohort only (leads created in the last 2 weeks), unlike the Quarter column's New+Old live snapshot", () => {
        // Per an explicit growth-team clarification 2026-09-25 ("the visits in pipeline column
        // should include people whose leads were created last two weeks and are now in the
        // pipeline"): the Last 2wk column's own window here is [2026-07-27, 2026-08-10) (opts.now
        // is 2026-08-15, a Saturday, so the current week starts 2026-08-10).
        const w2NewSeller = seller({ id: 'SW2NEW', createdAt: ISO(7, 30), rawSource: 'Meta', micromarkets: ['Powai'] })
        const w2NewProduct: SellerProductFact = {
            sellerId: 'SW2NEW',
            acqStatus: 'Visit Scheduled',
            visitDate: null,
            mouSigningDate: null,
            createdAt: w2NewSeller.createdAt,
            minGuarantee: 0,
            source: '',
            valuationRequestDate: null,
            pricingCompletionDate: null,
            offerDate: null,
        }
        // Old cohort for the w2 reading (created before the quarter, 2026-07-05) — still
        // "currently in pipeline" today, but per the growth team's own words this isn't a "last
        // two weeks" figure at all, so it must NOT count here anymore (it still counts in the
        // Quarter column's own live snapshot, unchanged).
        const w2OldSeller = seller({
            id: 'SW2OLD',
            createdAt: ISO(6, 1),
            rawSource: 'Meta',
            micromarkets: ['Powai'],
            inPopulation: false,
        })
        const w2OldProduct: SellerProductFact = {
            sellerId: 'SW2OLD',
            acqStatus: 'Visit to be Scheduled',
            visitDate: null,
            mouSigningDate: null,
            createdAt: w2OldSeller.createdAt,
            minGuarantee: 0,
            source: '',
            valuationRequestDate: null,
            pricingCompletionDate: null,
            offerDate: null,
        }
        const withExtra = deriveReport(
            {
                ...facts,
                sellers: [...sellers, w2NewSeller, w2OldSeller],
                products: [...products, w2NewProduct, w2OldProduct],
            },
            opts
        )
        const pipeline = withExtra.targetVsAchieved.find((r) => r.metric === 'Visits in Pipeline')!
        expect(pipeline.w2Achieved).toBe(1) // SW2NEW only
        // The Quarter column still counts both (its own live "till date" snapshot, unchanged).
        expect(pipeline.qAchieved).toBeGreaterThanOrEqual(2) // at least SW2NEW + SW2OLD, plus S6 from the base fixture
    })

    it('reuses Total Qualified Seller Leads\' own target directly for Qualified Property Leads (no more 1.2x placeholder)', () => {
        // Replaces the earlier "1.2x the Total Leads target" placeholder, per the user
        // (2026-09-24) — same "share the seller-level target" treatment as the Property Visits
        // rows above.
        expect(row('Qualified Property Leads').qTargetFull).toBe(row('Total Qualified Seller Leads').qTargetFull)
        expect(row('Qualified Property Leads').qTargetFull).not.toBeNull()
    })

    it('counts Old Visits/Conversions as unique sellers — unaffected by the scope pills either way', () => {
        const old = deriveReport(facts, {
            ...opts,
            filters: { ...EMPTY_SELLER_FILTERS, visitScope: ['Old'], conversionScope: ['Old'] },
        })
        // S4 only, both counts — coincidentally 1 either way here since S4 has exactly one
        // qualifying property, but Seller Visits is the unique-seller count now, not the count
        // of properties. The scope-pill override above no longer changes the funnel's own
        // oldVisits/oldConversions (unconditional now) — kept here only because it's a harmless,
        // already-established fixture shape; report.overallFunnel.oldVisits.actual would be
        // identical without it.
        expect(old.overallFunnel.oldVisits.actual).toBe(1)
        expect(old.overallFunnel.oldConversions.actual).toBe(1)
    })

    it('gives Old-cohort Case 3 no "always counts" exception, unlike New', () => {
        // Without the cohort-aware fix, S8's date-less Deal Lost (Case 3) would have counted
        // unconditionally, and S9's out-of-window Recycled (Case 2) would have counted on
        // "any date present". Both must contribute zero Old visits — only S4 counts (asserted
        // above), so this stays at 1 rather than rising to 3. The per-property count now lives
        // only on the table ("Old Property Visits") — see the earlier "applies the three-case
        // rule..." test for its New-cohort equivalent.
        const old = deriveReport(facts, {
            ...opts,
            filters: { ...EMPTY_SELLER_FILTERS, visitScope: ['Old'], conversionScope: ['Old'] },
        })
        expect(old.targetVsAchieved.find((r) => r.metric === 'Old Property Visits')!.qAchieved).toBe(1)
        expect(old.overallFunnel.oldVisits.actual).toBe(1)
    })

    it('requires Seller_MoU_Signing_Date to fall in the current quarter for a conversion', () => {
        // S10's MoU Signed status alone would have qualified under the pre-2026-09-07 rule,
        // but its signing date is from a prior quarter, so it must NOT count. Only S4 (signed
        // 2026-08-01, in-window) counts as an Old conversion — still 1, not 2.
        const old = deriveReport(facts, {
            ...opts,
            filters: { ...EMPTY_SELLER_FILTERS, visitScope: ['Old'], conversionScope: ['Old'] },
        })
        expect(old.overallFunnel.oldConversions.actual).toBe(1)
    })

    it('adds Channel Partner-sourced conversions to Direct for the Overall Funnel\'s Total Conversions float box', () => {
        // A Channel Partner-sourced seller is excluded from the whole dashboard's population —
        // it must NOT appear in `sellers`/`products`, but its conversion still counts toward
        // `totalConversionsWithChannelPartner`, alongside Direct's own New+Old total (2, per the
        // earlier test: S1 New + S4 Old).
        const cpFacts = {
            ...facts,
            channelPartnerProducts: [
                {
                    sellerId: 'CP1',
                    acqStatus: 'MoU Signed',
                    visitDate: '2026-08-10',
                    mouSigningDate: '2026-08-10',
                    createdAt: '2026-07-10T09:00:00+05:30',
                    minGuarantee: 0,
                    source: '',
                    valuationRequestDate: null,
                    pricingCompletionDate: null,
                    offerDate: null,
                },
            ],
            channelPartnerPlaces: { CP1: { micromarkets: ['Powai'], clusters: [] } },
        }
        const withCp = deriveReport(cpFacts, opts)
        expect(withCp.overallFunnel.directConversionsTotal).toBe(2)
        expect(withCp.overallFunnel.totalConversionsWithChannelPartner).toBe(3) // 2 Direct + 1 Channel Partner
        // Direct's own scoped/unconditional numbers are unaffected — CP1 never enters `sellers`.
        expect(withCp.sellersById['CP1']).toBeUndefined()

        // A Micromarket filter that matches CP1's own place data (Powai) keeps counting it.
        const matchingFilter = deriveReport(cpFacts, {
            ...opts,
            filters: { ...EMPTY_SELLER_FILTERS, micromarkets: ['Powai'] },
        })
        expect(matchingFilter.overallFunnel.totalConversionsWithChannelPartner).toBe(3)

        // A Micromarket filter that excludes it (CP1 has no Glasgow) drops the CP conversion,
        // falling back to Direct-only — S1 (Powai) also drops out of Direct's own New total here,
        // so this only isolates the CP half by picking a micromarket neither carries.
        const excludingFilter = deriveReport(cpFacts, {
            ...opts,
            filters: { ...EMPTY_SELLER_FILTERS, micromarkets: ['Glasgow'] },
        })
        expect(excludingFilter.overallFunnel.totalConversionsWithChannelPartner).toBe(0)
    })

    it("includes the Channel Partner pool's own qualifying properties in WoW Property Visits — Direct vs. CP, keyed by the property's OWN Source", () => {
        // CP-sourced SELLERS are excluded from the whole dashboard's population upstream, so
        // their properties never reached facts.products — this chart is meant to split by the
        // PROPERTY's own Source, not the seller's, but its "Channel Partner" segment was
        // structurally near-empty as a result. Fixed 2026-09-24, per an explicit growth-team
        // report ("cp visits are not showing... need to be mapped on property source"): the
        // separate Channel Partner pool is scanned too, place-filtered, keyed by Source.
        const cpFacts = {
            ...facts,
            channelPartnerProducts: [
                {
                    sellerId: 'CP2',
                    acqStatus: 'Valuation Completed', // Case 3, always counts
                    visitDate: '2026-07-15',
                    mouSigningDate: null,
                    createdAt: '2026-07-10T09:00:00+05:30',
                    minGuarantee: 0,
                    source: 'Channel Partner',
                    valuationRequestDate: null,
                    pricingCompletionDate: null,
                    offerDate: null,
                },
                // CP3 belongs to the same excluded-seller pool but its OWN property Source is
                // NOT Channel Partner — proves the split reads the property's field, not an
                // assumption that every property in this pool is CP-sourced.
                {
                    sellerId: 'CP3',
                    acqStatus: 'Valuation Completed',
                    visitDate: '2026-07-15',
                    mouSigningDate: null,
                    createdAt: '2026-07-10T09:00:00+05:30',
                    minGuarantee: 0,
                    source: 'Meta',
                    valuationRequestDate: null,
                    pricingCompletionDate: null,
                    offerDate: null,
                },
            ],
            channelPartnerPlaces: {
                CP2: { micromarkets: ['Powai'], clusters: [] },
                CP3: { micromarkets: ['Powai'], clusters: [] },
            },
        }
        const withCp = deriveReport(cpFacts, opts)
        const week = withCp.propertyVisitsByDirectCp.find((p) => (p.leadIds['Channel Partner'] ?? []).includes('CP2'))
        expect(week).toBeDefined()
        expect(week!.counts['Channel Partner']).toBe(1)
        expect((week!.leadIds['Direct'] ?? []).includes('CP3')).toBe(true) // CP3's own Source is Meta -> Direct

        // A Micromarket filter that excludes it (CP2/CP3 have no Glasgow) drops both.
        const excludingFilter = deriveReport(cpFacts, {
            ...opts,
            filters: { ...EMPTY_SELLER_FILTERS, micromarkets: ['Glasgow'] },
        })
        const stillThere = excludingFilter.propertyVisitsByDirectCp.some(
            (p) => (p.leadIds['Channel Partner'] ?? []).includes('CP2') || (p.leadIds['Direct'] ?? []).includes('CP3')
        )
        expect(stillThere).toBe(false)
    })

    it('keeps "Total Conversions (Channel Partner + Direct)" unaffected by the Channel filter, but responsive to Micromarket', () => {
        // S1 (New) and S4 (Old) are both Meta/Paid Ads, Powai. Per an explicit growth-team
        // request 2026-09-24 ("overall conversions... should only change basis the micromarket
        // filter and time filter if changed"), picking a DIFFERENT channel must not drop them —
        // this float used to reuse actuals.conversionsNew/conversionsOld, which DOES gate on
        // channel/source, and a Channel filter measurably moved it before this fix.
        const channelFiltered = deriveReport(facts, {
            ...opts,
            filters: { ...EMPTY_SELLER_FILTERS, channels: ['3P'] },
        })
        expect(channelFiltered.overallFunnel.directConversionsTotal).toBe(2) // unchanged: S1 + S4

        // A Micromarket filter that excludes Powai DOES still drop them — the float is
        // place-and-time-only, not channel-blind-and-place-blind.
        const mmExcluded = deriveReport(facts, {
            ...opts,
            filters: { ...EMPTY_SELLER_FILTERS, micromarkets: ['Glasgow'] },
        })
        expect(mmExcluded.overallFunnel.directConversionsTotal).toBe(0)
    })

    it('caps the QTD Spend/cost rows at `now`, excluding spend the sheet already has for future dates', () => {
        // opts.now is 2026-08-15. The growth team's spend sheet is committed for the whole
        // quarter up front, not filled in day by day (verified live 2026-09-09: both spend
        // sheets already carry rows through Sep 30, weeks past `now`) — so a row dated 1 Sep
        // must not count yet even though it sits inside the full quarter window. Reported
        // 2026-09-09 against 3P specifically; the cap applies to every channel alike.
        const spend: SellerSpendFact[] = [
            { date: '2026-07-10T00:00:00+05:30', channel: '3P', micromarket: 'Powai', rawSource: '99acres', spendInr: 1000, impressions: 0, clicks: 0 },
            { date: '2026-09-01T00:00:00+05:30', channel: '3P', micromarket: 'Powai', rawSource: '99acres', spendInr: 5000, impressions: 0, clicks: 0 },
        ]
        const withSpend = deriveReport({ ...facts, spend }, opts)
        expect(withSpend.targetVsAchieved.find((r) => r.metric === 'Spend')!.qAchieved).toBe(1000)

        // Once `now` moves past the future row's date, it counts too — this is a cutoff, not
        // an exclusion of that row forever.
        const later = deriveReport({ ...facts, spend }, { ...opts, now: new Date('2026-09-05T12:00:00+05:30') })
        expect(later.targetVsAchieved.find((r) => r.metric === 'Spend')!.qAchieved).toBe(6000)

        // The Last 2-Week Spend column never needs the cap — its own window already ends at
        // the start of the current week, always <= `now` by construction.
        expect(withSpend.targetVsAchieved.find((r) => r.metric === 'Spend')!.w2Achieved).toBe(0)
    })

    it('buckets Not Qualified Reasons by Reason_for_Lead_Drop, within the selected time window', () => {
        // S2 is the only Not-qualified seller in the base fixture, with a populated reason.
        expect(report.notQualifiedReasons).toEqual([{ reason: 'Budget mismatch', count: 1, leadIds: ['S2'] }])
    })

    it('folds a blank Reason_for_Lead_Drop to "No Reason Given", and excludes an out-of-window seller', () => {
        const blankReasonSeller = seller({ id: 'SB1', createdAt: ISO(7, 22), rawSource: 'Meta', callStatusRaw: 'Not qualified' })
        const outOfWindowSeller = seller({
            id: 'SB2',
            createdAt: ISO(6, 15), // before the quarter
            rawSource: 'Meta',
            callStatusRaw: 'Not qualified',
            reasonForDrop: 'Should not appear',
            inPopulation: false,
        })
        const withExtra = deriveReport({ ...facts, sellers: [...sellers, blankReasonSeller, outOfWindowSeller] }, opts)
        const reasons = new Map(withExtra.notQualifiedReasons.map((r) => [r.reason, r]))
        expect(reasons.get('No Reason Given')?.leadIds).toContain('SB1')
        expect([...reasons.values()].some((r) => r.leadIds.includes('SB2'))).toBe(false)
    })

    it("buckets Truva_Qualified sub-reasons under the 'Not Truva approved' slice, one bucket per value for a multiselect seller", () => {
        const ntaSeller = seller({
            id: 'SN1',
            createdAt: ISO(7, 22),
            rawSource: 'Meta',
            callStatusRaw: 'Not qualified',
            reasonForDrop: 'Not Truva approved',
            notTruvaQualifiedReasons: ['Budget too high', 'No response'],
        })
        const withExtra = deriveReport({ ...facts, sellers: [...sellers, ntaSeller] }, opts)
        const subReasons = new Map(withExtra.notTruvaApprovedSubReasons.map((r) => [r.reason, r]))
        expect(subReasons.get('Budget too high')?.leadIds).toContain('SN1')
        expect(subReasons.get('No response')?.leadIds).toContain('SN1')
    })

    it("does not attribute a seller's Truva_Qualified sub-reasons to the 'Not Truva approved' bucket when its own reason is different", () => {
        // S2 (base fixture) is Not qualified with reason 'Budget mismatch', not 'Not Truva
        // approved' — even if it carried a Truva_Qualified value, it must not show up here.
        const otherReasonWithSub = seller({
            id: 'SN2',
            createdAt: ISO(7, 22),
            rawSource: 'Meta',
            callStatusRaw: 'Not qualified',
            reasonForDrop: 'Broker',
            notTruvaQualifiedReasons: ['Should not appear'],
        })
        const withExtra = deriveReport({ ...facts, sellers: [...sellers, otherReasonWithSub] }, opts)
        expect(withExtra.notTruvaApprovedSubReasons.some((r) => r.leadIds.includes('SN2'))).toBe(false)
    })

    it("groups Visits in Pipeline by Cluster, deriving cluster from the seller's primary micromarket", () => {
        // S6 (Powai) is the only pipeline-status property's seller in the base fixture.
        expect(report.pipelineByCluster).toEqual([{ cluster: 'PAV', counts: { Powai: 1 }, leadIds: { Powai: ['S6'] } }])
    })

    it('nests a second cluster correctly, and falls back to "Unmapped" for a seller with no micromarket', () => {
        const glamSeller = seller({ id: 'SP1', createdAt: ISO(7, 20), rawSource: 'Meta', micromarkets: ['Amsterdam'] })
        const unknownSeller = seller({ id: 'SP2', createdAt: ISO(7, 20), rawSource: 'Meta', micromarkets: [] })
        const glamProduct: SellerProductFact = {
            sellerId: 'SP1',
            acqStatus: 'Visit Scheduled',
            visitDate: null,
            mouSigningDate: null,
            createdAt: '2026-07-20T09:00:00+05:30',
            minGuarantee: 0,
            source: '',
            valuationRequestDate: null,
            pricingCompletionDate: null,
            offerDate: null,
        }
        const unknownProduct: SellerProductFact = {
            sellerId: 'SP2',
            acqStatus: 'Visit to be Scheduled',
            visitDate: null,
            mouSigningDate: null,
            createdAt: '2026-07-20T09:00:00+05:30',
            minGuarantee: 0,
            source: '',
            valuationRequestDate: null,
            pricingCompletionDate: null,
            offerDate: null,
        }
        const withExtra = deriveReport(
            {
                ...facts,
                sellers: [...sellers, glamSeller, unknownSeller],
                products: [...products, glamProduct, unknownProduct],
            },
            opts
        )
        const byCluster = new Map(withExtra.pipelineByCluster.map((p) => [p.cluster, p]))
        expect(byCluster.get('PAV')?.leadIds.Powai).toContain('S6')
        expect(byCluster.get('GLAM')?.counts.Amsterdam).toBe(1)
        expect(byCluster.get('Unmapped')?.leadIds.Unmapped).toContain('SP2')
    })

    it('ignores the time filter entirely for Visits in Pipeline by Cluster (a live snapshot)', () => {
        const farFuture = deriveReport(facts, {
            ...opts,
            filters: {
                ...EMPTY_SELLER_FILTERS,
                periods: [{ start: '2026-01-01T00:00:00+05:30', end: '2026-01-08T00:00:00+05:30' }],
            },
        })
        // S6's pipeline property is created in July, nowhere near this January window — a
        // time-filtered chart would show nothing, but this one still shows S6.
        expect(farFuture.pipelineByCluster.flatMap((p) => Object.values(p.leadIds).flat())).toContain('S6')
    })

    it('buckets a live junk micromarket value (e.g. "Outside MM") as "Unmapped" instead of its own stray bar, and lets the filter select it', () => {
        // Added 2026-09-24 per an explicit growth-team request ("add unmapped for all non
        // mapped micromarkets - Outside mm, Unrecognized yet and add that in the filter").
        const junkSeller = seller({ id: 'SJUNK', createdAt: ISO(7, 20), rawSource: 'Meta', micromarkets: ['Outside MM'] })
        const junkProduct: SellerProductFact = {
            sellerId: 'SJUNK',
            acqStatus: 'Visit to be Scheduled',
            visitDate: null,
            mouSigningDate: null,
            createdAt: '2026-07-20T09:00:00+05:30',
            minGuarantee: 0,
            source: '',
            valuationRequestDate: null,
            pricingCompletionDate: null,
            offerDate: null,
        }
        const junkFacts = { ...facts, sellers: [...sellers, junkSeller], products: [...products, junkProduct] }
        const withJunk = deriveReport(junkFacts, opts)
        const unmappedPoint = withJunk.pipelineByMicromarket.new.find((p) => p.cluster === 'Unmapped')
        expect(unmappedPoint?.leadIds['Visit to be Scheduled']).toContain('SJUNK')
        // No stray "Outside MM" bar of its own.
        expect(withJunk.pipelineByMicromarket.new.some((p) => p.cluster === 'Outside MM')).toBe(false)

        // The 'Unmapped' filter value selects it; a canonical micromarket filter does not.
        const unmappedFilter = deriveReport(junkFacts, { ...opts, filters: { ...EMPTY_SELLER_FILTERS, micromarkets: ['Unmapped'] } })
        expect(unmappedFilter.sellersById['SJUNK']).toBeDefined()
        const powaiFilter = deriveReport(junkFacts, { ...opts, filters: { ...EMPTY_SELLER_FILTERS, micromarkets: ['Powai'] } })
        expect(powaiFilter.sellersById['SJUNK']).toBeUndefined()
    })

    it('windows Pre-Visit Pipeline by Micromarket on lead creation date (unlike the Cluster chart above), keeping the forever reading on TillDate', () => {
        // Same far-future window as the Cluster test above, but here — added 2026-09-24 per an
        // explicit growth-team request — Window mode must EXCLUDE S6 (created in July, outside
        // this January window) entirely, while TillDate (New + Old together = "forever", no time
        // gate at all) still shows it.
        const farFuture = deriveReport(facts, {
            ...opts,
            filters: {
                ...EMPTY_SELLER_FILTERS,
                periods: [{ start: '2026-01-01T00:00:00+05:30', end: '2026-01-08T00:00:00+05:30' }],
            },
        })
        const flatIds = (points: typeof farFuture.pipelineByMicromarket.new) => points.flatMap((p) => Object.values(p.leadIds).flat())
        expect([...flatIds(farFuture.pipelineByMicromarket.new), ...flatIds(farFuture.pipelineByMicromarket.old)]).not.toContain('S6')
        expect([...flatIds(farFuture.pipelineByMicromarketTillDate.new), ...flatIds(farFuture.pipelineByMicromarketTillDate.old)]).toContain(
            'S6'
        )
        // Window's Old half is always structurally empty — see CohortSplitPipeline's doc comment.
        expect(farFuture.pipelineByMicromarket.old).toEqual([])
    })

    it('windows Acq Pipeline by Micromarket on lead creation date, keeping the forever reading on TillDate (New/Old is now a chart-local scope, not filters.visitScope)', () => {
        // S4/S8/S9/S10 are all Old-cohort (created before the quarter) sellers with an
        // ACQ_VISITED_STATUSES property in Powai — Window mode must drop every one of them
        // (Window shows New only), while TillDate's New+Old together keep them exactly as the
        // pre-2026-09-24 acqPipelineByMicromarket used to show unconditionally.
        const idsIn = (split: typeof report.acqPipelineByMicromarket) =>
            [...split.new, ...split.old].filter((p) => p.cluster === 'Powai').flatMap((p) => Object.values(p.leadIds).flat())
        const windowedIds = idsIn(report.acqPipelineByMicromarket)
        const tillDateIds = idsIn(report.acqPipelineByMicromarketTillDate)
        for (const oldSellerId of ['S4', 'S8', 'S9', 'S10']) {
            expect(windowedIds).not.toContain(oldSellerId)
            expect(tillDateIds).toContain(oldSellerId)
        }
        // S1 (New cohort) still shows up in both.
        expect(windowedIds).toContain('S1')
        expect(tillDateIds).toContain('S1')
        expect(report.acqPipelineByMicromarket.old).toEqual([])
    })

    it("puts a lead created AFTER a narrowed window into TillDate's Old bucket too, not just leads created before it", () => {
        // Old is "everything not New", never "created before the window" — otherwise Till Date
        // (which promises "forever, no time gate at all") would silently drop a lead created
        // AFTER whatever narrower period happens to be selected, e.g. an August-created lead
        // while viewing a July-only window. SAUG proves that case specifically.
        const augSeller = seller({ id: 'SAUG', createdAt: ISO(8, 10), rawSource: 'Meta', micromarkets: ['Powai'] })
        const augProduct: SellerProductFact = {
            sellerId: 'SAUG',
            acqStatus: 'Visit Scheduled',
            visitDate: null,
            mouSigningDate: null,
            createdAt: augSeller.createdAt,
            minGuarantee: 0,
            source: '',
            valuationRequestDate: null,
            pricingCompletionDate: null,
            offerDate: null,
        }
        const julyOnly = deriveReport(
            { ...facts, sellers: [...sellers, augSeller], products: [...products, augProduct] },
            {
                ...opts,
                filters: {
                    ...EMPTY_SELLER_FILTERS,
                    periods: [{ start: '2026-07-01T00:00:00+05:30', end: '2026-08-01T00:00:00+05:30' }],
                },
            }
        )
        const windowIds = julyOnly.pipelineByMicromarket.new.flatMap((p) => Object.values(p.leadIds).flat())
        const tillDateOldIds = julyOnly.pipelineByMicromarketTillDate.old.flatMap((p) => Object.values(p.leadIds).flat())
        expect(windowIds).not.toContain('SAUG')
        expect(tillDateOldIds).toContain('SAUG')
    })

    it('gives Properties with Stalled Conversions the same Window/Till Date + New/Old treatment as the other two Micromarket pipeline charts', () => {
        // SOLD is an Old-cohort seller (created before the quarter) with a stalled-conversion
        // status and a Visit_Date — added 2026-09-24 per an explicit growth-team request
        // ("Properties with stalled conversions should have the same logic").
        const oldSeller = seller({ id: 'SOLD', createdAt: ISO(6, 1), rawSource: 'Meta', micromarkets: ['Powai'], inPopulation: false })
        const oldProduct: SellerProductFact = {
            sellerId: 'SOLD',
            acqStatus: 'Valuation Completed',
            visitDate: '2026-07-20',
            mouSigningDate: null,
            createdAt: oldSeller.createdAt,
            minGuarantee: 0,
            source: '',
            valuationRequestDate: null,
            pricingCompletionDate: null,
            offerDate: null,
        }
        const withExtra = deriveReport({ ...facts, sellers: [...sellers, oldSeller], products: [...products, oldProduct] }, opts)
        const windowIds = withExtra.stalledConversionsByMicromarket.new.flatMap((p) => Object.values(p.leadIds).flat())
        const tillDateOldIds = withExtra.stalledConversionsByMicromarketTillDate.old.flatMap((p) => Object.values(p.leadIds).flat())
        expect(windowIds).not.toContain('SOLD')
        expect(tillDateOldIds).toContain('SOLD')
        expect(withExtra.stalledConversionsByMicromarket.old).toEqual([])
    })

    it("counts Post Visit TAT stages cumulatively by each stage's own transition date, not by the property's CURRENT Acq_Status", () => {
        // STAT1's current Acq_Status is 'Offer Made to Seller', but it also carries populated
        // Visit_Date / Valuation_Request_date / Pricing_completion_date fields from having passed
        // through every earlier stage on its way there — all four stages should count it, not
        // just the current one (rebuilt 2026-09-24, per an explicit growth-team request).
        const statSeller = seller({ id: 'STAT1', createdAt: ISO(7, 25), rawSource: 'Meta', micromarkets: ['Powai'] })
        const statProduct: SellerProductFact = {
            sellerId: 'STAT1',
            acqStatus: 'Offer Made to Seller',
            visitDate: '2026-07-28',
            mouSigningDate: null,
            createdAt: statSeller.createdAt,
            minGuarantee: 0,
            source: '',
            valuationRequestDate: '2026-08-02', // +5 days vs Visit_Date
            pricingCompletionDate: '2026-08-10', // +8 days vs Valuation_Request_date
            offerDate: '2026-08-15', // +5 days vs Pricing_completion_date
        }
        const withExtra = deriveReport({ ...facts, sellers: [...sellers, statSeller], products: [...products, statProduct] }, opts)
        const stage = (name: string) => withExtra.postVisitTat.stages.find((s) => s.stage === name)!
        expect(stage('Visit Completed').leadIdsNew).toContain('STAT1')
        expect(stage('Sent for Valuation').countNew).toBe(1)
        expect(stage('Sent for Valuation').leadIdsNew).toContain('STAT1')
        expect(stage('Valuation Completed').countNew).toBe(1)
        expect(stage('Offer Made to Seller').countNew).toBe(1)

        const transition = (from: string, to: string) => withExtra.postVisitTat.transitions.find((t) => t.from === from && t.to === to)!
        const avgNew = (t: { sumDaysNew: number; pairsNew: number }) => t.sumDaysNew / t.pairsNew
        expect(avgNew(transition('Visit Completed', 'Sent for Valuation'))).toBe(5)
        expect(avgNew(transition('Sent for Valuation', 'Valuation Completed'))).toBe(8)
        expect(avgNew(transition('Valuation Completed', 'Offer Made to Seller'))).toBe(5)
    })

    it("matches Post Visit TAT's Visit Completed count to the funnel/table's own Property Visits count exactly", () => {
        // Per an explicit growth-team request 2026-09-25 ("match the post visit TAT chart visit
        // completed count with the property visit count in the funnel and the table"): base
        // fixture already proves this by construction (countNew 4 / countOld 1 == New/Old
        // Property Visits' own qAchieved), but this test isolates the two specific cases that
        // used to make them disagree.
        const stage = (r: typeof report) => r.postVisitTat.stages.find((s) => s.stage === 'Visit Completed')!

        // Base fixture: 'Visit Completed' now reads the same qualifying-visit population as
        // New/Old Property Visits (S1 x2 + S3 x2 New, S4 x1 Old) — not the old "any Visit_Date
        // in window regardless of Acq_Status" reading.
        const visitCompleted = stage(report)
        const newPropertyVisits = report.targetVsAchieved.find((r) => r.metric === 'New Property Visits')!.qAchieved
        const oldPropertyVisits = report.targetVsAchieved.find((r) => r.metric === 'Old Property Visits')!.qAchieved
        expect(visitCompleted.countNew).toBe(newPropertyVisits)
        expect(visitCompleted.countOld).toBe(oldPropertyVisits)

        // A genuine Case-1 "never" property (Junk) with a stray Visit_Date populated must NOT
        // count, even though the old date-presence-only check would have counted it.
        const junkSeller = seller({ id: 'SJUNKVISIT', createdAt: ISO(7, 20), rawSource: 'Meta', micromarkets: ['Powai'] })
        const junkProduct: SellerProductFact = {
            sellerId: 'SJUNKVISIT',
            acqStatus: 'Junk',
            visitDate: '2026-07-25',
            mouSigningDate: null,
            createdAt: junkSeller.createdAt,
            minGuarantee: 0,
            source: '',
            valuationRequestDate: null,
            pricingCompletionDate: null,
            offerDate: null,
        }
        const withJunk = deriveReport({ ...facts, sellers: [...sellers, junkSeller], products: [...products, junkProduct] }, opts)
        expect(stage(withJunk).leadIdsNew).not.toContain('SJUNKVISIT')

        // A Case-3 property with NO Visit_Date "always" qualifies (mirroring the funnel/table
        // exactly) — must count here even without a date, which the old check would have missed.
        const noDateSeller = seller({ id: 'SNODATE', createdAt: ISO(7, 20), rawSource: 'Meta', micromarkets: ['Powai'] })
        const noDateProduct: SellerProductFact = {
            sellerId: 'SNODATE',
            acqStatus: 'Deal Lost', // Case 3, always counts
            visitDate: null,
            mouSigningDate: null,
            createdAt: noDateSeller.createdAt,
            minGuarantee: 0,
            source: '',
            valuationRequestDate: null,
            pricingCompletionDate: null,
            offerDate: null,
        }
        const withNoDate = deriveReport({ ...facts, sellers: [...sellers, noDateSeller], products: [...products, noDateProduct] }, opts)
        expect(stage(withNoDate).leadIdsNew).toContain('SNODATE')
    })

    it('excludes a Post Visit TAT stage date that falls outside the funnel window', () => {
        const statSeller = seller({ id: 'STATOLD', createdAt: ISO(7, 25), rawSource: 'Meta', micromarkets: ['Powai'] })
        const statProduct: SellerProductFact = {
            sellerId: 'STATOLD',
            acqStatus: 'Offer Made to Seller',
            visitDate: null,
            mouSigningDate: null,
            createdAt: statSeller.createdAt,
            minGuarantee: 0,
            source: '',
            valuationRequestDate: null,
            pricingCompletionDate: null,
            offerDate: '2026-04-01', // before the quarter (starts 2026-07-05) — must not count
        }
        const withExtra = deriveReport({ ...facts, sellers: [...sellers, statSeller], products: [...products, statProduct] }, opts)
        const offerStage = withExtra.postVisitTat.stages.find((s) => s.stage === 'Offer Made to Seller')!
        expect(offerStage.leadIdsNew).not.toContain('STATOLD')
        expect(offerStage.leadIdsOld).not.toContain('STATOLD')
    })

    // === Micromarket Analysis ===

    it('sums Qualified Seller Leads by micromarket to the same total as the Overall Funnel (every qualified seller here has a real micromarket)', () => {
        const total = report.qualifiedLeadsByMicromarketQuarter.reduce((s, p) => s + p.actual, 0)
        expect(total).toBe(report.overallFunnel.qualified.actual)
    })

    it('respects the Visits scope pill: sums to the New-only row when scope is New-only, and to the Total row when scope is New+Old', () => {
        const total = report.qualifiedVisitsByMicromarketQuarter.reduce((s, p) => s + p.actual, 0)
        // `report` comes from this suite's `opts`, pinned to New-only (see its comment) — the
        // bullet chart's achieved figure must move with that pill, unlike the Target vs Achieved
        // table's own "Unique Seller Total Visits" row, which is deliberately unconditional (see
        // computeActuals). The app's own real default is New+Old (EMPTY_SELLER_FILTERS).
        expect(total).toBe(row('Unique Seller New Visits').qAchieved)

        const bothScopes = deriveReport(facts, { ...opts, filters: { ...EMPTY_SELLER_FILTERS, visitScope: ['New', 'Old'] } })
        const totalBoth = bothScopes.qualifiedVisitsByMicromarketQuarter.reduce((s, p) => s + p.actual, 0)
        const rowBoth = bothScopes.targetVsAchieved.find((r) => r.metric === 'Unique Seller Total Visits')!
        expect(totalBoth).toBe(rowBoth.qAchieved)
    })

    it('gives every micromarket a target — HABIBI members map to the combined Bangalore row', () => {
        // The HABIBI micromarkets (Helsinki, Berlin, Hong Kong, Ibiza) have no row of their own
        // in the target sheet — only a combined 'Bangalore' one for the whole cluster. Confirmed
        // with the user 2026-09-24: picked alone (not just as a whole-cluster tick), each one
        // now maps to that combined Bangalore figure — the same "map to the nearest thing that
        // DOES have a cell" principle as a raw Source mapping to its parent Channel. Every
        // micromarket therefore gets a real, non-null target.
        // 'Bangalore' itself is a target-grid-only proxy name — no seller ever carries it as a
        // real Truva_Micromarket, so it never appears as its own row in this chart. Each HABIBI
        // member instead reads the SAME combined figure directly (all four must agree).
        const habibi = ['Helsinki', 'Berlin', 'Hong Kong', 'Ibiza']
        for (const field of ['qualifiedLeadsByMicromarketQuarter', 'qualifiedVisitsByMicromarketQuarter'] as const) {
            const points = report[field]
            for (const p of points) expect(p.target).not.toBeNull()
            const habibiTargets = habibi.map((mm) => points.find((p) => p.micromarket === mm)!.target)
            expect(new Set(habibiTargets).size).toBe(1)
        }
    })

    it('gives Powai the exact absolute quarter target from the grid (125 Qualified Leads), not a pro-rated share', () => {
        const powaiLeads = report.qualifiedLeadsByMicromarketQuarter.find((p) => p.micromarket === 'Powai')!
        expect(powaiLeads.target).toBe(125)
    })

    it("does not shrink a micromarket's target for a narrower time filter or for pace — Micromarket Analysis is always the FULL quarter, unlike the Target vs Achieved table's own paced QTD column", () => {
        // opts.now (Aug 15) is partway through the quarter, so a paced reading would come out
        // well under the full grid value; a window-scaled reading would also come out lower
        // for a single month than for the whole quarter. Neither happens here.
        const oneMonth = deriveReport(facts, {
            ...opts,
            filters: { ...EMPTY_SELLER_FILTERS, periods: [{ start: '2026-07-05T00:00:00+05:30', end: '2026-08-05T00:00:00+05:30' }] },
        })
        const fullQuarterTarget = report.qualifiedLeadsByMicromarketQuarter.find((p) => p.micromarket === 'Powai')!.target
        const oneMonthTarget = oneMonth.qualifiedLeadsByMicromarketQuarter.find((p) => p.micromarket === 'Powai')!.target
        expect(oneMonthTarget).toBe(fullQuarterTarget)
        expect(oneMonthTarget).toBe(125)
    })

    it("resolves a whole HABIBI cluster pick (Helsinki + Berlin + Hong Kong together) to the grid's combined Bangalore row", () => {
        const habibiOnly = deriveReport(facts, {
            ...opts,
            filters: { ...EMPTY_SELLER_FILTERS, micromarkets: ['Helsinki', 'Berlin', 'Hong Kong'] },
        })
        const leadsTarget = habibiOnly.targetVsAchieved.find((r) => r.metric === 'Total Leads')!.qTarget
        expect(leadsTarget).not.toBeNull()
        expect(leadsTarget).toBeGreaterThan(0)
    })

    it('also resolves a LONE HABIBI micromarket (no whole-cluster pick) to the same combined Bangalore row', () => {
        const helsinkiAlone = deriveReport(facts, {
            ...opts,
            filters: { ...EMPTY_SELLER_FILTERS, micromarkets: ['Helsinki'] },
        })
        const habibiTogether = deriveReport(facts, {
            ...opts,
            filters: { ...EMPTY_SELLER_FILTERS, micromarkets: ['Helsinki', 'Berlin', 'Hong Kong'] },
        })
        const helsinkiTarget = helsinkiAlone.targetVsAchieved.find((r) => r.metric === 'Total Leads')!.qTarget
        const togetherTarget = habibiTogether.targetVsAchieved.find((r) => r.metric === 'Total Leads')!.qTarget
        expect(helsinkiTarget).not.toBeNull()
        expect(helsinkiTarget).toBe(togetherTarget)
    })

    it("maps a lone raw Source (no parent Channel ticked) to that source's own Channel target", () => {
        // 'society data - cold call' (Cold Outreach's own raw source) has no cell of its own in
        // the grid — only per-Channel granularity exists — so it must read the SAME target as
        // picking the whole Cold Outreach channel, not the unfiltered Overall total. Confirmed
        // with the user 2026-09-24 after they caught this defaulting to Overall silently.
        const sourceOnly = deriveReport(facts, {
            ...opts,
            filters: { ...EMPTY_SELLER_FILTERS, sources: ['society data - cold call'] },
        })
        const channelOnly = deriveReport(facts, {
            ...opts,
            filters: { ...EMPTY_SELLER_FILTERS, channels: ['Cold Outreach'] },
        })
        const overallUnfiltered = deriveReport(facts, opts)
        const sourceTarget = sourceOnly.targetVsAchieved.find((r) => r.metric === 'Total Leads')!.qTargetFull
        const channelTarget = channelOnly.targetVsAchieved.find((r) => r.metric === 'Total Leads')!.qTargetFull
        const overallTarget = overallUnfiltered.targetVsAchieved.find((r) => r.metric === 'Total Leads')!.qTargetFull
        expect(sourceTarget).toBe(channelTarget)
        expect(sourceTarget).not.toBe(overallTarget)
    })

    it("reads a channel's own 'All clusters' sheet row PLUS its own Bangalore row for a whole-Channel pick, the same for a lone-Source fallback", () => {
        // Rebuilt 2026-09-24 per an explicit growth-team report ("jas targets not matching for
        // channels... Unattributed has been skipped. Only use all clusters targets"): a whole
        // "Paid Ads" pick (no Cluster/MM filter) reads the sheet's own "Paid | All clusters |
        // JAS" row directly, rather than reconstructing it from the 9 grid micromarkets plus a
        // separately-maintained "Unattributed" constant. Corrected again 2026-09-25, per the
        // user ("offline branding is 140, was supposed to be 193 with blr"): that row alone
        // isn't the whole story either — a whole-Channel pick's achieved figures always include
        // that channel's own Bangalore sellers too (no micromarket filter means every
        // micromarket), so 1,452 (Paid Ads' own "All clusters" row) + 48 (its own Bangalore row)
        // = 1,500 is the real target, mirroring ALL_CLUSTERS_TOTAL's own "All clusters +
        // Bangalore" combination for Overall. A lone raw Source under Paid Ads (e.g. "Meta")
        // reads the exact same 1,500 target — there's nothing left to selectively fold in once
        // both rows are read verbatim and combined the same way regardless of how `channels` was
        // derived.
        const channelOnly = deriveReport(facts, { ...opts, filters: { ...EMPTY_SELLER_FILTERS, channels: ['Paid Ads'] } })
        const sourceOnly = deriveReport(facts, { ...opts, filters: { ...EMPTY_SELLER_FILTERS, sources: ['meta'] } })
        const channelTarget = channelOnly.targetVsAchieved.find((r) => r.metric === 'Total Leads')!.qTargetFull
        const sourceTarget = sourceOnly.targetVsAchieved.find((r) => r.metric === 'Total Leads')!.qTargetFull
        expect(channelTarget).toBe(1500)
        expect(sourceTarget).toBe(1500)
    })

    it("locks every channel's own 'All clusters' + Bangalore JAS target, re-verified 2026-09-25 against the sheet directly", () => {
        // Channel = <name>, Micromarket = 'All clusters', Quarter = 'JAS' on the "MM-WISE View
        // (Seller)" tab, PLUS that same channel's own Micromarket = 'Bangalore' row (from ROWS) —
        // read cell-by-cell, not reconstructed from the 9 named-micromarket rows.
        const expected: Record<string, { leads: number; ql: number; totalVisits: number; totalConv: number; spendInr: number }> = {
            'Paid Ads': { leads: 1500, ql: 65, totalVisits: 50, totalConv: 4, spendInr: 621370 },
            '3P': { leads: 407, ql: 126, totalVisits: 50, totalConv: 2, spendInr: 57305 },
            'Offline Branding': { leads: 192, ql: 118, totalVisits: 59, totalConv: 7, spendInr: 1535000 },
            'Referral & WOM': { leads: 82, ql: 50, totalVisits: 30, totalConv: 6, spendInr: 720000 },
            Organic: { leads: 1421, ql: 128, totalVisits: 71, totalConv: 5, spendInr: 0 },
            'Society WA Groups & Management Apps': { leads: 48, ql: 33, totalVisits: 22, totalConv: 2, spendInr: 0 },
            'Cold Outreach': { leads: 1072, ql: 181, totalVisits: 98, totalConv: 10, spendInr: 351700 },
        }
        for (const [channel, want] of Object.entries(expected)) {
            const withChannel = deriveReport(facts, { ...opts, filters: { ...EMPTY_SELLER_FILTERS, channels: [channel] } })
            const row = (metric: string) => withChannel.targetVsAchieved.find((r) => r.metric === metric)!.qTargetFull
            expect(row('Total Leads')).toBe(want.leads)
            expect(row('Total Qualified Seller Leads')).toBe(want.ql)
            expect(row('Unique Seller Total Visits')).toBe(want.totalVisits)
            expect(row('Total Property Conversions')).toBe(want.totalConv)
            expect(row('Spend')).toBe(want.spendInr)
        }
    })

    it('reads the same unfiltered target whether the Cluster/MM filter is empty or every micromarket is explicitly ticked', () => {
        // "How is the 4723 when every cluster is deselected and 2411 when all clusters and
        // unmapped are selected. should be the same" — ticking every checkbox in the picker
        // must read identically to ticking none of them; it previously fell through to summing
        // the 9 named-micromarket cells (2,411) instead of the shortcut (4,723), because nothing
        // detected that the "narrowed" selection actually covered the whole grid.
        const noFilter = deriveReport(facts, opts)
        const everyMicromarketTicked = deriveReport(facts, {
            ...opts,
            filters: { ...EMPTY_SELLER_FILTERS, micromarkets: [...SELLER_MICROMARKETS, 'Unmapped'] },
        })
        const leadsTarget = (r: typeof noFilter) => r.targetVsAchieved.find((row) => row.metric === 'Total Leads')!.qTargetFull
        expect(leadsTarget(everyMicromarketTicked)).toBe(leadsTarget(noFilter))
        expect(leadsTarget(noFilter)).toBe(4723)

        // Same invariant for a whole-Channel pick — "all clusters" ticked alongside a Channel
        // must read the same as that Channel alone (1,500 for Paid Ads: its own "All clusters"
        // row plus its own Bangalore row, not the 9-cell sum).
        const channelOnly = deriveReport(facts, { ...opts, filters: { ...EMPTY_SELLER_FILTERS, channels: ['Paid Ads'] } })
        const channelWithEveryMicromarket = deriveReport(facts, {
            ...opts,
            filters: { ...EMPTY_SELLER_FILTERS, channels: ['Paid Ads'], micromarkets: [...SELLER_MICROMARKETS] },
        })
        expect(leadsTarget(channelWithEveryMicromarket)).toBe(leadsTarget(channelOnly))
        expect(leadsTarget(channelOnly)).toBe(1500)
    })

    it('shows only the selected micromarkets, in canonical order, when the Cluster/MM filter narrows the selection', () => {
        const filtered = deriveReport(facts, {
            ...opts,
            filters: { ...EMPTY_SELLER_FILTERS, micromarkets: ['Vegas', 'Powai'] },
        })
        expect(filtered.qualifiedLeadsByMicromarketQuarter.map((p) => p.micromarket)).toEqual(['Powai', 'Vegas'])
        expect(filtered.qualifiedVisitsByMicromarketQuarter.map((p) => p.micromarket)).toEqual(['Powai', 'Vegas'])
    })

    function bucketTotals(points: { counts: Partial<Record<string, number>> }[]): number[] {
        return points.map((p) => Object.values(p.counts).reduce((s: number, n) => s + (n ?? 0), 0))
    }

    it('buckets Qualified Seller Leads by micromarket to the same per-week totals as by channel', () => {
        expect(bucketTotals(report.qualifiedLeadsByMicromarket)).toEqual(bucketTotals(report.qualifiedLeadsByChannel))
    })

    it('buckets WoW Seller Visits by micromarket to the same per-week totals as by channel', () => {
        expect(bucketTotals(report.sellerVisitsByMicromarket)).toEqual(bucketTotals(report.sellerVisitsByChannel))
    })
})

describe('mapSellerChannel — 3P sources', () => {
    // NoBroker already folds into 3P (folds opposite of the buyer side, which excludes it
    // entirely — see the doc comment on SELLER_CHANNEL_MAP). Verified live 2026-09-09 against
    // /api/seller: 3P totalled exactly 99 Acres + Magicbricks + Housing.com + NoBroker + MyGate,
    // so this was already correct — kept here as a regression lock, not a fix.
    it('folds NoBroker into 3P, case-insensitively', () => {
        expect(mapSellerChannel('NoBroker')).toBe('3P')
        expect(mapSellerChannel('nobroker')).toBe('3P')
    })

    // Square Yards has no live rows yet (checked 2026-09-09), so the exact Seller_Source
    // spelling Zoho will actually write is unconfirmed. Both a no-space and a spaced key are
    // carried — same defensive pattern as '99 acres'/'99acres' above — so whichever spelling
    // shows up doesn't silently fall through to Unmapped.
    it('folds Square Yards into 3P under both a spaced and unspaced spelling', () => {
        expect(mapSellerChannel('SquareYards')).toBe('3P')
        expect(mapSellerChannel('Square Yards')).toBe('3P')
    })
})
