import { VALID_MICROMARKETS, fixMicromarket, mapChannel } from './shared'
import type { Channel } from './types'

// First-touch attribution from Lead_Source_History. A lead's FIRST LSH row (the one with
// Serial_Number = 1) carries the source and micromarket that acquired the lead, which is
// what cost metrics divide by. This is a SECOND, PARALLEL attribution used only by the
// cost block — nothing in derive.ts reads it, because the twelve funnel cards are
// reconciled against Metabase on Truva_Micromarket and Lead_Source.
//
// Cluster is NOT read from LSH: Lead_Source_History.Truva_Cluster is 100% null. Derive
// cluster from the attributed micromarket via CLUSTER_TREE at the point of use.

export interface RawLsh {
    id: string
    Lead?: { id: string } | string | null
    Source?: string
    Micromarket?: string
    /** The true touch time. Never Created_Time, which is when the row was written. */
    Timestamp?: string
    Serial_Number?: number | string
    /** Verified live 2026-09-23 (table-map.md): ~73% filled on first-touch rows — the rest
     *  is touches with no ad campaign at all (Direct, CP, organic, referral), not missing
     *  data. */
    Campaign_Name?: string
    Ad_Set_Name?: string
    Ad_Name?: string
    /** Long, raw property name. Preferred over Property_ID, which is meaningfully less
     *  complete (58% vs 91% filled, verified live 2026-09-23). */
    Property_Name?: string
    /** Lead status AT THE TIME OF THIS ENGAGEMENT, not the lead's current status. 100%
     *  filled on first-touch rows, verified live 2026-09-23. */
    Lead_Status?: string
}

export interface LeadAttribution {
    source: string
    /** mapChannel(source): a Channel, 'Unmapped', or null when the source is excluded
     *  (Channel Partner / Builder / Seller Referral). */
    channel: Channel | null
    /** A valid micromarket, or null when the touch has none or a virtual/junk value. */
    micromarket: string | null
    at: string
    /** '' when the touch has no ad campaign at all (Direct, CP, organic, referral, ...) —
     *  a real, expected value, not a data gap. */
    campaign: string
    adSet: string
    ad: string
    /** '' when the touch's property name is blank. Raw and untrimmed, same as elsewhere in
     *  this codebase — trim for display. */
    property: string
}

function lshLeadId(r: RawLsh): string | null {
    if (!r.Lead) return null
    return typeof r.Lead === 'string' ? r.Lead : r.Lead.id
}

/** Build the attribution map from raw serial-1 LSH rows. Defensive about two things the
 *  lsh-data-sanity skill documents: serial order has drifted from chronological order,
 *  and a lead can carry more than one serial-1 row. On collision keep the earliest
 *  Timestamp — the genuine first touch. */
export function resolveFirstTouches(rows: RawLsh[]): Map<string, LeadAttribution> {
    const out = new Map<string, LeadAttribution>()
    for (const r of rows) {
        const leadId = lshLeadId(r)
        const at = (r.Timestamp ?? '').trim()
        if (!leadId || !at) continue

        const source = (r.Source ?? '').trim()
        const mmFixed = fixMicromarket(r.Micromarket)
        const attribution: LeadAttribution = {
            source,
            channel: mapChannel(source),
            micromarket: VALID_MICROMARKETS.has(mmFixed) ? mmFixed : null,
            at,
            campaign: (r.Campaign_Name ?? '').trim(),
            adSet: (r.Ad_Set_Name ?? '').trim(),
            ad: (r.Ad_Name ?? '').trim(),
            property: (r.Property_Name ?? '').trim(),
        }

        const existing = out.get(leadId)
        if (!existing || new Date(at) < new Date(existing.at)) out.set(leadId, attribution)
    }
    return out
}
