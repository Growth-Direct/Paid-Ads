import { Redis } from '@upstash/redis'

// Backs the Target vs Achieved table's "Next 2wk Target" column, which the growth team can type
// their own number into (overriding the computed flat-rate default derive.ts still sends down as
// TwoWeekRow.nextW2Target). Shared across every viewer, same storage shape and same
// degrade-gracefully-with-no-KV-store behaviour as lib/seller/actionables.ts — see that file's
// comment for why Redis.fromEnv() is guarded rather than called directly.
//
// `byMetric`'s keys are no longer bare metric names (changed 2026-09-10, per an explicit
// growth-team request to break this down by channel and by micromarket, mirroring how the
// quarterly target grid in lib/seller/targets.ts already works). This module and the API route
// don't know or care about that — they just store whatever string-keyed object they're handed —
// but a real key today looks like `` `${metric}::channel::${channel}` `` or
// `` `${metric}::mm::${micromarket}` ``. See components/seller/SellerTab.tsx's
// channelTargetKey/mmTargetKey/resolveNextTargetScope for where the key format actually lives.
// The field name `byMetric` is now a slight misnomer (kept as-is rather than renamed, since
// that would touch the API request/response shape for no behavioral reason).

const KEY = 'seller:next-2wk-targets'

export interface NextTargets {
    byMetric: Record<string, number | null>
    updatedAt: string | null
}

function emptyNextTargets(): NextTargets {
    return { byMetric: {}, updatedAt: null }
}

function getRedis(): Redis | null {
    const hasEnv =
        !!(process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL) &&
        !!(process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN)
    return hasEnv ? Redis.fromEnv() : null
}

// In-process fallback for when no KV store is configured — mirrors actionables.ts's fallback.
let fallback: NextTargets = emptyNextTargets()

export async function getNextTargets(): Promise<NextTargets> {
    const redis = getRedis()
    if (!redis) return fallback
    const stored = await redis.get<NextTargets>(KEY)
    return stored ?? emptyNextTargets()
}

export async function setNextTargets(byMetric: Record<string, number | null>): Promise<NextTargets> {
    const value: NextTargets = { byMetric, updatedAt: new Date().toISOString() }
    const redis = getRedis()
    if (!redis) {
        fallback = value
        return value
    }
    await redis.set(KEY, value)
    return value
}
