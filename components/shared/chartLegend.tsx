import type { ReactElement } from 'react'

// Recharts renders a legend label in its own series colour by default. Half this palette is
// pale by design — light greens, sand, mid-blues — so those labels come out barely legible
// against the cream card. The swatch already carries the colour; the text only has to be
// readable.
//
// This lives here, shared, because the fix was applied to one chart at a time and kept being
// missed on the next one. Every Legend in this app passes both of these.

const INK = '#3a3630'

/** Legend label in dark ink, whatever the series colour. */
export function legendFormatter(value: string): ReactElement {
    return <span style={{ color: INK }}>{value}</span>
}

/** The standard legend wrapper style — mono, 11px, matching the axis ticks. */
export const LEGEND_STYLE = { fontSize: 11, fontFamily: "'IBM Plex Mono', monospace" } as const
