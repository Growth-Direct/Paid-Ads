import { Redis } from '@upstash/redis'

// Backs the Target vs Achieved table's "Next 2wk Target" column, which the growth team can type
// their own number into (overriding the computed flat-rate default derive.ts still sends down as
// TwoWeekRow.nextW2Target). Shared across every viewer, same storage shape and same
// degrade-gracefully-with-no-KV-store behaviour as lib/buyer/actionables.ts / lib/seller/nextTargets.ts
// (the Seller equivalent of this file) — see those files' comments for why Redis.fromEnv() is
// guarded rather than called directly.
//
// `byMetric`'s keys are compound, mirroring Seller's `${metric}::channel::${channel}` /
// `${metric}::mm::${micromarket}` scheme — this module and the API route don't know or care about
// that, they just store whatever string-keyed object they're handed. See
// components/buyer/BuyerTab.tsx's channelTargetKey/mmTargetKey/resolveNextTargetScope for where
// the key format actually lives.

const KEY = 'buyer:next-2wk-targets'

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
