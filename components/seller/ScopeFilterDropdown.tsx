'use client'

import { Dropdown, FlatSelectAllFooter, Row } from '@/components/shared/FilterControls'
import type { Scope } from '@/lib/seller/filters'

// A New/Old scope picker — shared by SellerFilterBar's page-level Visits/Conversions pills,
// PostVisitTatBar's chart-local toggle, and MicromarketStatusBar's chart-local toggle (added
// 2026-09-24 when the last of those three needed its own). Kept out of components/shared/
// FilterControls.tsx deliberately — that file is shared with the buyer tab and knows nothing
// about sellers, channels or the New/Old scope concept; this one lives seller-side instead.

export function ScopeFilterDropdown({
    label,
    scope,
    onChange,
}: {
    label: string
    scope: Scope[]
    onChange: (next: Scope[]) => void
}) {
    const summary = scope.length === 0 ? 'None' : scope.length === 2 ? 'Overall' : scope[0]!
    const toggle = (s: Scope) => onChange(scope.includes(s) ? scope.filter((x) => x !== s) : [...scope, s])
    // A non-default scope (anything other than both New and Old) marks the pill active.
    const active = scope.length !== 2
    return (
        <Dropdown
            label={label}
            summary={summary}
            active={active}
            width={180}
            footer={<FlatSelectAllFooter options={['New', 'Old']} onChange={(next) => onChange(next as Scope[])} />}>
            {(['New', 'Old'] as const).map((s) => (
                <Row key={s} label={s} checked={scope.includes(s)} onToggle={() => toggle(s)} />
            ))}
        </Dropdown>
    )
}
