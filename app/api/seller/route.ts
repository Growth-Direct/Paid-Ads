import { bustSellerCache, fetchSellerFactsCached } from '@/lib/seller/aggregate'
import { quarterEndOfIST, quarterStartOfIST } from '@/lib/seller/shared'
import { SELLER_QUARTER_END_ISO, SELLER_QUARTER_START_ISO } from '@/lib/seller/types'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// Returns the seller fact table, not finished charts — every card is derived in the browser,
// so changing a filter inside the loaded window recomputes instantly. Mirrors /api/buyer.
//
// With no params the window is the seller reporting quarter, which is now the same calendar
// quarter as the buyer tab (Jul 1 → Oct 1, changed 2026-09-09 — see SELLER_QUARTER_START_ISO's
// doc comment). A requested range is snapped out to whole calendar quarters so paging between
// quarters reuses the cache.
export async function GET(request: Request) {
    const url = new URL(request.url)
    if (url.searchParams.get('refresh') === '1') bustSellerCache()

    const startParam = url.searchParams.get('start')
    const endParam = url.searchParams.get('end')

    // Default: the seller reporting quarter exactly (Jul 1 → Oct 1, same as the calendar
    // quarter now — see SELLER_QUARTER_START_ISO's doc comment for the 2026-09-09 change).
    if (!startParam && !endParam) {
        const windowStart = new Date(SELLER_QUARTER_START_ISO)
        const windowEnd = new Date(SELLER_QUARTER_END_ISO)
        try {
            return NextResponse.json(await fetchSellerFactsCached(windowStart, windowEnd))
        } catch (err) {
            console.error('[/api/seller] fetch failed:', err)
            return NextResponse.json(
                { error: err instanceof Error ? err.message : 'Internal server error' },
                { status: 500 }
            )
        }
    }

    const fallback = new Date(SELLER_QUARTER_START_ISO)
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
        return NextResponse.json(await fetchSellerFactsCached(windowStart, windowEnd))
    } catch (err) {
        console.error('[/api/seller] fetch failed:', err)
        return NextResponse.json(
            { error: err instanceof Error ? err.message : 'Internal server error' },
            { status: 500 }
        )
    }
}
