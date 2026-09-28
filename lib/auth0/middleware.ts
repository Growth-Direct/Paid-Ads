import { auth0 } from '@/lib/auth0/Auth0Client'
import { sessionRevalidator } from '@/lib/auth0/SessionRevalidator'
import { setSentryUserForApiKey, setSentryUserFromSession } from '@/lib/sentry/SentryUserContext'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
    if (process.env.NODE_ENV === 'development' && process.env.LOCAL_PREVIEW_SKIP_AUTH === 'true') {
        return NextResponse.next()
    }

    if (!process.env.NEXT_PUBLIC_AUTH0_PREFIX) {
        throw new Error('NEXT_PUBLIC_AUTH0_PREFIX is not set')
    }

    if (!process.env.NEXT_PUBLIC_AUTH0_LOGIN) {
        throw new Error('NEXT_PUBLIC_AUTH0_LOGIN is not set')
    }

    try {
        const httpMethod = request.method
        const path = request.nextUrl.pathname

        if (path.startsWith(process.env.NEXT_PUBLIC_AUTH0_PREFIX)) {
            return await auth0.middleware(request)
        }

        // Allow test endpoints in development without auth
        if (process.env.NODE_ENV === 'development' && path === '/api/test') {
            return NextResponse.next()
        }

        const externalApiPath = '/api/external/'
        if (path.startsWith(externalApiPath)) {
            const externalApiKey = request.headers.get('x-external-api-key')
            if (externalApiKey) {
                if (externalApiKey === process.env.EXTERNAL_API_KEY) {
                    setSentryUserForApiKey('external-api-key')
                    return NextResponse.next()
                } else {
                    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
                }
            }
        }

        const apiKey = request.headers.get('x-api-key')
        if (apiKey) {
            if (apiKey === process.env.API_KEY) {
                setSentryUserForApiKey('api-key')
                return NextResponse.next()
            } else {
                return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
            }
        } else {
            const session = await auth0.getSession(request)
            const user = session?.user
            const email = user?.email
            const allowedHttpMethods = user?.allowed_http_methods

            if (!session || !user || !email || !allowedHttpMethods) {
                return NextResponse.json(
                    { error: 'Session expired' },
                    {
                        status: 401,
                        headers: {
                            'x-session-expired': 'true',
                            'x-login-url': process.env.NEXT_PUBLIC_AUTH0_LOGIN,
                        },
                    }
                )
            } else {
                const needsSessionUpdate = sessionRevalidator.shouldRevalidate(session)

                if (needsSessionUpdate) {
                    console.log(`[Auth0 Middleware] Session revalidation triggered for ${email}`)
                    const result = await sessionRevalidator.revalidate(session)
                    if (result === 'invalid') {
                        console.log(`[Auth0 Middleware] Session invalidated for ${email} — forcing re-login`)
                        return NextResponse.json(
                            { error: 'Session expired' },
                            {
                                status: 401,
                                headers: {
                                    'x-session-expired': 'true',
                                    'x-login-url': process.env.NEXT_PUBLIC_AUTH0_LOGIN,
                                },
                            }
                        )
                    }
                }

                await setSentryUserFromSession()
                if (!allowedHttpMethods.includes(httpMethod)) {
                    return NextResponse.json(
                        {
                            error: 'Forbidden',
                            metadata: {
                                reason: `Your account is not permitted to make ${httpMethod} requests. Allowed methods: ${allowedHttpMethods.join(', ')}.`,
                                userEmail: email,
                            },
                        },
                        { status: 403 }
                    )
                }

                const response = NextResponse.next()
                if (needsSessionUpdate) {
                    await auth0.updateSession(request, response, {
                        ...session,
                        user: { ...session.user, lastValidatedAt: Date.now() },
                    })
                    console.log(`[Auth0 Middleware] Session revalidated successfully for ${email}`)
                }
                return response
            }
        }
    } catch (error: any) {
        console.error('error in middleware', error)
        const isSessionError =
            error?.code === 'ERR_JWE_DECRYPTION_FAILED' ||
            error?.message?.toLowerCase()?.includes('decrypt') ||
            error?.message?.toLowerCase()?.includes('session')
        if (isSessionError) {
            return NextResponse.redirect(new URL(process.env.NEXT_PUBLIC_AUTH0_LOGIN!, request.url))
        }
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
    }
}

export const config = {
    // Never add the /monitoring path to the matcher as it will prevent
    // the sentry monitoring from working on frontend
    matcher: ['/api/:path*'],
}
