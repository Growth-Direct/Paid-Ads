import { assignLeadIdentity, isChannelPartnerSource, phoneKeyOf } from '@/lib/buyer/aggregate'
import type { LeadFact } from '@/lib/buyer/facts'
import { EMPTY_FILTERS, leadMatches } from '@/lib/buyer/filters'
import { EXCLUDED_SOURCES, SOURCE_LABEL, isVirtualMicromarket, mapChannel, sourceLabel, toList } from '@/lib/buyer/shared'
import { CHANNELS, SOURCES_BY_CHANNEL, SOURCE_ORDER } from '@/lib/buyer/types'
import { describe, expect, it } from 'vitest'

// The eligibility rules had no coverage at all — mapChannel, the exclusion list and the
// VCV path were entirely untested while every headline number depends on them. These are
// the four rules added on 2026-09-02, each pinned to the values verified live in Zoho.

describe('excluded sources', () => {
    it('excludes Society Partners — the live value is PLURAL', () => {
        // The singular "Society Partner" does not exist in Zoho. Guessing it would have
        // silently excluded nothing, which is exactly what this test exists to catch.
        expect(mapChannel('Society Partners')).toBeNull()
        expect(EXCLUDED_SOURCES.has('society partners')).toBe(true)
    })

    it('keeps the direct Society sources, which are a different channel', () => {
        for (const source of ['Society WA Groups', 'Society Management App', 'Society Data']) {
            expect(mapChannel(source)).toBe('Society WA Groups & Management Apps')
        }
    })

    it('still excludes the partner sources', () => {
        for (const source of ['Channel Partner', 'Builder', 'Nobroker', 'Society Partners']) {
            expect(mapChannel(source)).toBeNull()
        }
    })

    it('counts Seller Referral as direct demand, in Referral & WOM', () => {
        // Reversed on 2026-09-16 at the growth team's decision: a seller referral is our own
        // demand, not a partner's, so it belongs in the population rather than excluded from
        // it. Grouped with Word of Mouth and Referral because that channel already carries a
        // target. NOTE Metabase still excludes it, so buyer lead counts now run slightly ABOVE
        // Metabase's — see the EXCLUDED_SOURCES comment in shared.ts.
        expect(mapChannel('Seller Referral')).toBe('Referral & WOM')
        expect(mapChannel('seller referral')).toBe('Referral & WOM')
    })

    it('matches case-insensitively and survives a blank', () => {
        expect(mapChannel('  SOCIETY PARTNERS ')).toBeNull()
        expect(mapChannel('')).toBe('Unmapped')
        expect(mapChannel(null)).toBe('Unmapped')
    })
})

describe('isVirtualMicromarket', () => {
    it('matches every virtual micromarket found live', () => {
        for (const mm of ['Airport (Virtual)', 'Mainland (Virtual)', 'Viceport (Virtual)', 'Leaf Links (Virtual)']) {
            expect(isVirtualMicromarket(mm)).toBe(true)
        }
    })

    it('does not match any real micromarket', () => {
        for (const mm of ['Powai', 'Vegas', 'Glasgow', 'Amsterdam', 'Boston', 'Barcelona', 'Bangalore']) {
            expect(isVirtualMicromarket(mm)).toBe(false)
        }
    })

    it('is case-insensitive and null-safe', () => {
        expect(isVirtualMicromarket('Airport (VIRTUAL)')).toBe(true)
        expect(isVirtualMicromarket('')).toBe(false)
        expect(isVirtualMicromarket(null)).toBe(false)
        // "Virtual" without the brackets is a name, not the marker.
        expect(isVirtualMicromarket('Virtual Heights')).toBe(false)
    })
})

describe('isChannelPartnerSource (bid level)', () => {
    it('flags Channel Partner bids and leaves Direct alone', () => {
        expect(isChannelPartnerSource('Channel Partner')).toBe(true)
        expect(isChannelPartnerSource('channel partner')).toBe(true)
        expect(isChannelPartnerSource('Direct')).toBe(false)
    })

    it('keeps the source-less bids rather than dropping them', () => {
        // 17 of 10,933 bids have no source. Blank is not Channel Partner — same null-safe
        // discipline as the VCV cluster rule.
        expect(isChannelPartnerSource(null)).toBe(false)
        expect(isChannelPartnerSource('')).toBe(false)
    })
})

describe('phoneKeyOf', () => {
    it('reduces a number to its last 10 digits', () => {
        expect(phoneKeyOf('9000000001')).toBe('9000000001')
        expect(phoneKeyOf('+91 90000 00001')).toBe('9000000001')
        expect(phoneKeyOf('091-9000000001')).toBe('9000000001')
    })

    it('collapses the same person entered two different ways', () => {
        expect(phoneKeyOf('+919000000001')).toBe(phoneKeyOf('90000 00001'))
    })

    it('falls back through the fields in order and gives up below 10 digits', () => {
        expect(phoneKeyOf(undefined, '9000000001')).toBe('9000000001')
        expect(phoneKeyOf('9000000001', '9000000002')).toBe('9000000001')
        expect(phoneKeyOf('12345')).toBe('')
        expect(phoneKeyOf(null, undefined)).toBe('')
    })
})

let seq = 0
function lead(p: Partial<LeadFact> & { status: string; createdAt: string }): LeadFact {
    seq += 1
    return {
        id: p.id ?? `L${seq}`,
        name: 'x',
        status: p.status,
        statusFolded: p.status,
        rawSource: 'Meta',
        sourceLabel: 'Meta',
        channel: 'Paid Ads',
        createdAt: p.createdAt,
        clusters: ['PAV'],
        clusterPrimary: 'PAV',
        micromarkets: ['Powai'],
        micromarketPrimary: 'Powai',
        notQualifiedReason: null,
        isQualified: false,
        hasWarmBid: false,
        responseAt: null,
        utmChannel: null,
        acefoneLeadId: null,
        phoneKey: p.phoneKey ?? '',
        dedupKey: '',
        isPrimary: false,
        inPopulation: true,
        inPipeline: false,
        attributedSource: '',
        attributedChannel: null,
        attributedMicromarket: null,
        attributedAt: null,
        hasAttribution: false,
    }
}
const primaries = (ls: LeadFact[]) => ls.filter((l) => l.isPrimary).map((l) => l.id)

describe('assignLeadIdentity', () => {
    it('elects exactly one primary per phone group', () => {
        const ls = [
            lead({ id: 'A', status: 'Junk', createdAt: '2026-07-01', phoneKey: '9000000001' }),
            lead({ id: 'B', status: 'Junk', createdAt: '2026-07-02', phoneKey: '9000000001' }),
            lead({ id: 'C', status: 'Junk', createdAt: '2026-07-03', phoneKey: '9000000002' }),
        ]
        assignLeadIdentity(ls)
        expect(primaries(ls)).toHaveLength(2)
    })

    it('lets the most advanced status win, regardless of order or date', () => {
        const ls = [
            lead({ id: 'OLD', status: 'Not Qualified', createdAt: '2026-07-01', phoneKey: '9000000001' }),
            lead({ id: 'WON', status: 'Purchased with Truva', createdAt: '2026-08-01', phoneKey: '9000000001' }),
            lead({ id: 'MID', status: 'Qualified', createdAt: '2026-07-15', phoneKey: '9000000001' }),
        ]
        assignLeadIdentity(ls)
        expect(primaries(ls)).toEqual(['WON'])
    })

    it('ranks visit-pipeline above qualified above everything else', () => {
        const ls = [
            lead({ id: 'Q', status: 'Paused Search', createdAt: '2026-07-01', phoneKey: '9000000001' }),
            lead({ id: 'V', status: 'Visit Scheduled', createdAt: '2026-07-02', phoneKey: '9000000001' }),
        ]
        assignLeadIdentity(ls)
        expect(primaries(ls)).toEqual(['V'])
    })

    it('breaks ties on earliest created, so a re-enquiry cannot re-date the lead', () => {
        const ls = [
            lead({ id: 'LATER', status: 'Qualified', createdAt: '2026-08-20', phoneKey: '9000000001' }),
            lead({ id: 'FIRST', status: 'Qualified', createdAt: '2026-06-02', phoneKey: '9000000001' }),
        ]
        assignLeadIdentity(ls)
        expect(primaries(ls)).toEqual(['FIRST'])
    })

    it('never merges leads that simply both lack a phone', () => {
        const ls = [
            lead({ id: 'A', status: 'Qualified', createdAt: '2026-07-01' }),
            lead({ id: 'B', status: 'Qualified', createdAt: '2026-07-02' }),
        ]
        assignLeadIdentity(ls)
        expect(primaries(ls)).toEqual(['A', 'B'])
        expect(ls[0]!.dedupKey).not.toBe(ls[1]!.dedupKey)
    })

    it('is idempotent — re-running does not elect a second primary', () => {
        const ls = [
            lead({ id: 'A', status: 'Qualified', createdAt: '2026-07-01', phoneKey: '9000000001' }),
            lead({ id: 'B', status: 'Junk', createdAt: '2026-07-02', phoneKey: '9000000001' }),
        ]
        assignLeadIdentity(ls)
        assignLeadIdentity(ls)
        expect(primaries(ls)).toEqual(['A'])
    })
})

describe('sourceLabel', () => {
    it('folds the live casing junk so one source is one legend entry', () => {
        expect(sourceLabel('ig')).toBe('Instagram')
        expect(sourceLabel('Instagram')).toBe('Instagram')
        expect(sourceLabel('meta')).toBe('Meta')
        expect(sourceLabel('google')).toBe('Google Ads')
        expect(sourceLabel('Magicbricks')).toBe('MagicBricks')
        expect(sourceLabel('99Acres')).toBe('99Acres')
    })

    it('keeps an unrecognised source visible rather than dropping it', () => {
        expect(sourceLabel('TikTok')).toBe('TikTok')
        expect(sourceLabel('')).toBe('Unmapped')
        expect(sourceLabel(null)).toBe('Unmapped')
    })

    it('every label it can produce is placed in the display order', () => {
        // A source missing from SOURCE_ORDER sorts to the end of the stack and falls off
        // the channel hue ramp, so the two lists must not drift apart.
        for (const label of Object.values(SOURCE_LABEL)) {
            expect(SOURCE_ORDER).toContain(label)
        }
    })

    it('every source in the order maps to a channel', () => {
        for (const [channel, sources] of Object.entries(SOURCES_BY_CHANNEL)) {
            expect(sources.length).toBeGreaterThan(0)
            expect(CHANNELS).toContain(channel)
        }
    })
})

describe('toList splits Zoho multiselects', () => {
    it('splits on the semicolon COQL joins multiselect values with', () => {
        expect(toList('Powai;Vegas')).toEqual(['Powai', 'Vegas'])
        expect(toList('Powai; Glasgow')).toEqual(['Powai', 'Glasgow'])
        expect(toList('Vegas;Powai;Boston')).toEqual(['Vegas', 'Powai', 'Boston'])
    })

    it('leaves a single value and an array alone', () => {
        expect(toList('Powai')).toEqual(['Powai'])
        expect(toList(['Powai', 'Vegas'])).toEqual(['Powai', 'Vegas'])
        expect(toList(null)).toEqual([])
        expect(toList('')).toEqual([])
    })

    it('does not guess at other separators', () => {
        // Free-text junk, not a multiselect join — left whole rather than mangled.
        expect(toList('Glasgow / Amsterdam')).toEqual(['Glasgow / Amsterdam'])
    })
})

describe('cluster and micromarket are not ANDed on a lead', () => {
    // Clicking a cluster in the picker selects its micromarkets too. Truva_Cluster and
    // UTM_Micromarket disagree on ~31% of records, so ANDing them under-reported GLAM by
    // 306 leads (996 -> 690) for JAS 2026 Paid Ads.
    const glasgowLead = lead({ id: 'G', status: 'Qualified', createdAt: '2026-07-01' })
    glasgowLead.micromarkets = ['Glasgow']
    glasgowLead.clusters = ['Unknown'] // Truva_Cluster disagrees with the UTM micromarket

    it('counts a lead whose micromarket matches even when its cluster does not', () => {
        const f = { ...EMPTY_FILTERS, clusters: ['GLAM'], micromarkets: ['Glasgow', 'Amsterdam'] }
        expect(leadMatches(glasgowLead, f)).toBe(true)
    })

    it('gives the same answer as selecting the micromarkets without the parent', () => {
        const viaParent = { ...EMPTY_FILTERS, clusters: ['GLAM'], micromarkets: ['Glasgow', 'Amsterdam'] }
        const viaChildren = { ...EMPTY_FILTERS, micromarkets: ['Glasgow', 'Amsterdam'] }
        expect(leadMatches(glasgowLead, viaParent)).toBe(leadMatches(glasgowLead, viaChildren))
    })

    it('still excludes a lead in neither selected micromarket', () => {
        const powai = lead({ id: 'P', status: 'Qualified', createdAt: '2026-07-01' })
        powai.micromarkets = ['Powai']
        powai.clusters = ['GLAM'] // cluster says GLAM, micromarket does not — micromarket wins
        expect(leadMatches(powai, { ...EMPTY_FILTERS, micromarkets: ['Glasgow'] })).toBe(false)
    })

    it('still applies a cluster filter on its own', () => {
        const f = { ...EMPTY_FILTERS, clusters: ['GLAM'] }
        expect(leadMatches(glasgowLead, f)).toBe(false) // clusters === ['Unknown']
        const inGlam = lead({ id: 'X', status: 'Qualified', createdAt: '2026-07-01' })
        inGlam.clusters = ['GLAM']
        expect(leadMatches(inGlam, f)).toBe(true)
    })
})
