import type { ReactElement } from 'react'

// Recharts renders a legend label in its own series colour by default. Half this palette is
// pale by design — light greens, sand, mid-blues — so those labels come out barely legible
// against the white card. The swatch already carries the colour; the text only has to be
// readable.
//
// This lives here, shared, because the fix was applied to one chart at a time and kept being
// missed on the next one. Every Legend in this app passes both of these.

const INK = '#000000'

// Added 2026-09-23 for the Campaign/AdSet/Ad/Property breakdown charts: those series keys
// are raw Zoho names (e.g. "Meta_TOF_Lead_Buyer_Vegas_SpecificArea_Vikhroli_Ghatkopar_121125"),
// tens of characters long, unlike every other dimension's short enum-like values (Source,
// Cluster, Status, Micromarket). Left untruncated, a long legend wrapped onto many lines and
// visually collided with the chart's Weekly/Bi-Weekly/Count/% toggle buttons (observed in
// manual testing). A short value is completely unaffected — this only trims the long tail,
// with the full name still available on hover via the native title tooltip.
const LEGEND_LABEL_MAX_CHARS = 32

/** Legend label in dark ink, whatever the series colour. Long labels (Campaign/AdSet/Ad/
 *  Property names) truncate with the full value on hover; short ones are untouched. */
export function legendFormatter(value: string): ReactElement {
    const truncated = value.length > LEGEND_LABEL_MAX_CHARS ? `${value.slice(0, LEGEND_LABEL_MAX_CHARS - 1)}…` : value
    return (
        <span style={{ color: INK }} title={value.length > LEGEND_LABEL_MAX_CHARS ? value : undefined}>
            {truncated}
        </span>
    )
}

/** The standard legend wrapper style — mono, 11px, matching the axis ticks. */
export const LEGEND_STYLE = { fontSize: 11, fontFamily: "'IBM Plex Mono', monospace" } as const
