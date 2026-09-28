import { SOURCES_BY_CHANNEL } from '@/lib/buyer/types'

export const SERIES_COLORS = [
    '#2563EB',
    '#DC2626',
    '#16A34A',
    '#8B5CF6',
    '#F59E0B',
    '#14B8A6',
    '#DB2777',
    '#EA580C',
    '#6B7280',
]

// Per-channel hue families for the by-source charts. Showing the real source name means
// ~18 series instead of 7, which the 9-colour SERIES_COLORS ramp cannot carry — it wraps,
// so two sources would silently share a colour. Each channel instead owns a hue and its
// sources are shades within it, so a stack still reads as its channel at a glance while
// naming the actual source. Shades run dark to light in the same order as
// SOURCES_BY_CHANNEL, i.e. biggest source darkest.
const CHANNEL_RAMPS: Record<string, string[]> = {
    'Paid Ads': ['#0F7B3E', '#16A34A', '#4ADE80', '#86EFAC'],
    '3P': ['#B91C1C', '#DC2626', '#F87171'],
    Organic: ['#1D4ED8', '#2563EB', '#60A5FA', '#BFDBFE'],
    'Offline Branding': ['#64748B'],
    'Society WA Groups & Management Apps': ['#6D28D9', '#8B5CF6', '#C4B5FD'],
    'Referral & WOM': ['#B45309', '#F59E0B'],
    Unmapped: ['#9CA3AF'],
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
    blue: ['#1D4ED8', '#2563EB', '#60A5FA'],
    // Capped at a mid green rather than running to near-white — the palest shades were
    // unreadable as bar slivers on the (now white) card background.
    green: ['#0B5A2E', '#0F7B3E', '#16A34A', '#22B559', '#4ADE80', '#6EE7A0', '#86EFAC', '#A7F3C3'],
    red: ['#8F1D1D', '#B91C1C', '#F87171'],
    neutral: ['#9CA3AF'],
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
