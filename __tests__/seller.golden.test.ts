import { deriveReport } from '@/lib/seller/derive'
import { EMPTY_SELLER_FILTERS, type SellerFilters } from '@/lib/seller/filters'
import { foldSellerStatus, isSellerQualified, mapSellerChannel } from '@/lib/seller/shared'
import type { SellerFact, SellerFacts, SellerProductFact, SellerSpendFact } from '@/lib/seller/facts'
import { EMPTY_SELLER_SPEND_INGEST } from '@/lib/seller/spend/parse'
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
    // New cohort, "Already sold the flat" — a lead, but NOT a QL. Proves the 2026-09-07
    // Notion update dropped this status from the qualified set (it used to count).
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
    { sellerId: 'S1', acqStatus: 'Valuation Completed', visitDate: '2026-07-15', mouSigningDate: null, createdAt: '2026-07-10T09:00:00+05:30' },
    // S1: MoU Signed → a new conversion, and a Case-3 qualifying property too.
    { sellerId: 'S1', acqStatus: 'MoU Signed', visitDate: '2026-07-15', mouSigningDate: '2026-08-05', createdAt: '2026-07-10T09:00:00+05:30' },
    // S1: Junk (Case 1, never a qualifying visit) — but S1 IS Qualified, so this counts toward
    // Qualified Properties (any status) even though it never counts toward Qualified Property
    // Visits. Proves the two float boxes are genuinely different numbers.
    { sellerId: 'S1', acqStatus: 'Junk', visitDate: null, mouSigningDate: null, createdAt: '2026-07-10T09:00:00+05:30' },
    // S2: Case 3, would qualify on status alone, but S2 is Not qualified → excluded from both
    // Qualified Properties and Qualified Property Visits by the Call_Status gate.
    { sellerId: 'S2', acqStatus: 'Deal Lost', visitDate: '2026-07-13', mouSigningDate: null, createdAt: '2026-07-12T09:00:00+05:30' },
    // S3: Case 2 (Internally Rejected et al.) WITH a Visit_Date → counts. Dated 3 Aug, a
    // DIFFERENT week than S3's own creation (20 Jul) — proves Property Visits by Source
    // attributes on the property's own Visit_Date, not the seller's week.
    { sellerId: 'S3', acqStatus: 'Pitched to Seller', visitDate: '2026-08-03', mouSigningDate: null, createdAt: '2026-07-20T09:00:00+05:30' },
    // S3: second qualifying property, Case 3 with no Visit_Date → still counts (no date needed
    // for Case 3), falling back to the seller's own creation date (20 Jul) for attribution.
    // Same seller, so this does not add a second unique-seller visit.
    { sellerId: 'S3', acqStatus: 'Negotiations', visitDate: null, mouSigningDate: null, createdAt: '2026-07-20T09:00:00+05:30' },
    // S4 (old cohort, created before the quarter): MoU Signed (Case 3) → an old visit + old
    // conversion. S4 defaults to Qualified, but it's outside this window's Qualified Leads
    // population (not in `windowSellers`), so it never counts toward Qualified Properties.
    { sellerId: 'S4', acqStatus: 'MoU Signed', visitDate: '2026-08-01', mouSigningDate: '2026-08-01', createdAt: '2026-06-01T09:00:00+05:30' },
    // S6: Case 2 with NO Visit_Date → does not count as a qualifying visit (no fallback), but
    // DOES count toward Qualified Properties (any status), since S6 is Qualified. Created the
    // same week as S6 itself (14 Jul).
    { sellerId: 'S6', acqStatus: 'Internally Rejected', visitDate: null, mouSigningDate: null, createdAt: '2026-07-14T09:00:00+05:30' },
    // S2: scheduled but not yet visited — would be a New-cohort pipeline property on status
    // alone, but S2 is Not qualified → excluded by the same gate as qualifying properties.
    { sellerId: 'S2', acqStatus: 'Visit Scheduled', visitDate: null, mouSigningDate: null, createdAt: '2026-07-12T09:00:00+05:30' },
    // S6: Qualified, so this pipeline property counts toward both pipelineCount and Qualified
    // Properties. Same week as S6 itself (14 Jul) — together with the property above, this
    // gives S6 TWO properties in the same week/source, proving Qualified Properties by
    // Source's drill-down lists one entry per property (not deduped to the seller).
    { sellerId: 'S6', acqStatus: 'Visit to be Scheduled', visitDate: null, mouSigningDate: null, createdAt: '2026-07-14T09:00:00+05:30' },
    // S6: a THIRD property, created a different week (21 Jul) than S6 itself (14 Jul) — proves
    // Qualified Properties by Source attributes on the property's own Created_Time, not the
    // seller's: S6 shows up in two different weeks on this chart.
    { sellerId: 'S6', acqStatus: 'Junk', visitDate: null, mouSigningDate: null, createdAt: '2026-07-21T09:00:00+05:30' },
    // S8 (old cohort): Case 3, no Visit_Date. Old-cohort rule has no "always counts" fallback,
    // so this must NOT count as an Old qualifying visit — even though the identical status
    // would count unconditionally for a New-cohort seller (see S1's Valuation Completed).
    { sellerId: 'S8', acqStatus: 'Deal Lost', visitDate: null, mouSigningDate: null, createdAt: '2026-06-01T09:00:00+05:30' },
    // S9 (old cohort): Case 2, Visit_Date present but BEFORE the window (2026-05-01, window
    // starts 2026-07-05). Must NOT count — Old needs the date falling IN the current quarter,
    // not merely present.
    { sellerId: 'S9', acqStatus: 'Recycled', visitDate: '2026-05-01', mouSigningDate: null, createdAt: '2026-06-01T09:00:00+05:30' },
    // S10 (old cohort): MoU Signed, but Seller_MoU_Signing_Date (2026-04-01) is before the
    // window (starts 2026-07-05) — must NOT count as a conversion. No Visit_Date, so it's
    // already excluded from Old visits by the Case-3-no-date rule (S8's scenario), isolating
    // this test to the conversion-specific date gate.
    { sellerId: 'S10', acqStatus: 'MoU Signed', visitDate: null, mouSigningDate: '2026-04-01', createdAt: '2026-06-01T09:00:00+05:30' },
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

    it('counts population sellers only, deduped by phone', () => {
        expect(row('Total Leads').qAchieved).toBe(7) // S1, S2, S3, S5, S6, S11, S12 — S4 is old cohort, out of population
        // S1 (Qualified), S3 (Explore Later), S6 (Qualified), S12 (Prospect) — S11 (Already
        // sold the flat) is NOT qualified since the 2026-09-07 update dropped that status.
        expect(row('Total Qualified Seller Leads').qAchieved).toBe(4)
    })

    it('reflects the 2026-09-07 qualified-set change: Prospect in, Already sold the flat out', () => {
        // Verified directly against the Notion doc: Qualified Seller Leads used to be
        // Qualified/Explore Later/Already sold the flat, now Qualified/Explore Later/Prospect.
        expect(report.sellersById['S11']).toBeDefined() // Already sold the flat — still a lead
        expect(report.sellersById['S12']).toBeDefined() // Prospect — still a lead
        // Both are New-cohort population sellers, so if QL counted 5 instead of 4, S11 (the
        // dropped status) would be the extra one — this pins down which status moved, not
        // just the aggregate count.
        const qlIds = new Set(
            report.leadsByStatus.flatMap((p) => Object.entries(p.leadIds)).flatMap(([status, ids]) =>
                status === 'Already sold the flat' || status === 'Prospect' ? ids : []
            )
        )
        expect(qlIds.has('S11')).toBe(true) // present as a lead...
        expect(qlIds.has('S12')).toBe(true)
        expect(report.overallFunnel.qualified.actual).toBe(4) // ...but only S12 counts toward QL
    })

    it('counts Seller Visits as UNIQUE SELLERS with >=1 qualifying property, scoped to New when the visit scope pill is New-only', () => {
        // Deliberate departure from the skill's per-property definition (see the doc comment
        // on Actuals.visits in derive.ts) — S1 and S3 each have >=1 qualifying property, so
        // Seller Visits is 2. S2's qualifying-looking property is gated out (not a Qualified
        // seller); S6's only property is Case 2 with no date, so it never qualifies in the
        // first place. S4's product is old cohort, excluded when the scope is New-only (this
        // suite's pinned `opts` — see its comment; the app's real default is New+Old, see the
        // 'defaults visitScope/conversionScope to New+Old' test below).
        // The Overall Funnel's own single number stays scoped to the visitScope filter. The
        // Target vs Achieved table's own "Unique Seller Total Visits" row is a DIFFERENT,
        // unconditional New+Old total (see the later "shows ... unconditionally" test), so this
        // assertion targets the funnel, not the table.
        expect(report.overallFunnel.uniqueSellerVisits.actual).toBe(2)
    })

    it('defaults visitScope/conversionScope to New+Old — changed 2026-09-09, per an explicit growth-team request', () => {
        // EMPTY_SELLER_FILTERS is the app's real default (SellerTab's initial React state) — this
        // suite's own `opts` pins it to New-only instead (see the comment on `opts` above), so
        // this test exercises EMPTY_SELLER_FILTERS directly rather than `opts.filters`.
        expect(EMPTY_SELLER_FILTERS.visitScope).toEqual(['New', 'Old'])
        expect(EMPTY_SELLER_FILTERS.conversionScope).toEqual(['New', 'Old'])
        const both = deriveReport(facts, { ...opts, filters: EMPTY_SELLER_FILTERS })
        // S1+S3 (New) + S4 (Old) = 3 unique seller visits, and S1 (New) + S4 (Old) = 2
        // conversions, once both cohorts are in scope — matching the Target vs Achieved table's
        // own unconditional readings for the same two metrics (see the "shows ... unconditionally"
        // test), which is exactly the point: New+Old scoped now equals the unconditional total.
        expect(both.overallFunnel.uniqueSellerVisits.actual).toBe(3)
        expect(both.overallFunnel.conversions.actual).toBe(2)
    })

    it('applies the three-case rule and the Qualified-seller gate to qualifying properties and pipeline', () => {
        // S1: 2 Case-3 properties (Junk doesn't count here). S3: 1 Case-2-with-date +
        // 1 Case-3-no-date, both count. S2's Case-3 property is excluded by the gate (Not
        // qualified). S6's Case-2-no-date property never qualifies regardless of the gate.
        // Total: 2 + 2 = 4.
        expect(report.overallFunnel.qualifyingProperties).toBe(4)
        expect(report.overallFunnel.uniqueSellerVisits.actual).toBe(2)
        // S2's pipeline property is gated out (Not qualified); S6's counts (Qualified).
        expect(report.overallFunnel.pipelineCount).toBe(1)
    })

    it('counts EVERY property of a Qualified seller for Qualified Properties, any Acq_Status', () => {
        // S1 (Qualified): 3 properties, including the Junk one. S3 (Explore Later, qualified):
        // 2 properties. S6 (Qualified): 3 properties, including the never-qualifying Internally
        // Rejected one and a second Junk one. S2 (Not qualified) and S4 (outside this window's
        // population) contribute nothing, even though S4 is itself Qualified. S12 (Prospect,
        // qualified) has no properties at all, so it contributes zero too. Total: 3 + 2 + 3 = 8.
        expect(report.overallFunnel.qualifiedSellerProperties).toBe(8)
    })

    it('counts New-cohort MoU conversions by default', () => {
        expect(row('New Conversions').qAchieved).toBe(1) // S1; S4 is old cohort
    })

    it('computes the three rates as percentages', () => {
        expect(report.ltqlPct).toBe(57.1) // QL 4 / Leads 7
        // Unique Seller Visits (2) and QL (4) are not a subset relationship by construction —
        // a seller can have a qualifying property without ever being marked Qualified elsewhere
        // in a real quarter — so this can land anywhere, including above 100%.
        expect(report.qltvPct).toBe(50) // Unique Seller Visits 2 / QL 4
        expect(report.convRatePct).toBe(50) // Conversions 1 / Unique Seller Visits 2
    })

    it('computes rate targets from ratios of the target grid\'s own values', () => {
        expect(report.overallFunnel.ltqlTarget).toBeGreaterThan(0)
        expect(report.overallFunnel.qltvTarget).toBeGreaterThan(0)
        expect(report.overallFunnel.convRateTarget).toBeGreaterThan(0)
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

    it('attributes Property Visits by Channel to the qualifying property\'s own Visit_Date, not the seller\'s week', () => {
        // S3 has two qualifying properties: 'Negotiations' (no date, falls back to S3's own
        // 20 Jul creation week) and 'Pitched to Seller' (dated 3 Aug). It should therefore
        // appear in TWO different weeks here — one matching its own creation week, one not.
        const s3LeadsWeek = report.leadsByChannel.find((p) => (p.leadIds['Cold Outreach'] ?? []).includes('S3'))!.weekStart
        const s3VisitWeeks = report.propertyVisitsByChannel
            .filter((p) => (p.leadIds['Cold Outreach'] ?? []).includes('S3'))
            .map((p) => p.weekStart)
        expect(s3VisitWeeks).toContain(s3LeadsWeek) // the no-date Negotiations fallback
        expect(s3VisitWeeks.some((w) => w !== s3LeadsWeek)).toBe(true) // the dated Pitched to Seller
    })

    it('dedupes Seller Visits by Channel per seller per bucket; Property Visits by Channel does not', () => {
        // S1's two qualifying properties (Valuation Completed, MoU Signed) share a Visit_Date,
        // so both land in the same week/channel.
        const propertyBucket = report.propertyVisitsByChannel.find((p) => (p.leadIds['Paid Ads'] ?? []).includes('S1'))!
        const sellerBucket = report.sellerVisitsByChannel.find((p) => (p.leadIds['Paid Ads'] ?? []).includes('S1'))!
        expect(propertyBucket.leadIds['Paid Ads']!.filter((id) => id === 'S1').length).toBe(2) // one per property
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
        expect(row('Total Conversions').qAchieved).toBe(2) // New (S1) + Old (S4)
    })

    it('computes QLTV % on New visits only, even when the visit scope filter is set to Old', () => {
        const oldScope = deriveReport(facts, {
            ...opts,
            filters: { ...EMPTY_SELLER_FILTERS, visitScope: ['Old'], conversionScope: ['Old'] },
        })
        // QLTV % must still read New visits (2) over QL (4) = 50%, regardless of the Old-only
        // scope filter selected for the Overall Funnel's own single number.
        expect(oldScope.targetVsAchieved.find((r) => r.metric === 'QLTV %')!.qAchieved).toBe(50)
    })

    it('has no target for the three Property Visits rows or Visits in Pipeline (no grid column)', () => {
        expect(row('Total Property Visits').qTarget).toBeNull()
        expect(row('New Property Visits').qTarget).toBeNull()
        expect(row('Old Property Visits').qTarget).toBeNull()
        expect(row('Visits in Pipeline').qTarget).toBeNull()
        // But the actuals ARE real, sourced from the existing per-property qualifying count.
        // New (S1 x2, S3 x2) + Old (S4's in-window MoU Signed, Case 3) = 4 + 1 = 5 — the
        // Overall Funnel's own `qualifyingProperties` is 4 because it's scoped to New only by
        // default; this row is unconditional (New+Old), so it picks up S4 too.
        expect(row('Total Property Visits').qAchieved).toBe(5)
        expect(row('New Property Visits').qAchieved).toBe(4)
        expect(row('Old Property Visits').qAchieved).toBe(1)
        expect(row('Visits in Pipeline').qAchieved).toBe(1)
    })

    it('scopes visits/conversions to Old when the scope flips', () => {
        const old = deriveReport(facts, {
            ...opts,
            filters: { ...EMPTY_SELLER_FILTERS, visitScope: ['Old'], conversionScope: ['Old'] },
        })
        // S4 only, both counts — coincidentally 1 either way here since S4 has exactly one
        // qualifying property, but Seller Visits is the unique-seller count now, not the count
        // of properties.
        expect(old.overallFunnel.uniqueSellerVisits.actual).toBe(1)
        expect(old.overallFunnel.conversions.actual).toBe(1)
    })

    it('gives Old-cohort Case 3 no "always counts" exception, unlike New', () => {
        // Without the cohort-aware fix, S8's date-less Deal Lost (Case 3) would have counted
        // unconditionally, and S9's out-of-window Recycled (Case 2) would have counted on
        // "any date present". Both must contribute zero Old visits — only S4 counts (asserted
        // above), so this stays at 1 rather than rising to 3.
        const old = deriveReport(facts, {
            ...opts,
            filters: { ...EMPTY_SELLER_FILTERS, visitScope: ['Old'], conversionScope: ['Old'] },
        })
        expect(old.overallFunnel.qualifyingProperties).toBe(1)
        expect(old.overallFunnel.uniqueSellerVisits.actual).toBe(1)
    })

    it('requires Seller_MoU_Signing_Date to fall in the current quarter for a conversion', () => {
        // S10's MoU Signed status alone would have qualified under the pre-2026-09-07 rule,
        // but its signing date is from a prior quarter, so it must NOT count. Only S4 (signed
        // 2026-08-01, in-window) counts as an Old conversion — still 1, not 2.
        const old = deriveReport(facts, {
            ...opts,
            filters: { ...EMPTY_SELLER_FILTERS, visitScope: ['Old'], conversionScope: ['Old'] },
        })
        expect(old.overallFunnel.conversions.actual).toBe(1)
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

    it('nests a second cluster correctly, and falls back to "Unknown" for a seller with no micromarket', () => {
        const glamSeller = seller({ id: 'SP1', createdAt: ISO(7, 20), rawSource: 'Meta', micromarkets: ['Amsterdam'] })
        const unknownSeller = seller({ id: 'SP2', createdAt: ISO(7, 20), rawSource: 'Meta', micromarkets: [] })
        const glamProduct: SellerProductFact = {
            sellerId: 'SP1',
            acqStatus: 'Visit Scheduled',
            visitDate: null,
            mouSigningDate: null,
            createdAt: '2026-07-20T09:00:00+05:30',
        }
        const unknownProduct: SellerProductFact = {
            sellerId: 'SP2',
            acqStatus: 'Visit to be Scheduled',
            visitDate: null,
            mouSigningDate: null,
            createdAt: '2026-07-20T09:00:00+05:30',
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
        expect(byCluster.get('Unknown')?.leadIds.Unknown).toContain('SP2')
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

    it('gives every grid-covered micromarket a target', () => {
        // The HABIBI micromarkets have no row of their own in the target sheet — only a
        // combined 'Bangalore' one for the whole cluster — so a lookup for any of them
        // individually is honestly uncovered (null), not a fabricated split. Every other
        // in-scope micromarket does get a real target.
        //
        // Ibiza joined HABIBI on 2026-09-16 and is uncovered for the same reason, plus a
        // second one: the growth team has not set targets for it yet. When they do, it gets a
        // grid row and comes out of this set.
        const uncovered = new Set(['Helsinki', 'Berlin', 'Hong Kong', 'Ibiza'])
        for (const p of report.qualifiedLeadsByMicromarketQuarter) {
            if (uncovered.has(p.micromarket)) expect(p.target).toBeNull()
            else expect(p.target).not.toBeNull()
        }
        for (const p of report.qualifiedVisitsByMicromarketQuarter) {
            if (uncovered.has(p.micromarket)) expect(p.target).toBeNull()
            else expect(p.target).not.toBeNull()
        }
    })

    it('gives Powai the exact absolute quarter target from the grid (123 Qualified Leads), not a pro-rated share', () => {
        const powaiLeads = report.qualifiedLeadsByMicromarketQuarter.find((p) => p.micromarket === 'Powai')!
        expect(powaiLeads.target).toBe(123)
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
        expect(oneMonthTarget).toBe(123)
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
