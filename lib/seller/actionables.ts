import { Redis } from '@upstash/redis'
import { SELLER_CHANNELS } from './types'

// Backs the "Next Actionables" table — one shared free-text row per channel, for what the team
// needs to do over the next two weeks. The one piece of user-typed state this dashboard
// persists; everything else is refetched from Zoho and cached at most 5 minutes (aggregate.ts).
//
// `@upstash/redis` is already an installed dependency and already listed in next.config.ts's
// serverExternalPackages (leftover scaffolding from the wire fork, previously unused — see
// CLAUDE.md's "No Upstash and no cron"). `Redis.fromEnv()` reads UPSTASH_REDIS_REST_URL/TOKEN,
// falling back to KV_REST_API_URL/TOKEN (Vercel KV's names) — but it THROWS if neither pair is
// set, so we check first and degrade instead of crashing: this feature is additive, unlike
// Zoho, and must never break the dashboard for a deployment that hasn't provisioned a KV store.

const KEY = 'seller:next-actionables'

/** The 7 real channels a row exists for — Unmapped has no target-grid row of its own and gets
 *  no actionable either, mirroring the "Just the 7 channels as per DRR" call on every other
 *  by-channel chart on this tab. */
export const ACTIONABLE_CHANNELS: string[] = SELLER_CHANNELS.filter((c) => c !== 'Unmapped')

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
