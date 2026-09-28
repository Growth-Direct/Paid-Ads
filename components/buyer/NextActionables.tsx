'use client'

import { ACTIONABLE_CHANNELS } from '@/lib/buyer/actionables'
import { relativeTime } from '@/lib/shared/relativeTime'
import { useEffect, useState } from 'react'

type Status = 'loading' | 'idle' | 'saving' | 'error'

const MONO = { fontFamily: "'IBM Plex Mono', monospace" } as const

// Shared across every viewer — see lib/buyer/actionables.ts and app/api/buyer/actionables/route.ts.
// One row per channel (the 6 real ones, no Unmapped), an explicit Save button rather than
// autosave-on-keystroke, so drafting mid-sentence never writes a half-finished thought over
// what a teammate already saved.
export default function NextActionables() {
    const [status, setStatus] = useState<Status>('loading')
    const [byChannel, setByChannel] = useState<Record<string, string>>({})
    const [savedByChannel, setSavedByChannel] = useState<Record<string, string>>({})
    const [updatedAt, setUpdatedAt] = useState<string | null>(null)

    useEffect(() => {
        let cancelled = false
        fetch('/api/buyer/actionables')
            .then((r) => r.json())
            .then((data: { byChannel?: Record<string, string>; updatedAt?: string | null }) => {
                if (cancelled) return
                setByChannel(data.byChannel ?? {})
                setSavedByChannel(data.byChannel ?? {})
                setUpdatedAt(data.updatedAt ?? null)
                setStatus('idle')
            })
            .catch(() => {
                if (!cancelled) setStatus('error')
            })
        return () => {
            cancelled = true
        }
    }, [])

    async function save() {
        setStatus('saving')
        try {
            const res = await fetch('/api/buyer/actionables', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ byChannel }),
            })
            if (!res.ok) throw new Error('save failed')
            const data: { byChannel?: Record<string, string>; updatedAt?: string | null } = await res.json()
            setSavedByChannel(data.byChannel ?? byChannel)
            setUpdatedAt(data.updatedAt ?? null)
            setStatus('idle')
        } catch {
            setStatus('error')
        }
    }

    const dirty = ACTIONABLE_CHANNELS.some((c) => (byChannel[c] ?? '') !== (savedByChannel[c] ?? ''))

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {ACTIONABLE_CHANNELS.map((channel) => (
                    <div key={channel} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div style={{ width: 240, flexShrink: 0, fontSize: 12, color: '#6b655c', ...MONO }}>{channel}</div>
                        <input
                            type="text"
                            value={byChannel[channel] ?? ''}
                            onChange={(e) => setByChannel((prev) => ({ ...prev, [channel]: e.target.value }))}
                            placeholder="What needs doing over the next two weeks?"
                            disabled={status === 'loading'}
                            style={{
                                flex: 1,
                                padding: '7px 10px',
                                fontSize: 13,
                                color: '#3a3630',
                                background: '#fff',
                                border: '1px solid #e9e4db',
                                borderRadius: 6,
                                ...MONO,
                            }}
                        />
                    </div>
                ))}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <button
                    onClick={save}
                    disabled={status === 'saving' || status === 'loading' || !dirty}
                    style={{
                        padding: '6px 16px',
                        fontSize: 12.5,
                        fontWeight: 600,
                        color: dirty ? '#fbf9f4' : '#9a948a',
                        background: dirty ? '#3a7d5d' : '#efe9e0',
                        border: 'none',
                        borderRadius: 6,
                        cursor: dirty && status !== 'saving' ? 'pointer' : 'default',
                        ...MONO,
                    }}>
                    {status === 'saving' ? 'Saving…' : 'Save'}
                </button>
                <span style={{ fontSize: 11.5, color: status === 'error' ? '#c7533e' : '#9a948a', ...MONO }}>
                    {status === 'error'
                        ? 'Could not save — try again'
                        : dirty
                          ? 'Unsaved changes'
                          : updatedAt
                            ? `Saved ${relativeTime(updatedAt)}`
                            : 'Not saved yet'}
                </span>
            </div>
        </div>
    )
}
