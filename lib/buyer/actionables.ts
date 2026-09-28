import { Redis } from '@upstash/redis'
import { CHANNELS } from './types'

// Backs the "Next Actionables" table — one shared free-text row per channel, for what the team
// needs to do over the next two weeks. See lib/seller/actionables.ts (the Buyer equivalent of
// this file) for the fuller rationale — same storage shape, same key naming style, just a
// separate Redis key and channel list so Buyer and Seller never collide or share a save.
//
// `@upstash/redis` is already an installed dependency (see lib/seller/actionables.ts's comment
// on CLAUDE.md's stale "No Upstash and no cron" note). `Redis.fromEnv()` throws if neither env
// pair is set, so we check first and degrade instead of crashing.

const KEY = 'buyer:next-actionables'

/** The 6 real Buyer channels a row exists for — Unmapped has no target-grid row of its own and
 *  gets no actionable either, mirroring every other by-channel chart on this tab. (Seller's
 *  equivalent list also includes Cold Outreach, which isn't a Buyer channel at all.) */
export const ACTIONABLE_CHANNELS: string[] = CHANNELS.filter((c) => c !== 'Unmapped')

export interface Actionables {
    byChannel: Record<string, string>
    updatedAt: string | null
}

function emptyActionables(): Actionables {
    return { byChannel: Object.fromEntries(ACTIONABLE_CHANNELS.map((c) => [c, ''])), updatedAt: null }
}

function getRedis(): Redis | null {
    const hasEnv =
        !!(process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL) &&
        !!(process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN)
    return hasEnv ? Redis.fromEnv() : null
}

// In-process fallback for when no KV store is configured (local dev, or a deployment that
// hasn't set the env vars yet) — mirrors the in-memory cache pattern already used elsewhere in
// this repo. Not shared across serverless instances and doesn't survive a restart; real
// cross-viewer persistence needs the real env vars set.
let fallback: Actionables = emptyActionables()

export async function getActionables(): Promise<Actionables> {
    const redis = getRedis()
    if (!redis) return fallback
    const stored = await redis.get<Actionables>(KEY)
    return stored ?? emptyActionables()
}

export async function setActionables(byChannel: Record<string, string>): Promise<Actionables> {
    const value: Actionables = { byChannel, updatedAt: new Date().toISOString() }
    const redis = getRedis()
    if (!redis) {
        fallback = value
        return value
    }
    await redis.set(KEY, value)
    return value
}
