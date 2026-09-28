'use client'

import { useCallback, useEffect, useState } from 'react'

type HashParams = Record<string, string>

function parseHash(): HashParams {
    if (typeof window === 'undefined') return {}
    const hash = window.location.hash.slice(1)
    if (!hash) return {}
    const params: HashParams = {}
    for (const part of hash.split('&')) {
        const [key, val] = part.split('=')
        if (key) params[decodeURIComponent(key)] = decodeURIComponent(val ?? '')
    }
    return params
}

function writeHash(params: HashParams) {
    const parts = Object.entries(params)
        .filter(([, v]) => v !== '' && v !== undefined)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    const newHash = parts.length > 0 ? `#${parts.join('&')}` : ''
    if (window.location.hash !== newHash) {
        window.history.replaceState(null, '', newHash || window.location.pathname)
    }
}

export function useHashState(key: string, defaultValue: string): [string, (v: string) => void] {
    const [value, setValue] = useState<string>(defaultValue)

    useEffect(() => {
        const params = parseHash()
        const hashVal = params[key] ?? defaultValue
        if (hashVal !== defaultValue) setValue(hashVal)

        function onHashChange() {
            const p = parseHash()
            setValue(p[key] ?? defaultValue)
        }
        window.addEventListener('hashchange', onHashChange)
        return () => window.removeEventListener('hashchange', onHashChange)
    }, [key, defaultValue])

    const setAndPersist = useCallback(
        (newVal: string) => {
            setValue(newVal)
            const params = parseHash()
            if (newVal === defaultValue) {
                delete params[key]
            } else {
                params[key] = newVal
            }
            writeHash(params)
        },
        [key, defaultValue]
    )

    return [value, setAndPersist]
}
