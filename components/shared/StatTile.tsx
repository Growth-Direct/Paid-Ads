'use client'

interface TileProps {
    label: string
    value: React.ReactNode
    sub?: React.ReactNode
    onClick?: () => void
    /** Hover text for context that qualifies the number but should not crowd the tile. */
    hint?: string
}

export function StatTile({ label, value, sub, onClick, hint }: TileProps) {
    return (
        <div
            title={hint}
            onClick={onClick}
            style={{
                background: '#fbf9f4',
                border: '1px solid #e9e4db',
                borderRadius: 14,
                padding: '20px 22px',
                cursor: onClick ? 'pointer' : 'default',
            }}
            onMouseEnter={(e) => {
                if (onClick) {
                    e.currentTarget.style.background = '#f6f2ea'
                    e.currentTarget.style.borderColor = '#d8d1c4'
                }
            }}
            onMouseLeave={(e) => {
                e.currentTarget.style.background = '#fbf9f4'
                e.currentTarget.style.borderColor = '#e9e4db'
            }}>
            <div
                style={{
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: 11,
                    letterSpacing: '0.12em',
                    textTransform: 'uppercase',
                    color: '#9a948a',
                    marginBottom: 16,
                    height: 11,
                    display: 'flex',
                    justifyContent: 'space-between',
                }}>
                {label}
                {onClick && <span style={{ color: '#bdb6aa', letterSpacing: 0 }}>›</span>}
            </div>
            <div
                style={{
                    fontSize: 30,
                    fontWeight: 700,
                    letterSpacing: '-0.02em',
                    fontVariantNumeric: 'tabular-nums',
                    display: 'flex',
                    alignItems: 'baseline',
                    gap: 6,
                }}>
                {value}
                {sub && <span style={{ fontSize: 15, fontWeight: 500, color: '#9a948a' }}>{sub}</span>}
            </div>
        </div>
    )
}

export function StatRow({ children }: { children: React.ReactNode }) {
    return (
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(180px, 1fr))`, gap: 16, marginBottom: 14 }}>
            {children}
        </div>
    )
}
