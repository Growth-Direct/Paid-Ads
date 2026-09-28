import { GrowthUnavailableError } from '@/lib/procurement/growth'
import { buildProcurementReport } from '@/lib/procurement/report'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// Homeowner-data procurement progress per society, for the dashboard.
//
// The numbers come from growth, which is the only service that can reach the two private databases
// they are computed from. This route adds Airtable priority and its rollup, which growth has never
// seen, and returns both together. See lib/procurement/report.ts for the division of labour.
//
// Query params pass through to growth unchanged, except `priority`, which is applied here because
// growth does not know about priority at all.

/** Split a comma-separated param, or undefined when there is nothing to split. */
function parseList(raw: string | null): string[] | undefined {
    if (!raw) return undefined
    const values = raw
        .split(',')
        .map((value) => value.trim().toUpperCase())
        .filter(Boolean)
    return values.length > 0 ? values : undefined
}

export async function GET(request: Request) {
    const params = new URL(request.url).searchParams

    try {
        const report = await buildProcurementReport({
            truvaQualified: parseList(params.get('truvaQualified')),
            includeTowers: params.get('includeTowers') === 'true',
            federation: params.get('federation') || undefined,
            search: params.get('search') || undefined,
            priority: params.get('priority') || undefined,
        })
        return NextResponse.json(report)
    } catch (err) {
        // growth being unreachable is a 503, not a 500: it says "the source is down", which is
        // what the dashboard should tell the reader, rather than implying this app is broken. It
        // is deliberately NOT an empty report — a procurement page showing zeroes would read as
        // "nothing procured", which is a claim nobody should make by accident.
        if (err instanceof GrowthUnavailableError) {
            console.error('[/api/procurement] growth unavailable:', err.message)
            return NextResponse.json({ error: 'growth_unavailable', detail: err.message }, { status: 503 })
        }
        console.error('[/api/procurement] failed:', err)
        return NextResponse.json(
            { error: err instanceof Error ? err.message : 'Internal server error' },
            { status: 500 }
        )
    }
}
