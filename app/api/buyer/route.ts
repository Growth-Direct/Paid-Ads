import { bustBuyerCache, fetchBuyerFactsCached } from '@/lib/buyer/aggregate'
import { quarterEndOfIST, quarterStartOfIST } from '@/lib/buyer/shared'
import { QUARTER_START_ISO } from '@/lib/buyer/types'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// Returns the fact table, not finished charts. Every card is derived in the browser, so
// changing a filter inside the loaded window recomputes instantly. Only moving outside
// it costs a round trip to Zoho.
//
// The window is always snapped out to whole quarters. Zoho is the only source, a fetch
// costs ten seconds or more, and quarter-aligned windows mean the common case of paging
// between quarters hits the cache instead of refetching.
export async function GET(request: Request) {
    const url = new URL(request.url)
    if (url.searchParams.get('refresh') === '1') bustBuyerCache()

    const startParam = url.searchParams.get('start')
    const endParam = url.searchParams.get('end')
    const fallback = new Date(QUARTER_START_ISO)

    const rawStart = startParam ? new Date(startParam) : fallback
    const rawEnd = endParam ? new Date(endParam) : fallback
    if (Number.isNaN(rawStart.getTime()) || Number.isNaN(rawEnd.getTime())) {
        return NextResponse.json({ error: 'Invalid start or end' }, { status: 400 })
    }

    const windowStart = quarterStartOfIST(rawStart)
    const windowEnd = quarterEndOfIST(rawEnd > rawStart ? new Date(rawEnd.getTime() - 1) : rawStart)
    if (windowEnd <= windowStart) {
        return NextResponse.json({ error: 'end must be after start' }, { status: 400 })
    }

    try {
        return NextResponse.json(await fetchBuyerFactsCached(windowStart, windowEnd))
    } catch (err) {
        console.error('[/api/buyer] fetch failed:', err)
        return NextResponse.json(
            { error: err instanceof Error ? err.message : 'Internal server error' },
            { status: 500 }
        )
    }
}
