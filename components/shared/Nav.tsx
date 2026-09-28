'use client'

import { useUser } from '@auth0/nextjs-auth0'
import { useEffect, useRef, useState } from 'react'

export type NavView = 'buyer' | 'seller' | 'budget'

interface NavProps {
    activeView: NavView
    onViewChange: (view: NavView) => void
}

const tabs: { key: NavView; label: string }[] = [
    { key: 'buyer', label: 'Buyer' },
    { key: 'seller', label: 'Seller' },
    { key: 'budget', label: 'Budget Pacing' },
]

export default function Nav({ activeView, onViewChange }: NavProps) {
    const { user } = useUser()
    const [menuOpen, setMenuOpen] = useState(false)
    const menuRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        function handleClick(e: MouseEvent) {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                setMenuOpen(false)
            }
        }
        document.addEventListener('mousedown', handleClick)
        return () => document.removeEventListener('mousedown', handleClick)
    }, [])

    const initials = user?.name
        ? user.name
              .split(' ')
              .map((w: string) => w[0])
              .slice(0, 2)
              .join('')
              .toUpperCase()
        : '?'

    return (
        <div
            style={{
                borderBottom: '1px solid #CCCCCC',
                background: '#FFFFFF',
                position: 'sticky',
                top: 0,
                zIndex: 50,
            }}>
            <div
                style={{
                    maxWidth: 1280,
                    margin: '0 auto',
                    padding: '16px 40px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <img src="/truva-logo-black.svg" alt="Truva" width={28} height={28} />
                        <span style={{ width: 1, height: 18, background: '#CCCCCC' }} />
                        <span
                            style={{
                                fontSize: 13,
                                fontWeight: 600,
                                letterSpacing: '0.02em',
                                color: '#000000',
                            }}>
                            Growth Reporting
                        </span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 12 }}>
                        {tabs.map((tab) => (
                            <button
                                key={tab.key}
                                onClick={() => onViewChange(tab.key)}
                                style={{
                                    background: activeView === tab.key ? '#E6F0FF' : 'none',
                                    border: activeView === tab.key ? '1px solid #0067FF' : '1px solid transparent',
                                    borderRadius: 8,
                                    padding: '6px 14px',
                                    fontSize: 13,
                                    fontWeight: activeView === tab.key ? 600 : 400,
                                    color: activeView === tab.key ? '#0067FF' : '#333333',
                                    cursor: 'pointer',
                                    fontFamily: 'inherit',
                                    transition: 'all 0.15s',
                                }}>
                                {tab.label}
                            </button>
                        ))}
                    </div>
                </div>

                <div ref={menuRef} style={{ position: 'relative' }}>
                    <button
                        onClick={() => setMenuOpen((v) => !v)}
                        style={{
                            width: 32,
                            height: 32,
                            borderRadius: '50%',
                            overflow: 'hidden',
                            background: '#F5F5F5',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0,
                            border: 'none',
                            cursor: 'pointer',
                            padding: 0,
                        }}>
                        {user?.picture ? (
                            <img
                                src={user.picture}
                                alt={(user.name as string) ?? ''}
                                width={32}
                                height={32}
                                style={{ display: 'block' }}
                                referrerPolicy="no-referrer"
                            />
                        ) : (
                            <span style={{ fontWeight: 600, color: '#333333', fontSize: 12 }}>{initials}</span>
                        )}
                    </button>

                    {menuOpen && (
                        <div
                            style={{
                                position: 'absolute',
                                top: 40,
                                right: 0,
                                background: '#fff',
                                border: '1px solid #CCCCCC',
                                borderRadius: 10,
                                boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
                                padding: '6px',
                                minWidth: 140,
                                zIndex: 100,
                            }}>
                            <a
                                href={process.env.NEXT_PUBLIC_AUTH0_LOGOUT ?? '/api/unprotected/auth/logout'}
                                style={{
                                    display: 'block',
                                    padding: '8px 14px',
                                    fontSize: 13,
                                    color: '#000000',
                                    textDecoration: 'none',
                                    borderRadius: 6,
                                    fontFamily: 'inherit',
                                }}
                                onMouseEnter={(e) => (e.currentTarget.style.background = '#F5F5F5')}
                                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
                                Sign out
                            </a>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
