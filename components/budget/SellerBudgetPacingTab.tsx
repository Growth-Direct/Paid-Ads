'use client'

import ChartCard from '@/components/shared/ChartCard'
import SectionHeader from '@/components/shared/SectionHeader'
import BudgetPacingDetailTable from './BudgetPacingDetailTable'
import { computeSellerBudgetPacing } from '@/lib/seller/budgetPacing'
import type { SellerFactsResponse } from '@/lib/seller/aggregate'
import { useMemo } from 'react'

const MONO = { fontFamily: "'IBM Plex Mono', monospace" } as const

/** The seller-side sibling of components/budget/BudgetPacingTab.tsx — same daily-run-rate
 *  columns, computed from lib/seller/budgetPacing.ts over the already-fetched Seller facts
 *  (no new Zoho fetch). Always the full seller reporting quarter, no time filter. */
export default function SellerBudgetPacingTab({ response }: { response: SellerFactsResponse }) {
    const data = useMemo(
        () =>
            computeSellerBudgetPacing(response.facts, {
                quarterStart: new Date(response.quarterStart),
                quarterEnd: new Date(response.quarterEnd),
                now: new Date(),
            }),
        [response]
    )

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            <SectionHeader title={`Seller Budget Pacing — ${response.quarterLabel}`} />
            <div style={{ fontSize: 12.5, color: '#333333', ...MONO }}>
                Spend pacing by Channel and by Micromarket/Cluster, broken into a daily run-rate view: how much
                should be spent by today, what&apos;s actually gone out (through yesterday), and how many more days
                the remaining budget lasts at the last 7 days&apos; pace. Always the full reporting quarter; this
                tab has no time filter.
            </div>

            <ChartCard title="Seller Budget Pacing by Channel" height="auto">
                <BudgetPacingDetailTable data={data.byChannel} rowLabelHeader="Channel" />
            </ChartCard>

            <ChartCard title="Seller Budget Pacing by Micromarket / Cluster" height="auto">
                <BudgetPacingDetailTable data={data.byMicromarket} rowLabelHeader="Micromarket / Cluster" />
            </ChartCard>
        </div>
    )
}
