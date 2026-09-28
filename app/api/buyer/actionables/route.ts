import { getActionables, setActionables } from '@/lib/buyer/actionables'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// The "Next Actionables" table — one shared free-text row per channel, not per-user. See
// lib/buyer/actionables.ts for how this degrades when no KV store is configured.
export async function GET() {
    try {
        return NextResponse.json(await getActionables())
    } catch (err) {
        console.error('[/api/buyer/actionables] read failed:', err)
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
    const byChannel = (body as { byChannel?: unknown })?.byChannel
    if (typeof byChannel !== 'object' || byChannel === null || Array.isArray(byChannel)) {
        return NextResponse.json({ error: '"byChannel" must be an object' }, { status: 400 })
    }
    const entries = Object.entries(byChannel as Record<string, unknown>)
    if (entries.some(([, v]) => typeof v !== 'string')) {
        return NextResponse.json({ error: 'every channel value must be a string' }, { status: 400 })
    }
    try {
        return NextResponse.json(await setActionables(byChannel as Record<string, string>))
    } catch (err) {
        console.error('[/api/buyer/actionables] save failed:', err)
        return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal server error' }, { status: 500 })
    }
}
