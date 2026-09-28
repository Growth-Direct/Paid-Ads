import { SOURCES_BY_CHANNEL } from '@/lib/buyer/types'

export const SERIES_COLORS = [
    '#3a7d5d',
    '#cf9d5b',
    '#8ba0b4',
    '#c7533e',
    '#7c5cbf',
    '#5ba88a',
    '#e5a040',
    '#4a90d9',
    '#a9a294',
]

// Per-channel hue families for the by-source charts. Showing the real source name means
// ~18 series instead of 7, which the 9-colour SERIES_COLORS ramp cannot carry — it wraps,
// so two sources would silently share a colour. Each channel instead owns a hue and its
// sources are shades within it, so a stack still reads as its channel at a glance while
// naming the actual source. Shades run dark to light in the same order as
// SOURCES_BY_CHANNEL, i.e. biggest source darkest.
const CHANNEL_RAMPS: Record<string, string[]> = {
    'Paid Ads': ['#2f6349', '#3a7d5d', '#5ba88a', '#8ec9ad'],
    '3P': ['#a8402e', '#c7533e', '#e08670'],
    Organic: ['#2f6ea8', '#4a90d9', '#7bb2e8', '#a9cef2'],
    'Offline Branding': ['#8ba0b4'],
    'Society WA Groups & Management Apps': ['#6544a6', '#7c5cbf', '#a98fd8'],
    'Referral & WOM': ['#b5822f', '#e5a040'],
    Unmapped: ['#a9a294'],
}

const SOURCE_COLOR = new Map<string, string>()
for (const [channel, sources] of Object.entries(SOURCES_BY_CHANNEL)) {
    const ramp = CHANNEL_RAMPS[channel] ?? SERIES_COLORS
    sources.forEach((source, i) => SOURCE_COLOR.set(source, ramp[i % ramp.length]!))
}

// WoW Leads by Status — coloured by lifecycle sentiment rather than an arbitrary hue per
// status, so a stack reads at a glance: blues are leads still to be worked (new / being
// contacted), greens are qualified and progressing toward a purchase, reds are dead or lost.
// Duplicate is admin noise, left neutral. Shades within a family run dark → light in
// STATUS_ORDER order.
const STATUS_RAMPS = {
    blue: ['#2f6ea8', '#4a90d9', '#7bb2e8'],
    // Capped at a mid green (~#7cbf9d) rather than running to near-white — the palest shades
    // were unreadable as bar slivers on the cream background.
    green: ['#204a37', '#26543d', '#2f6349', '#39785a', '#458f6c', '#54a07d', '#65b08f', '#7cbf9d'],
    red: ['#8f3729', '#c7533e', '#e0806f'],
    neutral: ['#a9a294'],
} as const

// [family, statuses] — also the stack/legend order (blue → green → red → neutral). Purchased
// Outside Truva is a qualified lead that bought elsewhere, so it counts as qualified and sits
// with the greens; Duplicate is noise.
const STATUS_FAMILY: Array<[keyof typeof STATUS_RAMPS, string[]]> = [
    ['blue', ['Unassigned', 'Attempted to Contact', 'Call Later']],
    [
        'green',
        [
            'Pre Qualified',
            'Qualified',
            'Site visit Scheduled',
            'Visit to be scheduled',
            'In follow Up',
            'Paused Search',
            'Purchased with Truva',
            'Purchased Outside Truva',
        ],
    ],
    ['red', ['Not Qualified', 'Inactive']],
    ['neutral', ['Duplicate']],
]

export const STATUS_ORDER: string[] = STATUS_FAMILY.flatMap(([, statuses]) => statuses)

const STATUS_COLOR = new Map<string, string>()
for (const [family, statuses] of STATUS_FAMILY) {
    const ramp = STATUS_RAMPS[family]
    statuses.forEach((status, i) => STATUS_COLOR.set(status, ramp[i % ramp.length]!))
}

const assigned = new Map<string, string>()
let nextIdx = 0

export function colorFor(key: string): string {
    // A known source keeps its channel's shade and a known status its sentiment shade wherever
    // it appears; everything else (clusters, micromarkets, any brand-new source or status)
    // falls back to the first-come ramp.
    const fixed = SOURCE_COLOR.get(key) ?? STATUS_COLOR.get(key)
    if (fixed) return fixed
    if (!assigned.has(key)) {
        assigned.set(key, SERIES_COLORS[nextIdx % SERIES_COLORS.length]!)
        nextIdx++
    }
    return assigned.get(key)!
}
