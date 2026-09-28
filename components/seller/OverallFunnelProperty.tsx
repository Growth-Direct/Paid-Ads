'use client'

import type { SellerOverallFunnelPropertyData } from '@/lib/seller/types'
import { FloatLink, FloatNode, FunnelNodeBox, LOWER_Y, MONO, Ribbon, SY, UPPER_Y, VBH, VBW, VisitsConvergence, XS, type FNode, type Rate } from './funnelShared'

// "Overall Funnel (Unique Property)" — the property-level twin of components/seller/
// OverallFunnel.tsx ("Overall Funnel (Unique Seller)"), sharing its ribbon/node/float visual
// system via ./funnelShared. Every node here counts PROPERTIES, not deduped to one per seller —
// a seller with two converted properties counts twice, unlike the Unique Seller funnel, where
// that same seller counts once. Both funnels legitimately disagree by construction; neither is
// "more correct", they answer different questions ("how many sellers converted" vs "how many
// properties converted").
//
// There's no property-level equivalent of a "lead" (a lead is a person, not a property), so both
// funnels share the identical first node, Unique Leads, and only diverge starting at the second
// node: Qualified Property Leads (every property, any Acq_Status, belonging to a seller who
// qualified this window) instead of Qualified Leads. From there it forks the same way — New/Old
// Property Visits (the three-case-rule qualifying count, per property) -> New/Old Property
// Conversions (MoU Signed, per property) -> Total Property Conversions.
//
// The Leads -> Qualified Property Leads ribbon has no named rate label (just the percentage) —
// there's no established term for "properties per lead" the way LTQL/QLTV are, so it's left
// unlabeled rather than inventing one. It also carries its own "Total Conversions (Channel
// Partner + Direct)" float, same treatment and same numbers as the Unique Seller funnel's
// (directConversionsTotal is already property-level/undeduped) — added 2026-09-22 per an
// explicit growth-team request. Every target on this funnel (see lib/seller/types.ts's
// SellerOverallFunnelPropertyData) is the SAME value the Unique Seller funnel uses for its
// corresponding node/rate, reused directly rather than recomputed — also per that request.

export default function OverallFunnelProperty({ data, expectedPct }: { data: SellerOverallFunnelPropertyData; expectedPct: number }) {
    const leads: FNode = { key: 'leads', label: 'Unique Leads', x: XS[0]!, y: SY, actual: data.uniqueLeads.actual, target: data.uniqueLeads.target }
    const qualified: FNode = {
        key: 'qualified',
        label: 'Qualified Property Leads',
        x: XS[1]!,
        y: SY,
        actual: data.qualifiedProperties.actual,
        target: data.qualifiedProperties.target,
    }
    const newVisits: FNode = {
        key: 'newVisits',
        label: 'New Property Visits',
        x: XS[2]!,
        y: UPPER_Y,
        actual: data.newVisits.actual,
        target: data.newVisits.target,
    }
    const oldVisits: FNode = {
        key: 'oldVisits',
        label: 'Old Property Visits',
        x: XS[2]!,
        y: LOWER_Y,
        actual: data.oldVisits.actual,
        target: data.oldVisits.target,
    }
    const newConv: FNode = {
        key: 'newConv',
        label: 'New Property Conversions',
        x: XS[3]!,
        y: UPPER_Y,
        actual: data.newConversions.actual,
        target: data.newConversions.target,
    }
    const oldConv: FNode = {
        key: 'oldConv',
        label: 'Old Property Conversions',
        x: XS[3]!,
        y: LOWER_Y,
        actual: data.oldConversions.actual,
        target: data.oldConversions.target,
    }
    const totalConv: FNode = {
        key: 'totalConv',
        label: 'Total Property Conversions',
        x: XS[4]!,
        y: SY,
        actual: data.totalConversions.actual,
        target: data.totalConversions.target,
    }
    const nodes = [leads, qualified, newVisits, oldVisits, newConv, oldConv, totalConv]

    const ribbons: Array<{ from: FNode; to: FNode; rate?: Rate }> = [
        { from: leads, to: qualified, rate: { label: null, achieved: data.qualPct, target: data.qualTarget, side: 'above' } },
        { from: qualified, to: newVisits, rate: { label: null, achieved: data.newVisitPct, target: data.newVisitTarget, side: 'above' } },
        { from: qualified, to: oldVisits, rate: { label: null, achieved: data.oldVisitPct, target: data.oldVisitTarget, side: 'below' } },
        { from: newVisits, to: newConv, rate: { label: 'CVR', achieved: data.newConvRatePct, target: data.newConvRateTarget, side: 'above' } },
        { from: oldVisits, to: oldConv, rate: { label: 'CVR', achieved: data.oldConvRatePct, target: data.oldConvRateTarget, side: 'below' } },
        { from: newConv, to: totalConv },
        { from: oldConv, to: totalConv },
    ]

    const maxVal = Math.max(...nodes.map((s) => s.actual ?? 0), 1)

    return (
        <svg viewBox={`0 0 ${VBW} ${VBH}`} width="100%" style={{ display: 'block', fontFamily: MONO }} role="img">
            {ribbons.map((r, i) => (
                <Ribbon key={`rib${i}`} from={r.from} to={r.to} rate={r.rate} maxVal={maxVal} />
            ))}

            <VisitsConvergence
                pipelineCount={data.pipelineCount}
                totalVisits={data.totalVisits.actual}
                sub="properties, New + Old"
                target={data.totalVisits.target}
                expectedPct={expectedPct}
            />

            {/* Total Conversions (Channel Partner + Direct) — same treatment and numbers as the
                Unique Seller funnel's own. Direct's share of it is a PART of that total, not a
                bigger reading over it, so '%' rather than 'x'. */}
            <FloatLink
                x={XS[4]!}
                topY={70}
                nodeY={totalConv.y}
                unit="%"
                ratio={
                    data.totalConversionsWithChannelPartner > 0
                        ? (data.directConversionsTotal / data.totalConversionsWithChannelPartner) * 100
                        : null
                }
            />
            <FloatNode
                cx={XS[4]!}
                cy={70}
                w={150}
                h={56}
                title="Total Conversions"
                value={data.totalConversionsWithChannelPartner}
                sub="Channel Partner + Direct"
            />

            {nodes.map((s) => (
                <FunnelNodeBox key={s.key} node={s} expectedPct={expectedPct} />
            ))}
        </svg>
    )
}
