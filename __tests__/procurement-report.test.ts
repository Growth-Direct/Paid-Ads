import { GrowthUnavailableError, fetchSocietyProgress } from '@/lib/procurement/growth'
import { tallyPriorities } from '@/lib/procurement/priority'
import { UNASSIGNED_PRIORITY, buildProcurementReport, rollUpByPriority } from '@/lib/procurement/report'
import type { SocietyWithPriority } from '@/lib/procurement/types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The integration with growth, pinned. The split matters: growth owns the numbers and this side
// owns priority, so the rules under test are about not letting one contaminate the other — an
// Airtable outage must not move a percentage, and a priority filter must not leave a stale summary
// above a filtered table.

const VARS = [
    'GROWTH_LEDGER_BASE_URL',
    'GROWTH_LEDGER_API_KEY',
    'AIRTABLE_API_KEY',
    'AIRTABLE_BASE_ID',
] as const

function society(overrides: Partial<SocietyWithPriority> = {}) {
    return {
        societyId: 'soc-amara',
        societyName: 'Lodha Amara',
        federationName: 'Amara Federation',
        townshipName: 'Kolshet',
        truvaMicroMarketName: 'Thane West',
        truvaQualified: 'YES',
        totalUnits: 100,
        unitsProcured: 50,
        procurementPct: 50,
        ...overrides,
    }
}

function growthResponse(societies = [society()]) {
    return {
        asOf: '2026-09-23T10:15:00+05:30',
        warnings: [] as string[],
        summary: {
            totalSocieties: societies.length,
            totalUnits: societies.reduce((s, x) => s + x.totalUnits, 0),
            unitsProcured: societies.reduce((s, x) => s + x.unitsProcured, 0),
            procurementPct: 50,
            societiesAt100Pct: 0,
        },
        dataQuality: {
            unmatchedSocietyNames: [],
            unmatchedProcuredRecords: 6,
            recoveredFromClutteredNames: 0,
            recordsWithoutSociety: 380,
            ambiguousSocietyNames: [],
            towerCoverage: { withTower: 21331, total: 57759, pct: 36.93 },
        },
        federationSummary: {
            totalSocieties: 533,
            totalUnits: 54358,
            unitsProcured: 23942,
            procurementPct: 44.05,
            societiesAt100Pct: 20,
        },
        matchCoverage: {
            procuredPool: 57379,
            society: { matched: 18405, pct: 32.08, viaId: 17540, viaName: 865 },
            federation: { matched: 23942, pct: 41.73, viaId: 17553, viaName: 6389 },
            idsWrittenInMirror: { society: 20000, federation: 20000 },
        },
        federations: [
            {
                federationId: 'fed-1',
                federationName: 'Amara Federation',
                townshipName: 'Kolshet',
                truvaMicroMarketName: 'Thane West',
                societies: 3,
                totalUnits: 300,
                unitsInQualifyingSocieties: 300,
                truvaQualifiedStandings: ['YES'],
                truvaQualifiedMixed: false,
                unitsProcured: 100,
                procurementPct: 33.33,
                matchedBy: 'truiq_id' as const,
            },
        ],
        societies,
    }
}

function respondWith(payload: unknown, ok = true, status = 200) {
    return vi.fn(async () => ({ ok, status, json: async () => payload })) as unknown as typeof fetch
}

beforeEach(() => {
    process.env.GROWTH_LEDGER_BASE_URL = 'https://growth.example'
    process.env.GROWTH_LEDGER_API_KEY = 'ledger_key'
})

afterEach(() => {
    for (const v of VARS) delete process.env[v]
    vi.unstubAllGlobals()
})

describe('fetchSocietyProgress', () => {
    it('calls the procurement route with the ledger key', async () => {
        const fetchMock = respondWith(growthResponse())
        vi.stubGlobal('fetch', fetchMock)

        await fetchSocietyProgress()

        const [url, init] = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!
        expect(url).toBe('https://growth.example/api/procurement/society-progress')
        expect((init as RequestInit).headers).toMatchObject({ 'x-api-key': 'ledger_key' })
    })

    it('passes every query option through', async () => {
        const fetchMock = respondWith(growthResponse())
        vi.stubGlobal('fetch', fetchMock)

        await fetchSocietyProgress({
            truvaQualified: ['YES', 'CHECK_PENDING'],
            includeTowers: true,
            federation: 'North',
            search: 'lodha',
        })

        const [url] = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!
        expect(url).toContain('truvaQualified=YES%2CCHECK_PENDING')
        expect(url).toContain('includeTowers=true')
        expect(url).toContain('federation=North')
        expect(url).toContain('search=lodha')
    })

    it('sends no query string when nothing was asked for', async () => {
        const fetchMock = respondWith(growthResponse())
        vi.stubGlobal('fetch', fetchMock)

        await fetchSocietyProgress()

        const [url] = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!
        expect(url).not.toContain('?')
    })

    it('fails clearly when growth is not configured', async () => {
        delete process.env.GROWTH_LEDGER_API_KEY
        await expect(fetchSocietyProgress()).rejects.toThrow(GrowthUnavailableError)
    })

    // growth answers a bad x-api-key with 403, not 401 — a different middleware branch. Naming the
    // variable in the message saves the next person checking the wrong secret.
    it('names the variable to check on a 403', async () => {
        vi.stubGlobal('fetch', respondWith({}, false, 403))
        await expect(fetchSocietyProgress()).rejects.toThrow(/GROWTH_LEDGER_API_KEY/)
    })

    // growth answers a bad key with 403, so sending the wrong header is not a silent failure —
    // but it is a confusing one, and the ledger key is the only key there is.
    it('sends the ledger key as x-api-key', async () => {
        const fetchMock = respondWith(growthResponse())
        vi.stubGlobal('fetch', fetchMock)

        await fetchSocietyProgress()

        const [, init] = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!
        expect((init as RequestInit).headers).toMatchObject({ 'x-api-key': 'ledger_key' })
    })

    it('reuses the ledger base URL, which is the same service', async () => {
        process.env.GROWTH_LEDGER_BASE_URL = 'https://ledger.example'
        const fetchMock = respondWith(growthResponse())
        vi.stubGlobal('fetch', fetchMock)

        await fetchSocietyProgress()

        const [url] = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!
        expect(url).toContain('https://ledger.example/')
    })

    // The types here are a restatement of growth's, not a shared package, so a contract change
    // arrives as undefined rather than a type error. Better to name it than to render an empty page.
    it.each([
        [{ summary: {}, dataQuality: {}, matchCoverage: {} }, /societies/],
        [{ societies: [], dataQuality: {}, matchCoverage: {} }, /summary/],
        [{ societies: [], summary: { totalUnits: 0 }, matchCoverage: {} }, /dataQuality/],
        [{ societies: [], summary: { totalUnits: 0 }, dataQuality: {} }, /matchCoverage/],
        [null, /non-object/],
    ])('rejects a response missing what the dashboard reads', async (body, message) => {
        vi.stubGlobal('fetch', respondWith(body))
        await expect(fetchSocietyProgress()).rejects.toThrow(message)
    })

    it('reports a transport failure rather than letting it escape raw', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => {
                throw new Error('ECONNREFUSED')
            })
        )
        await expect(fetchSocietyProgress()).rejects.toThrow(/ECONNREFUSED/)
    })
})

describe('tallyPriorities', () => {
    it('takes the one priority a society’s units agree on', () => {
        const result = tallyPriorities([
            { fields: { Society: 'Lodha Amara', Priority: 'P0' } },
            { fields: { Society: 'Lodha Amara', Priority: 'P0' } },
        ])
        expect(result.get('lodha amara')).toEqual({ priority: 'P0', priorityInconsistent: false })
    })

    // Per §2.2: take the most frequent and flag it, rather than failing silently or trusting row order.
    it('takes the most frequent value and flags the disagreement', () => {
        const result = tallyPriorities([
            { fields: { Society: 'Lodha Amara', Priority: 'P1' } },
            { fields: { Society: 'Lodha Amara', Priority: 'P0' } },
            { fields: { Society: 'Lodha Amara', Priority: 'P0' } },
        ])
        expect(result.get('lodha amara')).toEqual({ priority: 'P0', priorityInconsistent: true })
    })

    it('breaks a tie the same way every time, not by row order', () => {
        const forwards = tallyPriorities([
            { fields: { Society: 'A', Priority: 'P1' } },
            { fields: { Society: 'A', Priority: 'P0' } },
        ])
        const backwards = tallyPriorities([
            { fields: { Society: 'A', Priority: 'P0' } },
            { fields: { Society: 'A', Priority: 'P1' } },
        ])
        expect(forwards.get('a')).toEqual(backwards.get('a'))
        expect(forwards.get('a')!.priority).toBe('P0')
    })

    it('normalises the society key so spacing and casing do not matter', () => {
        const result = tallyPriorities([{ fields: { Society: '  LODHA   Amara ', Priority: 'P0' } }])
        expect(result.get('lodha amara')?.priority).toBe('P0')
    })

    it('reads a linked-record field, which Airtable returns as an array', () => {
        const result = tallyPriorities([{ fields: { Society: ['Lodha Amara'], Priority: ['P2'] } }])
        expect(result.get('lodha amara')?.priority).toBe('P2')
    })

    it('skips rows missing either field rather than inventing a band', () => {
        const result = tallyPriorities([
            { fields: { Society: 'Lodha Amara' } },
            { fields: { Priority: 'P0' } },
            { fields: { Society: 'Lodha Amara', Priority: '   ' } },
            { fields: {} },
        ])
        expect(result.size).toBe(0)
    })
})

describe('rollUpByPriority', () => {
    it('totals each band and counts the complete societies in it', () => {
        const bands = rollUpByPriority([
            society({ priority: 'P0', totalUnits: 100, unitsProcured: 100, procurementPct: 100 }),
            society({ priority: 'P0', totalUnits: 100, unitsProcured: 50, procurementPct: 50 }),
            society({ priority: 'P1', totalUnits: 200, unitsProcured: 50, procurementPct: 25 }),
        ] as SocietyWithPriority[])

        expect(bands).toEqual([
            {
                priority: 'P0',
                societiesTotal: 2,
                societiesAt100Pct: 1,
                totalUnits: 200,
                unitsProcured: 150,
                procurementPct: 75,
            },
            {
                priority: 'P1',
                societiesTotal: 1,
                societiesAt100Pct: 0,
                totalUnits: 200,
                unitsProcured: 50,
                procurementPct: 25,
            },
        ])
    })

    it('puts societies Airtable does not know about in their own band, last', () => {
        const bands = rollUpByPriority([
            society({ priority: null }),
            society({ priority: 'P0' }),
        ] as SocietyWithPriority[])
        expect(bands.map((b) => b.priority)).toEqual(['P0', UNASSIGNED_PRIORITY])
    })

    // Unmeasurable is not complete. A P0 band reporting itself done because nobody mapped its
    // units is the exact failure this whole feature is trying not to produce.
    it('does not count an unmeasurable society as complete', () => {
        const bands = rollUpByPriority([
            society({ priority: 'P0', totalUnits: 0, unitsProcured: 3, procurementPct: null }),
        ] as SocietyWithPriority[])
        expect(bands[0]).toMatchObject({ societiesAt100Pct: 0, procurementPct: null })
    })

    it('counts a society over 100% as complete', () => {
        const bands = rollUpByPriority([
            society({ priority: 'P0', totalUnits: 10, unitsProcured: 13, procurementPct: 130 }),
        ] as SocietyWithPriority[])
        expect(bands[0]!.societiesAt100Pct).toBe(1)
    })
})

describe('buildProcurementReport', () => {
    it('attaches priority to growth’s societies without touching the numbers', async () => {
        process.env.AIRTABLE_API_KEY = 'pat'
        process.env.AIRTABLE_BASE_ID = 'app1'
        vi.stubGlobal(
            'fetch',
            vi.fn(async (url: string) =>
                url.includes('airtable.com')
                    ? { ok: true, status: 200, json: async () => ({ records: [{ fields: { Society: 'Lodha Amara', Priority: 'P0' } }] }) }
                    : { ok: true, status: 200, json: async () => growthResponse() }
            ) as unknown as typeof fetch
        )

        const report = await buildProcurementReport()

        expect(report.societies[0]).toMatchObject({
            societyName: 'Lodha Amara',
            priority: 'P0',
            unitsProcured: 50,
            procurementPct: 50,
        })
        expect(report.byPriority[0]!.priority).toBe('P0')
    })

    // The core asymmetry: Airtable is allowed to fail, and when it does the numbers are unchanged.
    it('still serves every society, with a warning, when Airtable is unreachable', async () => {
        process.env.AIRTABLE_API_KEY = 'pat'
        process.env.AIRTABLE_BASE_ID = 'app1'
        vi.stubGlobal(
            'fetch',
            vi.fn(async (url: string) =>
                url.includes('airtable.com')
                    ? { ok: false, status: 500, json: async () => ({}) }
                    : { ok: true, status: 200, json: async () => growthResponse() }
            ) as unknown as typeof fetch
        )

        const report = await buildProcurementReport()

        expect(report.warnings).toContain('airtable_unavailable')
        expect(report.societies).toHaveLength(1)
        expect(report.societies[0]).toMatchObject({ priority: null, procurementPct: 50 })
        expect(report.summary.unitsProcured).toBe(50)
    })

    it('says so when Airtable is simply not configured', async () => {
        vi.stubGlobal('fetch', respondWith(growthResponse()))
        const report = await buildProcurementReport()
        expect(report.warnings).toContain('airtable_not_configured')
    })

    // The quiet one. Airtable answering with nothing looks identical on the page to Airtable
    // being full of societies nobody has prioritised, so it has to be named.
    // Three ways Airtable can leave every society unassigned. They look identical on the page, so
    // each has to name itself — telling someone "no priorities" when the TABLE is wrong sends them
    // to look at the data instead of the config.
    function withAirtable(records: unknown[]) {
        process.env.AIRTABLE_API_KEY = 'pat_test'
        process.env.AIRTABLE_BASE_ID = 'appTest'
        return vi
            .fn()
            .mockResolvedValueOnce({ ok: true, status: 200, json: async () => growthResponse() })
            .mockResolvedValue({ ok: true, status: 200, json: async () => ({ records }) })
    }

    it('says the table came back empty when it returns no rows', async () => {
        vi.stubGlobal('fetch', withAirtable([]))

        const report = await buildProcurementReport()

        expect(report.warnings).toContain('airtable_empty')
        expect(report.warnings).not.toContain('airtable_not_configured')
        // The numbers still stand — priority is a label, not a term in the ratio.
        expect(report.summary.unitsProcured).toBe(50)
        expect(report.societies[0]).toMatchObject({ priority: null })
    })

    it('blames the columns when rows come back without a Society or Priority value', async () => {
        vi.stubGlobal('fetch', withAirtable([{ fields: { Building: 'Lodha Amara', Tier: 'P0' } }]))

        const report = await buildProcurementReport()

        expect(report.warnings).toContain('airtable_fields_unmatched')
        expect(report.warnings).not.toContain('airtable_empty')
    })

    it('blames the names when the rows are well-formed but match no truiq society', async () => {
        // A federation name where truiq holds the buildings beneath it — the commonest cause.
        vi.stubGlobal('fetch', withAirtable([{ fields: { Society: 'Some Other Development', Priority: 'P0' } }]))

        const report = await buildProcurementReport()

        expect(report.warnings).toContain('airtable_no_society_match')
        expect(report.warnings).not.toContain('airtable_fields_unmatched')
        expect(report.societies[0]).toMatchObject({ priority: null })
    })

    it('keeps growth’s own warnings alongside its own', async () => {
        const body = growthResponse()
        body.warnings = ['tower_data_incomplete']
        vi.stubGlobal('fetch', respondWith(body))

        const report = await buildProcurementReport()

        expect(report.warnings).toContain('tower_data_incomplete')
        expect(report.warnings).toContain('airtable_not_configured')
    })

    it('passes the data-quality block through untouched', async () => {
        vi.stubGlobal('fetch', respondWith(growthResponse()))
        const report = await buildProcurementReport()
        expect(report.dataQuality).toMatchObject({
            unmatchedProcuredRecords: 6,
            recordsWithoutSociety: 380,
            towerCoverage: { withTower: 21331, total: 57759, pct: 36.93 },
        })
    })

    it('filters by priority, which growth cannot do', async () => {
        process.env.AIRTABLE_API_KEY = 'pat'
        process.env.AIRTABLE_BASE_ID = 'app1'
        vi.stubGlobal(
            'fetch',
            vi.fn(async (url: string) =>
                url.includes('airtable.com')
                    ? {
                          ok: true,
                          status: 200,
                          json: async () => ({
                              records: [
                                  { fields: { Society: 'Alpha', Priority: 'P0' } },
                                  { fields: { Society: 'Beta', Priority: 'P1' } },
                              ],
                          }),
                      }
                    : {
                          ok: true,
                          status: 200,
                          json: async () =>
                              growthResponse([
                                  society({ societyId: 'a', societyName: 'Alpha', totalUnits: 100, unitsProcured: 40 }),
                                  society({ societyId: 'b', societyName: 'Beta', totalUnits: 300, unitsProcured: 60 }),
                              ] as never),
                      }
            ) as unknown as typeof fetch
        )

        const report = await buildProcurementReport({ priority: 'p0' })

        expect(report.societies.map((s) => s.societyName)).toEqual(['Alpha'])
        // The summary has to describe the filtered view, or a P0 page shows the whole set's totals.
        expect(report.summary).toMatchObject({ totalSocieties: 1, totalUnits: 100, unitsProcured: 40 })
    })

    it('keeps growth’s summary verbatim when no priority filter was applied', async () => {
        vi.stubGlobal('fetch', respondWith(growthResponse()))
        const report = await buildProcurementReport()
        expect(report.summary).toEqual(growthResponse().summary)
    })

    // growth being down is fatal. An empty report would render as "nothing procured".
    it('propagates a growth outage rather than serving an empty report', async () => {
        vi.stubGlobal('fetch', respondWith({}, false, 503))
        await expect(buildProcurementReport()).rejects.toThrow(GrowthUnavailableError)
    })
})

describe('federation pass-through', () => {
    // growth owns both grains. This side must not recompute or reshape them — it has no unit
    // counts of its own, so anything it derived would be a second, divergent answer.
    it('passes the federation summary and rows through unchanged', async () => {
        vi.stubGlobal('fetch', respondWith(growthResponse()))

        const report = await buildProcurementReport()

        expect(report.federationSummary).toEqual(growthResponse().federationSummary)
        expect(report.federations).toEqual(growthResponse().federations)
    })

    it('passes matchCoverage through unchanged', async () => {
        vi.stubGlobal('fetch', respondWith(growthResponse()))

        const report = await buildProcurementReport()

        expect(report.matchCoverage).toEqual(growthResponse().matchCoverage)
    })

    // A priority filter narrows the society table, but the federation blocks describe growth's
    // whole join. Recomputing them to match the filter would understate a real data gap.
    it('does NOT narrow the federation blocks when a priority filter is applied', async () => {
        process.env.AIRTABLE_API_KEY = 'pat'
        process.env.AIRTABLE_BASE_ID = 'app1'
        vi.stubGlobal(
            'fetch',
            vi.fn(async (url: string) =>
                url.includes('airtable.com')
                    ? { ok: true, status: 200, json: async () => ({ records: [] }) }
                    : { ok: true, status: 200, json: async () => growthResponse() }
            ) as unknown as typeof fetch
        )

        const report = await buildProcurementReport({ priority: 'P0' })

        expect(report.societies).toHaveLength(0)
        expect(report.federationSummary?.unitsProcured).toBe(23942)
        expect(report.matchCoverage.federation.matched).toBe(23942)
    })

    it('omits the federation blocks when growth did not send them', async () => {
        const body = growthResponse()
        delete (body as Record<string, unknown>).federationSummary
        delete (body as Record<string, unknown>).federations
        vi.stubGlobal('fetch', respondWith(body))

        const report = await buildProcurementReport()

        expect(report.federationSummary).toBeUndefined()
        expect(report.federations).toBeUndefined()
        // matchCoverage is required, so it still has to be there.
        expect(report.matchCoverage).toBeTruthy()
    })
})
