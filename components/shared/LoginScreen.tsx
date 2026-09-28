const MONO = "'IBM Plex Mono', monospace"

export default function LoginScreen() {
    return (
        <div
            style={{
                height: '100dvh',
                width: '100vw',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                background: '#fdfbf6',
            }}>
            <img src="/truva-logo-black.svg" alt="Truva" width={40} height={40} style={{ marginBottom: 28 }} />

            <h1
                style={{
                    fontSize: 34,
                    fontWeight: 700,
                    letterSpacing: '-0.03em',
                    color: '#23211e',
                    margin: 0,
                }}>
                Growth Reporting
            </h1>

            <p
                style={{
                    fontFamily: MONO,
                    fontSize: 11,
                    letterSpacing: '0.14em',
                    textTransform: 'uppercase',
                    color: '#9a948a',
                    margin: '12px 0 44px',
                }}>
                Buyer &amp; seller funnel &middot; live from Zoho
            </p>

            <a
                href={process.env.NEXT_PUBLIC_AUTH0_LOGIN || '/api/unprotected/auth/login'}
                style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '13px 28px',
                    borderRadius: 10,
                    background: '#23211e',
                    color: '#fdfbf6',
                    fontSize: 14,
                    fontWeight: 600,
                    textDecoration: 'none',
                    letterSpacing: '-0.01em',
                }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <path
                        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                        fill="#4285F4"
                    />
                    <path
                        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                        fill="#34A853"
                    />
                    <path
                        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                        fill="#FBBC05"
                    />
                    <path
                        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                        fill="#EA4335"
                    />
                </svg>
                Sign in with Google
            </a>

            <p
                style={{
                    fontFamily: MONO,
                    fontSize: 10,
                    color: '#bdb6aa',
                    marginTop: 32,
                    letterSpacing: '0.05em',
                }}>
                Truva employees only
            </p>
        </div>
    )
}
