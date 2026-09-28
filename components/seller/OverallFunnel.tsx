'use client'

import type { SellerOverallFunnelData } from '@/lib/seller/types'
import { FloatLink, FloatNode, FunnelNodeBox, LOWER_Y, MONO, Ribbon, SY, UPPER_Y, VBH, VBW, VisitsConvergence, XS, type FNode, type Rate } from './funnelShared'

// "Overall Funnel (Unique Seller)" — every node is a distinct seller (visits: >=1 qualifying
// property; conversions: >=1 converted property), so the same seller with two converted
// properties still counts once. Forks after Qualified Leads into a New arm (above the center
// line) and an Old arm (below it), each carrying its own Visits -> Conversions, recombining into
// one Total Conversions node. The arms are unconditional — always both cohorts, regardless of
// the Visits/Conversions scope pills, the same way the Target vs Achieved table's New/Old rows
// already work. See lib/seller/types.ts's SellerOverallFunnelData doc comment.
//
// Its property-level twin, components/seller/OverallFunnelProperty.tsx, shares this file's
// ribbon/node/float visual system via ./funnelShared but counts every qualifying PROPERTY, not
// deduped to one per seller — a seller with two converted properties counts twice there. See
// that file for why the two funnels' numbers can legitimately disagree.
//
// A "Total Conversions (Channel Partner + Direct)" float still sits above the final merged node
// — a different (sourcing-side) axis, unrelated to the New/Old split, unique to this funnel (the
// property funnel has no per-property Channel Partner reading).

export default function OverallFunnel({ data, expectedPct }: { data: SellerOverallFunnelData; expectedPct: number }) {
    const leads: FNode = { key: 'leads', label: 'Unique Leads', x: XS[0]!, y: SY, actual: data.uniqueLeads.actual, target: data.uniqueLeads.target }
    const qualified: FNode = { key: 'qualified', label: 'Qualified Leads', x: XS[1]!, y: SY, actual: data.qualified.actual, target: data.qualified.target }
    const newVisits: FNode = {
        key: 'newVisits',
        label: 'New Visits',
        x: XS[2]!,
        y: UPPER_Y,
        actual: data.newVisits.actual,
        target: data.newVisits.target,
    }
    const oldVisits: FNode = {
        key: 'oldVisits',
        label: 'Old Visits',
        x: XS[2]!,
        y: LOWER_Y,
        actual: data.oldVisits.actual,
        target: data.oldVisits.target,
    }
    const newConv: FNode = {
        key: 'newConv',
        label: 'New Conversions',
        x: XS[3]!,
        y: UPPER_Y,
        actual: data.newConversions.actual,
        target: data.newConversions.target,
    }
    const oldConv: FNode = {
        key: 'oldConv',
        label: 'Old Conversions',
        x: XS[3]!,
        y: LOWER_Y,
        actual: data.oldConversions.actual,
        target: data.oldConversions.target,
    }
    const totalConv: FNode = {
        key: 'totalConv',
        label: 'Total Conversions',
        x: XS[4]!,
        y: SY,
        actual: data.totalConversions.actual,
        target: data.totalConversions.target,
    }
    const nodes = [leads, qualified, newVisits, oldVisits, newConv, oldConv, totalConv]

    const ribbons: Array<{ from: FNode; to: FNode; rate?: Rate }> = [
        { from: leads, to: qualified, rate: { label: 'LTQL', achieved: data.ltqlPct, target: data.ltqlTarget, side: 'above' } },
        { from: qualified, to: newVisits, rate: { label: 'QLTV', achieved: data.newQltvPct, target: data.newQltvTarget, side: 'above' } },
        { from: qualified, to: oldVisits, rate: { label: 'QLTV', achieved: data.oldQltvPct, target: data.oldQltvTarget, side: 'below' } },
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
                sub="unique sellers, New + Old"
                target={data.totalVisits.target}
                expectedPct={expectedPct}
            />

            {/* Total Conversions (Channel Partner + Direct) — the only reading anywhere on this
                dashboard that adds Channel Partner-sourced sellers back in. Direct's share of it
                is a PART of that total, not a bigger reading over it, so '%' rather than 'x'. */}
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
