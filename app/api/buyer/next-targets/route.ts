import { getNextTargets, setNextTargets } from '@/lib/buyer/nextTargets'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// The Target vs Achieved table's typed-in "Next 2wk Target" column — shared values, not
// per-user, keyed per channel or per micromarket (see lib/buyer/nextTargets.ts's doc comment
// for the key format). This route validates only that every value is a number or null; it has
// no opinion on what the keys mean. See lib/buyer/nextTargets.ts for how this degrades when no
// KV store is configured.
export async function GET() {
    try {
        return NextResponse.json(await getNextTargets())
    } catch (err) {
        console.error('[/api/buyer/next-targets] read failed:', err)
        return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal server error' }, { status: 500 })
    }
}

export async function POST(request: Request) {
    let body: unknown
    try {
        body = await request.json()
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }
    const byMetric = (body as { byMetric?: unknown })?.byMetric
    if (typeof byMetric !== 'object' || byMetric === null || Array.isArray(byMetric)) {
        return NextResponse.json({ error: '"byMetric" must be an object' }, { status: 400 })
    }
    const entries = Object.entries(byMetric as Record<string, unknown>)
    if (entries.some(([, v]) => typeof v !== 'number' && v !== null)) {
        return NextResponse.json({ error: 'every metric value must be a number or null' }, { status: 400 })
    }
    try {
        return NextResponse.json(await setNextTargets(byMetric as Record<string, number | null>))
    } catch (err) {
        console.error('[/api/buyer/next-targets] save failed:', err)
        return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal server error' }, { status: 500 })
    }
}
