import { admin_directory_v1, google } from 'googleapis'

const DEFAULT_REVALIDATION_INTERVAL_MINS = 30
const TRUVA_DOMAIN = 'truva.in'

interface RevalidatableSession {
    user: {
        email?: string
        lastValidatedAt?: number
        [key: string]: any
    }
    [key: string]: unknown
}

/**
 * Periodically revalidates Auth0 sessions against Google Workspace to detect
 * suspended/deleted users. For truva.in emails, calls Google Admin Directory API.
 * For external users, the session is considered valid if it's readable.
 *
 * Fail-closed: if Google API is unreachable or GOOGLE_SA_CREDENTIALS_JSON is not
 * configured, truva.in users will be forced to re-login.
 *
 * Env vars:
 * - SESSION_REVALIDATION_INTERVAL_MINS: revalidation frequency (default: 30)
 * - GOOGLE_SA_CREDENTIALS_JSON: service account JSON with domain-wide delegation
 * - GOOGLE_SA_IMPERSONATE_USER: admin email to impersonate (default: ankit@truva.in)
 */
class SessionRevalidator {
    private revalidationIntervalMs: number
    private directoryClient: admin_directory_v1.Admin | null = null

    constructor() {
        const intervalMins =
            Number(process.env.SESSION_REVALIDATION_INTERVAL_MINS) || DEFAULT_REVALIDATION_INTERVAL_MINS
        this.revalidationIntervalMs = intervalMins * 60 * 1000
    }

    shouldRevalidate(session: RevalidatableSession): boolean {
        const lastValidatedAt = session.user.lastValidatedAt
        if (!lastValidatedAt) return true
        return Date.now() - lastValidatedAt > this.revalidationIntervalMs
    }

    async revalidate(session: RevalidatableSession): Promise<'valid' | 'invalid'> {
        const email = session.user.email
        if (!email) return 'invalid'

        const domain = email.split('@')[1]?.toLowerCase()

        if (domain === TRUVA_DOMAIN) {
            console.log(`[SessionRevalidator] Revalidating truva.in user: ${email}`)
            const result = await this.checkGoogleUserStatus(email)
            console.log(`[SessionRevalidator] Result for ${email}: ${result}`)
            return result
        }

        console.log(`[SessionRevalidator] External user ${email} — skipping Google check`)
        return 'valid'
    }

    private getDirectoryClient(): admin_directory_v1.Admin {
        if (this.directoryClient) return this.directoryClient

        const credentialsJson = process.env.GOOGLE_SA_CREDENTIALS_JSON
        if (!credentialsJson) {
            throw new Error('GOOGLE_SA_CREDENTIALS_JSON environment variable is not configured')
        }

        const impersonateUser = process.env.GOOGLE_SA_IMPERSONATE_USER || `ankit@${TRUVA_DOMAIN}`

        let credentials: { client_email: string; private_key: string }
        try {
            credentials = JSON.parse(credentialsJson)
        } catch (e) {
            console.error('[SessionRevalidator] GOOGLE_SA_CREDENTIALS_JSON parse debug:', {
                length: credentialsJson.length,
                first50: credentialsJson.substring(0, 50),
                last20: credentialsJson.substring(credentialsJson.length - 20),
                startsWithQuote: credentialsJson[0] === '"' || credentialsJson[0] === "'",
                error: (e as Error).message,
            })
            throw new Error('GOOGLE_SA_CREDENTIALS_JSON contains invalid JSON')
        }

        const auth = new google.auth.JWT({
            email: credentials.client_email,
            key: credentials.private_key.replace(/\\n/g, '\n'),
            scopes: ['https://www.googleapis.com/auth/admin.directory.user.readonly'],
            subject: impersonateUser,
        })

        this.directoryClient = google.admin({ version: 'directory_v1', auth })
        return this.directoryClient
    }

    private async checkGoogleUserStatus(email: string): Promise<'valid' | 'invalid'> {
        try {
            const directory = this.getDirectoryClient()
            const response = await directory.users.get({ userKey: email })

            if (response.data.suspended || response.data.archived) {
                console.log(
                    `[SessionRevalidator] User ${email} is suspended=${response.data.suspended} archived=${response.data.archived}`
                )
                return 'invalid'
            }

            return 'valid'
        } catch (error: any) {
            if (error?.code === 404 || error?.response?.status === 404) {
                console.log(`[SessionRevalidator] User ${email} not found in Google Workspace (deleted)`)
                return 'invalid'
            }

            console.error('[SessionRevalidator] Google Admin API error:', error?.message || error)
            return 'invalid'
        }
    }
}

export const sessionRevalidator = new SessionRevalidator()
