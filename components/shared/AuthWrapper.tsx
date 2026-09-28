import LoginScreen from '@/components/shared/LoginScreen'
import { Auth0Provider } from '@auth0/nextjs-auth0'
import { auth0 } from '@/lib/auth0/Auth0Client'
import SentryUserIdentifier from '@/components/shared/SentryUserIdentifier'

const AuthWrapper = async ({ children }: { children: React.ReactNode }) => {
    // Local preview only — skips the real Auth0 session check so the app is viewable
    // without configuring a growth-reporting Auth0 app yet. Never true outside local dev.
    if (process.env.NODE_ENV === 'development' && process.env.LOCAL_PREVIEW_SKIP_AUTH === 'true') {
        return <body>{children}</body>
    }

    let session = null
    try {
        session = await auth0.getSession()
    } catch (error) {
        console.error('[AuthWrapper] Failed to decrypt session cookie:', error)
    }

    if (!session) {
        return (
            <body>
                <LoginScreen />
            </body>
        )
    }

    return (
        <Auth0Provider user={session?.user}>
            <SentryUserIdentifier />
            {children}
        </Auth0Provider>
    )
}

export default AuthWrapper
