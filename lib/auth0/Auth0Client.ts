import { Auth0Client } from '@auth0/nextjs-auth0/server'

export const auth0 = new Auth0Client({
    beforeSessionSaved: async (session, idToken) => {
        return {
            ...session,
            user: { ...session.user, lastValidatedAt: Date.now() },
        }
    },
    authorizationParameters: {
        connection: 'google-oauth2',
        prompt: 'login',
    },
    session: {
        inactivityDuration: 60 * 60 * 24 * 30,
        absoluteDuration: 60 * 60 * 24 * 30,
    },
    routes: {
        login: '/api/unprotected/auth/login',
        logout: '/api/unprotected/auth/logout',
        callback: '/api/unprotected/auth/callback',
        backChannelLogout: '/api/unprotected/auth/backchannel-logout',
    },
    // Single transaction mode - only one transaction cookie at a time
    enableParallelTransactions: false,
})
