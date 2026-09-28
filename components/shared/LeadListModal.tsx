'use client'

import ZohoLink from '@/components/shared/ZohoLink'
import { useEffect } from 'react'

export interface LeadListItem {
    id: string
    name: string
    status: string
    source: string
    createdAt: string
}

interface Props {
    title: string
    subtitle?: string
    leads: LeadListItem[]
    onClose: () => void
    /** Zoho module the deep link points at. Defaults to Leads (buyer); the seller tab passes
     *  'Sellers'. Non-breaking for existing callers. */
    zohoModule?: string
}

function fmtDate(iso: string): string {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return '—'
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function LeadListModal({ title, subtitle, leads, onClose, zohoModule = 'Leads' }: Props) {
    useEffect(() => {
        function onKey(e: KeyboardEvent) {
            if (e.key === 'Escape') onClose()
        }
        document.addEventListener('keydown', onKey)
        return () => document.removeEventListener('keydown', onKey)
    }, [onClose])

    return (
        <div
            onClick={onClose}
            style={{
                position: 'fixed',
                inset: 0,
                background: 'rgba(30, 27, 21, 0.4)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 200,
                padding: 24,
            }}>
            <div
                onClick={(e) => e.stopPropagation()}
                style={{
                    background: '#fff',
                    borderRadius: 14,
                    width: '100%',
                    maxWidth: 640,
                    maxHeight: '80vh',
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'hidden',
                    boxShadow: '0 12px 48px rgba(0,0,0,0.18)',
                }}>
                <div
                    style={{
                        padding: '18px 22px',
                        borderBottom: '1px solid #eee8dd',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                    }}>
                    <div>
                        <div style={{ fontSize: 15, fontWeight: 700, color: '#23211e' }}>{title}</div>
                        {subtitle && <div style={{ fontSize: 12, color: '#9a948a', marginTop: 2 }}>{subtitle}</div>}
                    </div>
                    <button
                        onClick={onClose}
                        style={{
                            border: 'none',
                            background: 'none',
                            cursor: 'pointer',
                            fontSize: 18,
                            color: '#9a948a',
                            lineHeight: 1,
                            padding: 4,
                        }}
                        aria-label="Close">
                        ×
                    </button>
                </div>

                <div style={{ overflowY: 'auto', padding: '6px 0' }}>
                    {leads.length === 0 ? (
                        <div style={{ padding: '32px 22px', textAlign: 'center', color: '#b3ada2', fontSize: 13 }}>
                            No leads in this bucket
                        </div>
                    ) : (
                        leads.map((l) => (
                            <div
                                key={l.id}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    gap: 12,
                                    padding: '10px 22px',
                                    borderBottom: '1px solid #f4f1ea',
                                }}>
                                <div style={{ minWidth: 0, flex: 1 }}>
                                    <div
                                        style={{
                                            fontSize: 13,
                                            fontWeight: 600,
                                            color: '#23211e',
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            whiteSpace: 'nowrap',
                                        }}>
                                        {l.name || '—'}
                                    </div>
                                    <div style={{ fontSize: 11.5, color: '#9a948a', marginTop: 2 }}>
                                        {l.source} · {l.status} · {fmtDate(l.createdAt)}
                                    </div>
                                </div>
                                <ZohoLink href={`https://crm.zoho.in/crm/tab/${zohoModule}/${l.id}`} />
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    )
}
