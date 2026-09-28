import { queryRecords } from '@/lib/crm'
import { type LeadAttribution, type RawLsh, resolveFirstTouches } from './attribution'
import { toZohoDateTime } from './shared'

// Fetches first-touch attribution for every lead whose first Lead_Source_History row
// (Serial_Number = 1) falls in the window, bucketed on Timestamp. That is exactly the
// new-lead population for the window: 99.9% one-to-one with leads created, and if a
// lead's first touch predates the window its acquisition spend does too, so it correctly
// stays out of this window's denominator.
//
// Read from growth's copy of the Zoho mirror (lib/crm.ts), which throws on real errors. Callers
// pass month slices for wider windows, a shape forced by COQL's 10k cap and kept as it was.
// `between` is inclusive at both ends, as the COQL BETWEEN was.

export async function fetchFirstTouches(slices: Array<[Date, Date]>): Promise<Map<string, LeadAttribution>> {
    const rows: RawLsh[] = []
    for (const [a, b] of slices) {
        const q = queryRecords(
            'Lead_Source_History',
            ['id', 'Lead', 'Source', 'Micromarket', 'Timestamp', 'Serial_Number'],
            [
                { field: 'Timestamp', op: 'between', value: [toZohoDateTime(a), toZohoDateTime(b)] },
                { field: 'Serial_Number', op: 'eq', value: 1 },
            ]
        )
        const page = (await q.catch((e) => {
            throw new Error(`firstTouchesQ failed for ${a.toISOString()}: ${e.message}`)
        })) as RawLsh[]
        rows.push(...page)
    }
    return resolveFirstTouches(rows)
}

// Every Lead_Source_History row in the window, any Serial_Number — a lead that re-enquires
// gets a second (third, ...) row here, unlike fetchFirstTouches which keeps only the
// earliest. This is the raw touch count the Overall Funnel's "Total Leads" block wants,
// against LeadFact's one-row-per-lead "Unique Leads".
export async function fetchAllTouches(slices: Array<[Date, Date]>): Promise<Array<{ leadId: string; timestamp: string }>> {
    const out: Array<{ leadId: string; timestamp: string }> = []
    for (const [a, b] of slices) {
        const q = queryRecords('Lead_Source_History', ['id', 'Lead', 'Timestamp'], [
            { field: 'Timestamp', op: 'between', value: [toZohoDateTime(a), toZohoDateTime(b)] },
        ])
        const page = (await q.catch((e) => {
            throw new Error(`allTouchesQ failed for ${a.toISOString()}: ${e.message}`)
        })) as RawLsh[]
        for (const r of page) {
            const leadId = typeof r.Lead === 'string' ? r.Lead : r.Lead?.id
            const timestamp = (r.Timestamp ?? '').trim()
            if (leadId && timestamp) out.push({ leadId, timestamp })
        }
    }
    return out
}
