// Where the procurement dashboard gets its two inputs, and whether each can be reached.
//
// The ratio is not computed here. growth owns it, because the two sources it needs — the Zoho
// sync mirror and truiq's MySQL — are both private to the VPC, and Metabase's load balancer is IP
// allowlisted with no static Vercel egress IP to add to it below Enterprise. growth runs on App
// Runner behind a VPC connector and reaches all of it.
//
// So this side reads one endpoint from growth and adds priority from Airtable, whose API is public.
// growth calls truiq itself; nothing here knows truiq exists.
//
// growth is reached with the key the spend ledger already uses, so procurement adds no new secret
// to this deployment.
//
// Everything is read at CALL time, not module load, following lib/buyer/spend/ledger.ts: a missing
// var must degrade one block of one page to "unavailable" and leave the rest of the dashboard
// rendering, never throw during import and take the whole page down.

/** The table name as Airtable shows it in the Growth – Marketing base. */
const DEFAULT_TQ_TABLE = 'TQ Unit wise'

export interface ProcurementApiConfig {
    /** No trailing slash; callers append `/api/...`. */
    baseUrl: string
    /**
     * Sent as `x-api-key`. This is growth's `API_KEY` — the same secret the spend ledger already
     * uses, which is why nothing new has to be set here.
     *
     * The narrower `EXTERNAL_API_KEY` gate exists in growth's middleware but is **not configured
     * on the service** (checked on growth-production, 2026-09-23), and standing it up would mean
     * a second secret on both sides for one more read-only GET by a consumer that already holds
     * this one. So procurement uses the same door as the ledger, and its route deliberately does
     * not sit under `/api/external/` pretending otherwise.
     */
    apiKey: string
}

export interface AirtableConfig {
    apiKey: string
    baseId: string
    table: string
}

/**
 * growth's procurement endpoint, or null when it cannot be reached.
 *
 * Reads the `GROWTH_LEDGER_*` pair and nothing else. Procurement and the spend ledger are the
 * same growth service behind the same `x-api-key` gate, so a second pair of variables would only
 * mean two places to look when a request goes somewhere unexpected — and one more thing to set
 * correctly when pointing this dashboard at a local growth.
 */
export function procurementApiConfig(): ProcurementApiConfig | null {
    const baseUrl = process.env.GROWTH_LEDGER_BASE_URL?.trim().replace(/\/$/, '')
    const apiKey = process.env.GROWTH_LEDGER_API_KEY?.trim()
    if (!baseUrl || !apiKey) return null
    return { baseUrl, apiKey }
}

/**
 * Airtable, or null when it cannot be reached.
 *
 * The asymmetry against `procurementApiConfig` is the point. Priority is a label used for
 * grouping, so losing it costs the grouping and nothing else: every society still renders, with
 * `priority: null` and a warning. Losing growth costs the numbers themselves, which is a different
 * failure and is treated as one.
 */
export function airtableConfig(): AirtableConfig | null {
    const apiKey = process.env.AIRTABLE_API_KEY?.trim()
    const baseId = process.env.AIRTABLE_BASE_ID?.trim()
    if (!apiKey || !baseId) return null
    const table = process.env.AIRTABLE_TQ_TABLE?.trim() || DEFAULT_TQ_TABLE
    return { apiKey, baseId, table }
}

/** True when the required source is configured. Airtable being absent does not fail this. */
export function procurementConfigured(): boolean {
    return procurementApiConfig() !== null
}

/**
 * What is and is not configured, without ever returning a secret.
 *
 * For a health check and for the dashboard's own "why is this block empty" copy. It reports
 * presence and the non-secret values — never a key, not even truncated, because a prefix in a log
 * is still a prefix in a log.
 */
export function procurementEnvReport(): {
    growth: { configured: boolean; baseUrl: string | null }
    airtable: { configured: boolean; baseId: string | null; table: string | null }
} {
    const growth = procurementApiConfig()
    const airtable = airtableConfig()
    return {
        growth: { configured: growth !== null, baseUrl: growth?.baseUrl ?? null },
        airtable: {
            configured: airtable !== null,
            baseId: airtable?.baseId ?? null,
            table: airtable?.table ?? null,
        },
    }
}
