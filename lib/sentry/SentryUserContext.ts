import * as Sentry from '@sentry/nextjs'
import { auth0 } from '../auth0/Auth0Client'

/**
 * Reads the Auth0 session and sets Sentry user context and
 * filterable tags. Safe to call in any runtime — silently no-ops
 * if no session is available (e.g. API-key authenticated requests).
 */
export async function setSentryUserFromSession(): Promise<void> {
    try {
        const session = await auth0.getSession()
        if (session?.user) {
            const allowedMethods: string[] = session.user.allowed_http_methods ?? []

            Sentry.setUser({
                id: session.user.sub,
                email: session.user.email,
                username: session.user.name,
                ip_address: '{{auto}}',
            })

            Sentry.setTags({
                'user.auth_method': 'auth0',
                'user.id': session.user.sub,
                'user.email': session.user.email,
                'user.name': session.user.name,
                'user.allowed_http_methods': allowedMethods.join(','),
                'user.allowed_pages': (session.user.allowed_pages ?? []).join(','),
            })
        }
    } catch {
        // No session available (e.g. API-key request, or edge runtime
        // where cookies aren't accessible). Leave Sentry user unset.
    }
}

/**
 * Sets Sentry user context and tags for API-key authenticated requests
 * where there is no Auth0 session.
 */
export function setSentryUserForApiKey(keyType: 'api-key' | 'external-api-key'): void {
    Sentry.setUser({
        username: `api-user:${keyType}`,
        ip_address: '{{auto}}',
    })

    Sentry.setTags({
        'user.auth_method': keyType,
        'user.role': 'api-user',
    })
}
