import * as Sentry from '@sentry/nextjs'

Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

    _experiments: { enableMetrics: true },

    integrations: [
        Sentry.httpIntegration(),
        Sentry.consoleIntegration(),
        Sentry.linkedErrorsIntegration(),
        Sentry.contextLinesIntegration(),
    ],

    tracesSampleRate: 0,

    debug: false,

    sendDefaultPii: true,

    normalizeDepth: Infinity,

    normalizeMaxBreadth: Infinity,

    enabled:
        process.env.NEXT_PUBLIC_NEXT_CURRENT_ENV === 'production' ||
        process.env.NEXT_PUBLIC_NEXT_CURRENT_ENV === 'staging',
    environment: process.env.NEXT_PUBLIC_NEXT_CURRENT_ENV,
})
