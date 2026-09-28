'use client'

interface Props {
    title: string
    subtitle?: string
    /** A fixed pixel height (needed for Recharts, which measures its parent), or 'auto'
     *  to size to content — use 'auto' for tables so they don't get a few-pixel scrollbar. */
    height?: number | 'auto'
    /** When true, render a centred placeholder instead of the chart. A filter that
     *  matches no data would otherwise leave a blank white box that reads as broken. */
    empty?: boolean
    children: React.ReactNode
}

export default function ChartCard({ title, subtitle, height = 280, empty = false, children }: Props) {
    return (
        <div
            style={{
                background: '#fbf9f4',
                border: '1px solid #e9e4db',
                borderRadius: 14,
                padding: '20px 22px 16px',
            }}>
            <div style={{ marginBottom: 14 }}>
                <div
                    style={{
                        fontFamily: "'IBM Plex Mono', monospace",
                        fontSize: 11,
                        letterSpacing: '0.1em',
                        textTransform: 'uppercase',
                        color: '#9a948a',
                    }}>
                    {title}
                </div>
                {subtitle && <div style={{ fontSize: 12, color: '#b3ada2', marginTop: 4 }}>{subtitle}</div>}
            </div>
            <div style={height === 'auto' ? { minHeight: 120 } : { height }}>
                {empty ? (
                    <div
                        style={{
                            height: '100%',
                            minHeight: 120,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: '#b3ada2',
                            fontFamily: "'IBM Plex Mono', monospace",
                            fontSize: 12.5,
                        }}>
                        No data for this selection
                    </div>
                ) : (
                    children
                )}
            </div>
        </div>
    )
}
