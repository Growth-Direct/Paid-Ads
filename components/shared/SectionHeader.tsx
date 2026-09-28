'use client'

export default function SectionHeader({ title }: { title: string }) {
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <span
                style={{
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: 13,
                    fontWeight: 700,
                    letterSpacing: '0.12em',
                    textTransform: 'uppercase',
                    color: '#3a3630',
                    whiteSpace: 'nowrap',
                }}>
                {title}
            </span>
            <span style={{ flex: 1, height: 1, background: '#e0dad0' }} />
        </div>
    )
}
