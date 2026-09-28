'use client'

import { useUser } from '@auth0/nextjs-auth0'
import * as Sentry from '@sentry/nextjs'
import { useEffect } from 'react'

/**
 * Invisible component that syncs the Auth0 user to Sentry's client-side scope.
 * Place inside <Auth0Provider> so useUser() has access to the session.
 */
export default function SentryUserIdentifier() {
    const { user } = useUser()

    useEffect(() => {
        if (user) {
            const allowedMethods: string[] = (user.allowed_http_methods as string[]) ?? []

            Sentry.setUser({
                id: user.sub ?? undefined,
                email: user.email ?? undefined,
                username: user.name ?? undefined,
                ip_address: '{{auto}}',
            })

            const allowedPages: string[] = (user.allowed_pages as string[]) ?? []

            Sentry.setTags({
                'user.auth_method': 'auth0',
                'user.id': user.sub ?? 'unknown',
                'user.email': user.email ?? 'unknown',
                'user.name': user.name ?? 'unknown',
                'user.allowed_http_methods': allowedMethods.join(','),
                'user.allowed_pages': allowedPages.join(','),
            })
        } else {
            Sentry.setUser(null)
        }
    }, [user])

    return null
}
