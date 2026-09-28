import {
    airtableConfig,
    procurementApiConfig,
    procurementConfigured,
    procurementEnvReport,
} from '@/lib/procurement/config'
import { afterEach, describe, expect, it } from 'vitest'

// The env seam for the procurement dashboard, pinned.
//
// It reads the ledger pair and nothing else, because procurement talks to the same growth service
// through the same x-api-key gate — and the report must never carry a secret.

const VARS = [
    'GROWTH_LEDGER_BASE_URL',
    'GROWTH_LEDGER_API_KEY',
    'AIRTABLE_API_KEY',
    'AIRTABLE_BASE_ID',
    'AIRTABLE_TQ_TABLE',
] as const

afterEach(() => {
    for (const v of VARS) delete process.env[v]
})

describe('procurementApiConfig', () => {
    it('is null until both a url and a key are available', () => {
        expect(procurementApiConfig()).toBeNull()
        process.env.GROWTH_LEDGER_BASE_URL = 'https://growth.example'
        expect(procurementApiConfig()).toBeNull()
        process.env.GROWTH_LEDGER_API_KEY = 'ledger_key'
        expect(procurementApiConfig()).not.toBeNull()
    })

    // Same service, same key, so nothing new has to be set on Vercel.
    it('reads the ledger pair', () => {
        process.env.GROWTH_LEDGER_BASE_URL = 'https://growth.example'
        process.env.GROWTH_LEDGER_API_KEY = 'ledger_key'
        expect(procurementApiConfig()).toEqual({
            baseUrl: 'https://growth.example',
            apiKey: 'ledger_key',
        })
    })

    // One variable decides where both the spend ledger and procurement go, which is what makes
    // pointing the dashboard at a local growth a single edit.
    it('follows the ledger URL wherever it points, including a local growth', () => {
        process.env.GROWTH_LEDGER_BASE_URL = 'http://localhost:4003'
        process.env.GROWTH_LEDGER_API_KEY = 'ledger_key'
        expect(procurementApiConfig()?.baseUrl).toBe('http://localhost:4003')
    })

    it('strips a trailing slash so callers can append /api/... blindly', () => {
        process.env.GROWTH_LEDGER_BASE_URL = 'https://growth.example/'
        process.env.GROWTH_LEDGER_API_KEY = 'ledger_key'
        expect(procurementApiConfig()?.baseUrl).toBe('https://growth.example')
    })
})

describe('airtableConfig', () => {
    it('is null until both the token and the base are set', () => {
        process.env.AIRTABLE_API_KEY = 'pat_key'
        expect(airtableConfig()).toBeNull()
        process.env.AIRTABLE_BASE_ID = 'appXXXX'
        expect(airtableConfig()).not.toBeNull()
    })

    it('defaults the table to the one the priorities live in', () => {
        process.env.AIRTABLE_API_KEY = 'pat_key'
        process.env.AIRTABLE_BASE_ID = 'appXXXX'
        expect(airtableConfig()?.table).toBe('TQ Unit wise')
    })

    it('takes an overridden table name', () => {
        process.env.AIRTABLE_API_KEY = 'pat_key'
        process.env.AIRTABLE_BASE_ID = 'appXXXX'
        process.env.AIRTABLE_TQ_TABLE = 'tblSomethingElse'
        expect(airtableConfig()?.table).toBe('tblSomethingElse')
    })
})

describe('procurementConfigured', () => {
    // Priority is a label, not part of the ratio. Missing Airtable costs the grouping; missing
    // growth costs the numbers. Only the second makes the dashboard unservable.
    it('needs growth only — Airtable is the degradable source', () => {
        expect(procurementConfigured()).toBe(false)
        process.env.GROWTH_LEDGER_BASE_URL = 'https://growth.example'
        process.env.GROWTH_LEDGER_API_KEY = 'ledger_key'
        expect(procurementConfigured()).toBe(true)
        expect(airtableConfig()).toBeNull()
    })
})

describe('procurementEnvReport', () => {
    it('reports what is configured', () => {
        process.env.GROWTH_LEDGER_BASE_URL = 'https://growth.example'
        process.env.GROWTH_LEDGER_API_KEY = 'ledger_key'
        process.env.AIRTABLE_API_KEY = 'pat_key'
        process.env.AIRTABLE_BASE_ID = 'appXXXX'
        expect(procurementEnvReport()).toEqual({
            growth: { configured: true, baseUrl: 'https://growth.example' },
            airtable: { configured: true, baseId: 'appXXXX', table: 'TQ Unit wise' },
        })
    })

    it('never carries either secret, not even a prefix of one', () => {
        process.env.GROWTH_LEDGER_BASE_URL = 'https://growth.example'
        process.env.GROWTH_LEDGER_API_KEY = 'ledger_key'
        process.env.AIRTABLE_API_KEY = 'pat_key'
        process.env.AIRTABLE_BASE_ID = 'appXXXX'
        const serialised = JSON.stringify(procurementEnvReport())
        expect(serialised).not.toContain('ledger_key')
        expect(serialised).not.toContain('pat_key')
    })
})
