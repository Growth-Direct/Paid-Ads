interface Props {
    label: string
    color: string
    bg: string
}

export default function StatusBadge({ label, color, bg }: Props) {
    return (
        <span
            style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 7,
                padding: '5px 11px',
                borderRadius: 99,
                fontSize: 12.5,
                fontWeight: 600,
                background: bg,
                color,
            }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: color }} />
            {label}
        </span>
    )
}
