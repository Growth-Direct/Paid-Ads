import { middleware as auth0Middleware } from '@/lib/auth0/middleware'

export const proxy = auth0Middleware

export const config = {
    matcher: ['/api/:path*'],
}
