'use client'

// The filter row. Micromarket and the TQ scope, plus the grain switch.
//
// The TQ control is not a client-side filter like the others: `All` changes which societies growth
// is asked for, because a society that is not Truva-Qualified is absent from the response
// entirely, and filtering rows that were never sent would silently do nothing.
//
// Two options, not three. A "mixed only" scope was here briefly and pulled: a mixed federation is
// a caveat about a row, not a population anyone reports on, and it is already called out where it
// matters — the MIXED TQ badge on the row and the note under the coverage strip.

export type TqScope = 'tq' | 'all'

export const TQ_SCOPE_LABEL: Record<TqScope, string> = {
    tq: 'TQ only',
    all: 'All',
}

/** Every TQ standing truiq holds, for the `all` scope. */
export const ALL_TQ_STANDINGS = [
    'YES',
    'NO',
    'CHECK_PENDING',
    'CERTAIN_LAYOUTS',
    'BUILDER_INVENTORY',
    'UNDER_CONSTRUCTION',
    'EXPLORE_LATER',
]

const SELECT: React.CSSProperties = {
    background: '#fbf9f4',
    border: '1px solid #e2ddd7',
    borderRadius: 8,
    padding: '6px 10px',
    fontSize: 13,
    fontFamily: 'inherit',
    color: '#23211e',
    cursor: 'pointer',
    maxWidth: 220,
}

const LABEL: React.CSSProperties = {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 10,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    color: '#9a948a',
    marginBottom: 5,
    display: 'block',
}

interface Props {
    grain: 'federation' | 'society'
    onGrain: (g: 'federation' | 'society') => void
    micromarket: string
    onMicromarket: (m: string) => void
    micromarkets: string[]
    tqScope: TqScope
    onTqScope: (s: TqScope) => void
}

export default function ProcurementFilters({
    grain,
    onGrain,
    micromarket,
    onMicromarket,
    micromarkets,
    tqScope,
    onTqScope,
}: Props) {
    return (
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
            <div>
                <label style={LABEL}>Grain</label>
                <select value={grain} onChange={(e) => onGrain(e.target.value as 'federation' | 'society')} style={SELECT}>
                    <option value="federation">By federation</option>
                    <option value="society">By society</option>
                </select>
            </div>
            <div>
                <label style={LABEL}>Micromarket</label>
                <select value={micromarket} onChange={(e) => onMicromarket(e.target.value)} style={SELECT}>
                    <option value="">All micromarkets</option>
                    {micromarkets.map((m) => (
                        <option key={m} value={m}>
                            {m}
                        </option>
                    ))}
                </select>
            </div>
            <div>
                <label style={LABEL}>TQ scope</label>
                <select value={tqScope} onChange={(e) => onTqScope(e.target.value as TqScope)} style={SELECT}>
                    <option value="tq">{TQ_SCOPE_LABEL.tq}</option>
                    <option value="all">{TQ_SCOPE_LABEL.all}</option>
                </select>
            </div>
        </div>
    )
}
