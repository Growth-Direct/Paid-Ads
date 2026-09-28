import type { Metadata } from 'next'
import React from 'react'
import './globals.css'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
    title: 'Growth Reporting · Truva',
    description: 'Growth analytics dashboard for Truva',
    icons: {
        icon: '/favicon.svg',
    },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="en" suppressHydrationWarning>
            <head>
                <link rel="preconnect" href="https://fonts.googleapis.com" />
                <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
                <link
                    href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap"
                    rel="stylesheet"
                />
            </head>
            <body>{children}</body>
        </html>
    )
}
