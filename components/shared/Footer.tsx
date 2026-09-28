'use client'

import { useEffect, useState } from 'react'

const QUOTES = [
    { quote: "...when it's not your turn", character: 'McNulty' },
    { quote: "You cannot lose if you don't play", character: 'Marla Daniels' },
    { quote: 'The king stay the king', character: "D'Angelo" },
    { quote: '...and all the pieces matter', character: 'Lester' },
    { quote: 'A man must have a code', character: 'Bunk' },
    { quote: 'Come at the king, you best not miss', character: 'Omar' },
    { quote: 'All in the game...', character: 'Traditional West Baltimore' },
    { quote: "Ain't never gonna be what it was", character: 'Little Big Roy' },
    { quote: 'Business. Always business', character: 'The Greek' },
    { quote: "There's never been a paper bag", character: 'Bunny Colvin' },
    { quote: 'The Gods will not save you', character: 'Burrell' },
    { quote: 'Conscience do cost', character: 'Butchie' },
    { quote: "We ain't gotta dream no more, man", character: 'Stringer' },
    { quote: '...we fight on that lie', character: 'Slim Charles' },
    { quote: 'No one wins. One side just loses more slowly', character: 'Prez' },
    { quote: 'World going one way, people another', character: 'Poot' },
    { quote: 'The bigger the lie, the more they believe', character: 'Bunk' },
    { quote: "Deserve got nuthin' to do with it", character: 'Snoop' },
    { quote: "A lie ain't a side of the story, it's just a lie.", character: 'Terry' },
    { quote: '...the life of kings', character: 'H.L. Mencken' },
]

function formatCachedAt(iso: string): string {
    const d = new Date(iso)
    const now = new Date()
    const diffMs = now.getTime() - d.getTime()
    const diffMin = Math.floor(diffMs / 60000)

    if (diffMin < 1) return 'just now'
    if (diffMin < 60) return `${diffMin}m ago`
    const diffHr = Math.floor(diffMin / 60)
    if (diffHr < 24) return `${diffHr}h ago`
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export default function Footer({ cachedAt }: { cachedAt?: string }) {
    const [index, setIndex] = useState(0)
    const [, setTick] = useState(0)

    useEffect(() => {
        setIndex(Math.floor(Math.random() * QUOTES.length))
    }, [])

    // Re-render every 60s to keep the "ago" label fresh
    useEffect(() => {
        if (!cachedAt) return
        const timer = setInterval(() => setTick((t) => t + 1), 60000)
        return () => clearInterval(timer)
    }, [cachedAt])

    const q = QUOTES[index]!

    return (
        <footer
            style={{
                borderTop: '1px solid #e9e4db',
                padding: '16px 40px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                background: '#f4f1ea',
            }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 12, color: '#b3ada2', fontStyle: 'italic' }}>&ldquo;{q.quote}&rdquo;</span>
                <span
                    style={{
                        fontSize: 11,
                        color: '#cec8be',
                        fontFamily: "'IBM Plex Mono', monospace",
                    }}>
                    — {q.character}
                </span>
            </div>
            {cachedAt && (
                <span
                    style={{
                        fontSize: 11,
                        color: '#b3ada2',
                        fontFamily: "'IBM Plex Mono', monospace",
                    }}>
                    data refreshed {formatCachedAt(cachedAt)}
                </span>
            )}
        </footer>
    )
}
