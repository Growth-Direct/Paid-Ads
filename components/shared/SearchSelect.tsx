'use client'

import { useMemo, useState } from 'react'
import { MONO, type Option, Row, SectionLabel, dateInputStyle } from './FilterControls'

// A type-to-search, tick-to-select list — for a dimension too large for NestedList's plain
// checkbox tree (Campaign/Ad Set/Ad/Property can run 100+ distinct values a quarter, unlike
// the handful Cluster/Micromarket/Source ever have). Meant to be used as one of several
// stacked sections inside a single Dropdown (see FilterBar.tsx's "Attribution" dropdown),
// not as its own top-level Dropdown — hence the small internal scroll box rather than
// filling the whole panel.
//
// No external dependency: a controlled <input> filtering a plain array on every keystroke.
// Fine at this data size (hundreds of rows, not thousands); add debouncing only if that
// stops being true.

export function SearchSelect({
    label,
    options,
    selected,
    onChange,
}: {
    label: string
    options: Option[]
    selected: string[]
    onChange: (selected: string[]) => void
}) {
    const [query, setQuery] = useState('')

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase()
        if (!q) return options
        return options.filter((o) => o.label.toLowerCase().includes(q))
    }, [options, query])

    const toggle = (id: string) => {
        onChange(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id])
    }

    return (
        <div>
            <SectionLabel>
                {label}
                {selected.length > 0 ? ` — ${selected.length} selected` : ''}
            </SectionLabel>
            <div style={{ padding: '0 8px 6px' }}>
                <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={`Search ${label.toLowerCase()}…`}
                    style={{ ...dateInputStyle, width: '100%' }}
                />
            </div>
            <div style={{ maxHeight: 140, overflowY: 'auto' }}>
                {filtered.length === 0 ? (
                    <div style={{ padding: '6px 8px', fontFamily: MONO, fontSize: 11, color: '#666666' }}>No matches</div>
                ) : (
                    filtered.map((o) => (
                        <Row key={o.id} label={o.label} checked={selected.includes(o.id)} onToggle={() => toggle(o.id)} />
                    ))
                )}
            </div>
        </div>
    )
}
