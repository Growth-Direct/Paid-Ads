'use client'

import { useEffect, useRef, useState } from 'react'

// The filter-bar building blocks, shared by the buyer and seller tabs. These started as
// private components inside components/buyer/FilterBar.tsx and were duplicated into the
// seller bar; they live here so the two bars cannot drift apart visually or behaviourally.
// Nothing in here knows about leads, sellers, channels or micromarkets — they take
// OptionGroup-shaped data and report toggles back.

export const MONO = "'IBM Plex Mono', monospace"

export interface Option {
    id: string
    label: string
}

export interface OptionGroup extends Option {
    children: Option[]
}

export const dateInputStyle: React.CSSProperties = {
    flex: 1,
    minWidth: 0,
    padding: '5px 6px',
    borderRadius: 6,
    border: '1px solid #CCCCCC',
    background: '#fff',
    fontFamily: MONO,
    fontSize: 11,
    color: '#000000',
}

function Chevron() {
    return (
        <svg width="9" height="6" viewBox="0 0 9 6" fill="none" style={{ opacity: 0.5 }}>
            <path d="M1 1l3.5 3.5L8 1" stroke="currentColor" strokeWidth="1.3" fill="none" />
        </svg>
    )
}

export function Dropdown({
    label,
    summary,
    active,
    width = 260,
    footer,
    children,
}: {
    label: string
    summary: string
    active: boolean
    width?: number
    footer?: React.ReactNode
    children: React.ReactNode
}) {
    const [open, setOpen] = useState(false)
    const ref = useRef<HTMLDivElement>(null)

    useEffect(() => {
        if (!open) return
        const onDown = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
        }
        const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
        document.addEventListener('mousedown', onDown)
        document.addEventListener('keydown', onKey)
        return () => {
            document.removeEventListener('mousedown', onDown)
            document.removeEventListener('keydown', onKey)
        }
    }, [open])

    return (
        <div ref={ref} style={{ position: 'relative' }}>
            <button
                onClick={() => setOpen((o) => !o)}
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '7px 11px',
                    borderRadius: 8,
                    border: `1px solid ${active ? '#0067FF' : '#CCCCCC'}`,
                    background: active ? '#E6F0FF' : '#FFFFFF',
                    color: active ? '#0067FF' : '#333333',
                    fontFamily: MONO,
                    fontSize: 11.5,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                }}>
                <span style={{ opacity: 0.65 }}>{label}</span>
                <strong style={{ fontWeight: 500 }}>{summary}</strong>
                <Chevron />
            </button>
            {open && (
                <div
                    style={{
                        position: 'absolute',
                        top: 'calc(100% + 6px)',
                        left: 0,
                        zIndex: 40,
                        width,
                        maxWidth: '92vw',
                        background: '#FFFFFF',
                        border: '1px solid #CCCCCC',
                        borderRadius: 10,
                        boxShadow: '0 8px 28px rgba(0,0,0,0.10)',
                        display: 'flex',
                        flexDirection: 'column',
                        maxHeight: 440,
                        overflow: 'hidden',
                    }}>
                    <div style={{ overflowY: 'auto', padding: 8, flex: 1, minHeight: 0 }}>{children}</div>
                    {footer && (
                        <div style={{ borderTop: '1px solid #CCCCCC', padding: 8, background: '#FFFFFF', flexShrink: 0 }}>
                            {footer}
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}

export function Row({
    label,
    checked,
    indeterminate,
    indent,
    bold,
    onToggle,
}: {
    label: string
    checked: boolean
    indeterminate?: boolean
    indent?: boolean
    bold?: boolean
    onToggle: () => void
}) {
    const box = useRef<HTMLInputElement>(null)
    useEffect(() => {
        if (box.current) box.current.indeterminate = !!indeterminate && !checked
    }, [indeterminate, checked])

    return (
        <label
            style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: `5px 8px 5px ${indent ? 26 : 8}px`,
                borderRadius: 6,
                cursor: 'pointer',
                fontFamily: MONO,
                fontSize: 11.5,
                color: bold ? '#000000' : '#333333',
                fontWeight: bold ? 500 : 400,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = '#F5F5F5')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
            <input ref={box} type="checkbox" checked={checked} onChange={onToggle} style={{ accentColor: '#0067FF' }} />
            <span style={{ flex: 1 }}>{label}</span>
        </label>
    )
}

/** Nested group + children list with tri-state parents. Selecting a parent selects all
 *  of its children; the parent shows indeterminate when only some are picked. */
export function NestedList({
    groups,
    selectedParents,
    selectedChildren,
    onChange,
}: {
    groups: OptionGroup[]
    selectedParents: string[]
    selectedChildren: string[]
    onChange: (parents: string[], children: string[]) => void
}) {
    const toggleParent = (g: OptionGroup) => {
        const on = selectedParents.includes(g.id)
        const childIds = g.children.map((c) => c.id)
        onChange(
            on ? selectedParents.filter((p) => p !== g.id) : [...selectedParents, g.id],
            on
                ? selectedChildren.filter((c) => !childIds.includes(c))
                : [...new Set([...selectedChildren, ...childIds])]
        )
    }
    // Checking every child never implicitly checks the parent. Cluster/channel and
    // micromarket/source are independent dimensions on a record (a Paid Ads lead's
    // micromarket comes from UTM_Micromarket, its cluster from Truva_Cluster — the two
    // don't always agree), so picking every micromarket under a cluster is NOT the same
    // filter as picking that cluster, and must not silently add the extra constraint.
    const toggleChild = (id: string) => {
        const on = selectedChildren.includes(id)
        const next = on ? selectedChildren.filter((c) => c !== id) : [...selectedChildren, id]
        onChange(selectedParents, next)
    }

    return (
        <>
            {groups.map((g) => {
                const childIds = g.children.map((c) => c.id)
                const some = childIds.some((c) => selectedChildren.includes(c))
                return (
                    <div key={g.id}>
                        <Row
                            label={g.label}
                            bold
                            checked={selectedParents.includes(g.id)}
                            indeterminate={some}
                            onToggle={() => toggleParent(g)}
                        />
                        {g.children.map((c) => (
                            <Row
                                key={c.id}
                                label={c.label}
                                indent
                                checked={selectedChildren.includes(c.id)}
                                onToggle={() => toggleChild(c.id)}
                            />
                        ))}
                    </div>
                )
            })}
        </>
    )
}

export function Pill({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) {
    return (
        <button
            onClick={onClick}
            style={{
                padding: '5px 10px',
                borderRadius: 999,
                border: `1px solid ${selected ? '#0067FF' : '#CCCCCC'}`,
                background: selected ? '#0067FF' : '#FFFFFF',
                color: selected ? '#fff' : '#333333',
                fontFamily: MONO,
                fontSize: 11,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
            }}>
            {label}
        </button>
    )
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
    return (
        <div
            style={{
                padding: '8px 8px 4px',
                fontFamily: MONO,
                fontSize: 9.5,
                letterSpacing: '0.09em',
                textTransform: 'uppercase',
                color: '#666666',
            }}>
            {children}
        </div>
    )
}
