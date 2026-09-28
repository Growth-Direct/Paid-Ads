'use client'

interface TileProps {
    label: string
    value: React.ReactNode
    sub?: React.ReactNode
    onClick?: () => void
}

export function StatTile({ label, value, sub, onClick }: TileProps) {
    return (
        <div
            onClick={onClick}
            style={{
                background: '#FFFFFF',
                border: '1px solid #CCCCCC',
                borderRadius: 14,
                padding: '20px 22px',
                cursor: onClick ? 'pointer' : 'default',
            }}
            onMouseEnter={(e) => {
                if (onClick) {
                    e.currentTarget.style.background = '#F5F5F5'
                    e.currentTarget.style.borderColor = '#999999'
                }
            }}
            onMouseLeave={(e) => {
                e.currentTarget.style.background = '#FFFFFF'
                e.currentTarget.style.borderColor = '#CCCCCC'
            }}>
            <div
                style={{
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: 11,
                    letterSpacing: '0.12em',
                    textTransform: 'uppercase',
                    color: '#333333',
                    marginBottom: 16,
                    height: 11,
                    display: 'flex',
                    justifyContent: 'space-between',
                }}>
                {label}
                {onClick && <span style={{ color: '#666666', letterSpacing: 0 }}>›</span>}
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
                {sub && <span style={{ fontSize: 15, fontWeight: 500, color: '#333333' }}>{sub}</span>}
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
