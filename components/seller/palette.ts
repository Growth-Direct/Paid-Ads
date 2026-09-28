import { SELLER_CHANNELS, SELLER_MICROMARKETS } from '@/lib/seller/types'

// Seller charts stack by CHANNEL and by Call_Status, so this palette needs one colour per
// channel and a lifecycle-sentiment colour per status — not the buyer's per-source hue
// ramps. Kept separate from the buyer palette so the two never drift into each other.

const FALLBACK = ['#2563EB', '#DC2626', '#16A34A', '#8B5CF6', '#F59E0B', '#14B8A6', '#DB2777', '#EA580C', '#6B7280']

// One hue per channel. Cold Outreach gets its own teal so it never collides with 3P (red)
// or Referral & WOM (gold). Order matches SELLER_CHANNELS.
const CHANNEL_COLOR: Record<string, string> = {
    'Paid Ads': '#16A34A', // green
    '3P': '#DC2626', // red
    'Offline Branding': '#64748B', // slate
    'Society WA Groups & Management Apps': '#8B5CF6', // purple
    Organic: '#2563EB', // blue
    'Referral & WOM': '#F59E0B', // gold
    'Cold Outreach': '#14B8A6', // teal — the seller-only channel
    Unmapped: '#9CA3AF', // neutral
}

export const CHANNEL_ORDER: string[] = [...SELLER_CHANNELS]

// One hue family per cluster, shades within it running dark → light in SELLER_MICROMARKETS
// order — mirrors the buyer palette's CHANNEL_RAMPS pattern (a source keeps its channel's hue
// family so a stack still reads as its channel at a glance). Here a micromarket keeps its
// cluster's hue family, matching the grouping the Micromarket Analysis tooltips read by
// (MICROMARKET_TO_CLUSTER in lib/seller/shared.ts) and the colours already used on the Visits
// in Pipeline by Cluster chart's cluster axis. Fixed entries rather than the FALLBACK ramp
// below: 11 micromarkets would wrap FALLBACK's 9 colours and silently double up two of them.
const MICROMARKET_COLOR: Record<string, string> = {
    // PAV
    Powai: '#1D4ED8',
    Vegas: '#2563EB',
    Athens: '#60A5FA',
    // GLAM
    Glasgow: '#6D28D9',
    Amsterdam: '#8B5CF6',
    // BABU
    Boston: '#B45309',
    Barcelona: '#F59E0B',
    Singapore: '#FCD34D',
    // HABIBI
    Helsinki: '#0F766E',
    Berlin: '#14B8A6',
    'Hong Kong': '#5EEAD4',
}

export const MICROMARKET_ORDER: string[] = [...SELLER_MICROMARKETS]

// Call_Status coloured by lifecycle sentiment, so a stack reads at a glance: blues are still
// to be worked (being contacted / untouched), greens are qualified & progressing toward an
// MoU, reds are dead or lost. Shades within a family run dark → light in STATUS_ORDER order.
const STATUS_RAMPS = {
    blue: ['#1D4ED8', '#2563EB', '#60A5FA', '#BFDBFE'],
    green: ['#0B5A2E', '#0F7B3E', '#22B559', '#6EE7A0'],
    red: ['#8F1D1D', '#B91C1C', '#F87171', '#FCA5A5'],
    neutral: ['#9CA3AF'],
} as const

// [family, statuses] — also the stack/legend order (blue → green → red → neutral).
// 'Attempted to Contact' is the folded telephony-junk bucket; 'Blank' is a folded empty
// status. The three greens are exactly the qualified set — kept in sync with the 2026-09-07
// Notion update (SELLER_QUALIFIED_STATUSES in lib/seller/types.ts): 'Prospect' is qualified
// now, 'Already sold the flat' isn't (moved to red — a seller who sold elsewhere is a dead
// end for us, not a status still progressing toward an MoU).
const STATUS_FAMILY: Array<[keyof typeof STATUS_RAMPS, string[]]> = [
    ['blue', ['Fresh', 'Attempted to Contact', 'Call Later', 'Follow Up', 'Blank']],
    ['green', ['Qualified', 'Explore Later', 'Prospect']],
    ['red', ['Not qualified', 'Inactive', 'Invalid number', 'Already sold the flat']],
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

/** Colour for a seller series key — a channel keeps its fixed hue and a known status its
 *  sentiment shade; anything else (a new channel/status) falls back to a first-come ramp. */
export function colorFor(key: string): string {
    const fixed = CHANNEL_COLOR[key] ?? STATUS_COLOR.get(key) ?? MICROMARKET_COLOR[key]
    if (fixed) return fixed
    if (!assigned.has(key)) {
        assigned.set(key, FALLBACK[nextIdx % FALLBACK.length]!)
        nextIdx++
    }
    return assigned.get(key)!
}
