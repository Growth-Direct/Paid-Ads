'use client'

import { useEffect } from 'react'

const SESSION_EXPIRED_HEADER = 'x-session-expired'

export function SessionGuard() {
    useEffect(() => {
        const originalFetch = window.fetch

        window.fetch = async (...args: Parameters<typeof fetch>) => {
            const response = await originalFetch(...args)

            if (response.status === 401 && response.headers.get(SESSION_EXPIRED_HEADER) === 'true') {
                const loginUrl =
                    response.headers.get('x-login-url') ||
                    process.env.NEXT_PUBLIC_AUTH0_LOGIN ||
                    '/api/unprotected/auth/login'
                const returnTo = window.location.pathname + window.location.search
                window.location.href = `${loginUrl}?returnTo=${encodeURIComponent(returnTo)}`
                return new Promise<Response>(() => {})
            }

            return response
        }

        return () => {
            window.fetch = originalFetch
        }
    }, [])

    return null
}
