export default function ZohoLink({ href, size = 12 }: { href: string; size?: number }) {
    return (
        <a
            href={href}
            target="_blank"
            rel="noopener"
            title="Open in Zoho CRM"
            onClick={(e) => e.stopPropagation()}
            style={{ flexShrink: 0, display: 'inline-flex', color: '#bdb6aa', textDecoration: 'none' }}>
            <svg width={size} height={size} viewBox="0 0 14 14" fill="none">
                <path
                    d="M5.5 2.5H11.5V8.5"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                />
                <path
                    d="M11.5 2.5L3 11"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                />
            </svg>
        </a>
    )
}
