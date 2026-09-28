'use client'

import ChartCard from '@/components/shared/ChartCard'
import SectionHeader from '@/components/shared/SectionHeader'
import BudgetPacingDetailTable from './BudgetPacingDetailTable'
import { computeBudgetPacing } from '@/lib/buyer/budgetPacing'
import type { BuyerFactsResponse } from '@/lib/buyer/aggregate'
import { useMemo } from 'react'

const MONO = { fontFamily: "'IBM Plex Mono', monospace" } as const

/** Spend pacing by Channel and by Micromarket/Cluster — a standalone tab beside Buyer/
 *  Seller, not filtered by anything on the Buyer tab. Always the full reporting quarter.
 *  Reuses the already-fetched Buyer facts (no new Zoho fetch) via lib/buyer/budgetPacing.ts.
 *  Column set is the growth team's own explicit request (2026-09-26): daily-run-rate pacing,
 *  not the QTD/2-week shape the rest of this dashboard uses. */
export default function BudgetPacingTab({ response }: { response: BuyerFactsResponse }) {
    const data = useMemo(
        () =>
            computeBudgetPacing(response.facts, {
                quarterStart: new Date(response.quarterStart),
                quarterEnd: new Date(response.quarterEnd),
                now: new Date(),
            }),
        [response]
    )

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            <SectionHeader title={`Budget Pacing — ${response.quarterLabel}`} />
            <div style={{ fontSize: 12.5, color: '#333333', ...MONO }}>
                Spend pacing by Channel and by Micromarket/Cluster, broken into a daily run-rate view: how much
                should be spent by today, what&apos;s actually gone out (through yesterday — today&apos;s row is
                excluded since the spend sheet is pre-filled for the whole quarter), and how many more days the
                remaining budget lasts at the last 7 days&apos; pace. Always the full reporting quarter; this tab
                has no time filter.
            </div>

            <ChartCard title="Budget Pacing by Channel" height="auto">
                <BudgetPacingDetailTable data={data.byChannel} rowLabelHeader="Channel" />
            </ChartCard>

            <ChartCard title="Budget Pacing by Micromarket / Cluster" height="auto">
                <BudgetPacingDetailTable data={data.byMicromarket} rowLabelHeader="Micromarket / Cluster" />
            </ChartCard>
        </div>
    )
}
