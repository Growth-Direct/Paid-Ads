import { procurementApiConfig } from './config'
import type { GrowthProgressResponse } from './types'

// Reading procurement progress from growth.
//
// One endpoint, `/api/procurement/society-progress`, authenticated with `x-api-key` — the same
// key the spend ledger already uses, so procurement adds no new secret here. growth calls truiq
// itself for the unit counts; nothing here knows truiq exists or holds a truiq credential.

/** Query options, matching growth's parameters one for one. */
export interface FetchProgressOptions {
    /**
     * TQ standings in scope. Omit for growth's default of `YES` alone.
     *
     * The column has seven values and `CHECK_PENDING` is the largest bucket, so widening this
     * changes which question is being answered, not merely how many rows come back.
     */
    truvaQualified?: string[]
    /**
     * Ask for the per-tower breakdown.
     *
     * Check `dataQuality.towerCoverage` before rendering it — tower names are present on roughly a
     * third of procured records, and growth returns a `tower_data_incomplete` warning to say so.
     */
    includeTowers?: boolean
    federation?: string
    search?: string
}

/** How long to wait on growth before giving up. It queries two databases and joins them. */
const TIMEOUT_MS = 30_000

/**
 * Thrown when growth cannot be reached or answers with something unusable.
 *
 * Deliberately fatal to the request rather than degraded. A procurement report with no numbers in
 * it would render as "nothing procured", which is a claim this dashboard must never make by
 * accident.
 */
export class GrowthUnavailableError extends Error {
    constructor(
        message: string,
        readonly status?: number
    ) {
        super(message)
        this.name = 'GrowthUnavailableError'
    }
}

/** Build the query string, omitting anything the caller did not set. */
function buildQuery(options: FetchProgressOptions): string {
    const params = new URLSearchParams()
    if (options.truvaQualified?.length) params.set('truvaQualified', options.truvaQualified.join(','))
    if (options.includeTowers) params.set('includeTowers', 'true')
    if (options.federation) params.set('federation', options.federation)
    if (options.search) params.set('search', options.search)
    const query = params.toString()
    return query ? `?${query}` : ''
}

/**
 * Check the fields this dashboard actually reads before trusting the response.
 *
 * The types in `types.ts` are a restatement of growth's, not a shared package, so a change on that
 * side lands here as a silent `undefined` rather than a type error. A missing `societies` array
 * would render as an empty dashboard; a missing `summary` would throw somewhere further in, with a
 * stack trace that points at the chart rather than at the contract. Failing here names the cause.
 */
function assertUsable(body: unknown): asserts body is GrowthProgressResponse {
    const response = body as Partial<GrowthProgressResponse> | null
    if (!response || typeof response !== 'object') {
        throw new GrowthUnavailableError('growth returned a non-object body')
    }
    if (!Array.isArray(response.societies)) {
        throw new GrowthUnavailableError('growth response is missing the societies array')
    }
    if (!response.summary || typeof response.summary.totalUnits !== 'number') {
        throw new GrowthUnavailableError('growth response is missing its summary totals')
    }
    if (!response.dataQuality) {
        throw new GrowthUnavailableError('growth response is missing its dataQuality block')
    }
    // Added when growth started reporting both grains. Checked here because a percentage without
    // its coverage figure is the one thing this dashboard must not render — see MatchCoverage.
    if (!response.matchCoverage) {
        throw new GrowthUnavailableError('growth response is missing its matchCoverage block')
    }
}

/**
 * Fetch procurement progress from growth.
 *
 * @throws {GrowthUnavailableError} When growth is unconfigured, unreachable, rejects the key, or
 *   answers with a body this dashboard cannot use.
 */
export async function fetchSocietyProgress(
    options: FetchProgressOptions = {}
): Promise<GrowthProgressResponse> {
    const config = procurementApiConfig()
    if (!config) {
        throw new GrowthUnavailableError(
            'growth is not configured — set GROWTH_LEDGER_BASE_URL and GROWTH_LEDGER_API_KEY'
        )
    }

    const url = `${config.baseUrl}/api/procurement/society-progress${buildQuery(options)}`

    let response: Response
    try {
        response = await fetch(url, {
            headers: { 'x-api-key': config.apiKey },
            signal: AbortSignal.timeout(TIMEOUT_MS),
            cache: 'no-store',
        })
    } catch (error) {
        throw new GrowthUnavailableError(
            `growth did not respond: ${error instanceof Error ? error.message : String(error)}`
        )
    }

    if (!response.ok) {
        // growth's middleware answers a bad `x-api-key` with 403, not 401 — a different branch
        // from the `/api/external/` one. Naming the variable saves the next person checking the
        // wrong secret.
        const hint = response.status === 403 ? ' (check GROWTH_LEDGER_API_KEY — growth answers a bad x-api-key with 403)' : ''
        throw new GrowthUnavailableError(`growth returned ${response.status}${hint}`, response.status)
    }

    const body = await response.json().catch(() => null)
    assertUsable(body)
    return body
}
