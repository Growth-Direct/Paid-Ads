import { withSentryConfig } from '@sentry/nextjs'
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
    serverExternalPackages: ['@upstash/redis'],
}

export default withSentryConfig(nextConfig, {
    org: 'truva',
    project: 'growth-reporting',
    authToken: process.env.SENTRY_AUTH_TOKEN,
    silent: !process.env.CI,
    widenClientFileUpload: false,
    sourcemaps: {
        disable: true,
        deleteSourcemapsAfterUpload: true,
    },
    disableLogger: true,
})
