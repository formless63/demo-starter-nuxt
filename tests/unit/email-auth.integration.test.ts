import { afterEach, describe, expect, it, vi } from 'vitest'
import { betterAuth } from 'better-auth'
import type { magicLink } from 'better-auth/plugins'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { drizzle } from 'drizzle-orm/postgres-js'
import { eq, like } from 'drizzle-orm'
import postgres from 'postgres'
import { closeEmail, getEmail, renderMagicLinkEmail } from '@repo/nuxt-email/server'
import { getLogger } from '@repo/nuxt-observability/server'
import { configuredAuthPlugins, configuredSocialProviders } from '../../server/utils/auth'
import * as schema from '../../server/database/schema'
import { mailpitEnv, startMailpit } from '../../fixtures/email-consumer/.fixture/mailpit'

afterEach(() => { closeEmail(); vi.unstubAllEnvs(); vi.restoreAllMocks() })
describe('SMTP-backed root auth configuration', () => {
  it('requires full magic-link acceptance without retrying partial or rejected delivery', async () => {
    for (const [key, value] of Object.entries(mailpitEnv(1025))) vi.stubEnv(key, value)
    const plugin = configuredAuthPlugins({ magicLinkEnabled: true, public: { appBaseUrl: 'https://canonical.test' } }).find(plugin => plugin.id === 'magic-link') as ReturnType<typeof magicLink>
    const send = vi.spyOn(getEmail(), 'send')
    for (const outcome of ['partial', 'rejected'] as const) {
      send.mockResolvedValueOnce({ outcome, accepted: outcome === 'partial' ? 1 : 0, rejected: 1, messageId: 'private-id' })
      await expect(plugin.options.sendMagicLink({ email: 'user@example.test', token: 'SECRET', url: 'https://canonical.test/api/auth/magic-link/verify?token=SECRET' })).rejects.toMatchObject({ code: 'unknown', retryable: false })
    }
    expect(send).toHaveBeenCalledTimes(2)
  })
  it('needs no SMTP while disabled and validates structural config when enabled', () => {
    vi.stubEnv('SMTP_HOST', '')
    expect(configuredAuthPlugins({ magicLinkEnabled: false }).map(plugin => plugin.id)).toEqual(['api-key'])
    expect(() => configuredAuthPlugins({ magicLinkEnabled: true })).toThrow('configuration')
    for (const [key, value] of Object.entries(mailpitEnv(1025))) vi.stubEnv(key, value)
    vi.stubEnv('NODE_ENV', 'production')
    expect(configuredAuthPlugins({ magicLinkEnabled: true }).map(plugin => plugin.id)).toEqual(['api-key', 'magic-link'])
    expect(() => renderMagicLinkEmail('https://foreign.test/?token=SECRET', 'https://canonical.test')).toThrow('message')
  })
})

const databaseUrl = process.env.DATABASE_URL
;(databaseUrl ? describe : describe.skip)('real root Better Auth Email integration', () => {
  it('sends through SMTP, keeps token hashed, redeems a session and never logs mail secrets', async () => {
    const fixture = await startMailpit()
    const sql = postgres(databaseUrl!, { max: 1 })
    const db = drizzle(sql)
    const recipient = `magic-${crypto.randomUUID()}@example.test`
    const baseURL = 'http://127.0.0.1:3197'
    const logs = [vi.spyOn(console, 'info'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'error'), vi.spyOn(getLogger(), 'info')]
    try {
      for (const [key, value] of Object.entries(mailpitEnv(fixture.port))) vi.stubEnv(key, value)
      const auth = betterAuth({ baseURL, secret: 'email-fixture-secret-at-least-thirty-two-characters',
        database: drizzleAdapter(db, { provider: 'pg', schema }), emailAndPassword: { enabled: false },
        socialProviders: configuredSocialProviders({ githubClientId: 'local-test-client', githubClientSecret: 'local-test-secret' }),
        plugins: configuredAuthPlugins({ magicLinkEnabled: true, public: { appBaseUrl: baseURL } }), trustedOrigins: [baseURL] })
      const request = await auth.handler(new Request(`${baseURL}/api/auth/sign-in/magic-link`, {
        method: 'POST', headers: { 'content-type': 'application/json', origin: baseURL }, body: JSON.stringify({ email: recipient, callbackURL: '/app/projects' }),
      }))
      expect(request.status).toBe(200)
      expect((await fixture.messages()).length).toBe(1)
      const captured = await fixture.api(`message/${(await fixture.messages())[0]!.ID}`)
      expect(captured.To[0].Address === recipient).toBe(true)
      expect(Boolean(captured.Text && captured.HTML)).toBe(true)
      const link = captured.Text.match(/https?:\/\/[^\s]+/u)?.[0]
      expect(Boolean(link)).toBe(true)
      const url = new URL(link)
      expect(url.origin === baseURL).toBe(true)
      const token = url.searchParams.get('token')!
      expect(Boolean(token)).toBe(true)
      const stored = await db.select().from(schema.verification).where(eq(schema.verification.identifier, token))
      expect(stored.length).toBe(0)
      const allVerification = await db.select().from(schema.verification)
      expect(allVerification.some(row => row.value.includes(recipient))).toBe(true)
      expect(allVerification.some(row => row.identifier === token || row.value.includes(token))).toBe(false)
      const redeemed = await auth.handler(new Request(url))
      expect(redeemed.status).toBe(302)
      expect(redeemed.headers.get('location')?.endsWith('/app/projects')).toBe(true)
      const cookie = redeemed.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
      expect(Boolean(cookie?.includes('session_token'))).toBe(true)
      const session = await auth.api.getSession({ headers: new Headers({ cookie }) })
      expect(Boolean(session?.user.email === recipient)).toBe(true)
      const output = JSON.stringify(logs.flatMap(log => log.mock.calls))
      for (const secret of [recipient, token, link, captured.Text, captured.HTML, 'fixture:fixture']) expect(output.includes(secret)).toBe(false)
      const reused = await auth.handler(new Request(url))
      expect(reused.status).toBe(302)
      expect(reused.headers.get('location')?.includes('error=')).toBe(true)

      // The same SMTP configuration still mints new links; expire one in disposable storage.
      await auth.handler(new Request(`${baseURL}/api/auth/sign-in/magic-link`, {
        method: 'POST', headers: { 'content-type': 'application/json', origin: baseURL }, body: JSON.stringify({ email: recipient }),
      }))
      const expiredMail = await fixture.api(`message/${(await fixture.messages())[0]!.ID}`)
      const expiredLink = expiredMail.Text.match(/https?:\/\/[^\s]+/u)?.[0]
      expect(expiredLink).toBeTruthy()
      await db.update(schema.verification).set({ expiresAt: new Date(Date.now() - 60_000) }).where(like(schema.verification.value, `%${recipient}%`))
      const expired = await auth.handler(new Request(expiredLink))
      expect(expired.headers.get('location')).toContain('error=')
      expect(expired.headers.getSetCookie().some(value => value.includes('session_token'))).toBe(false)

      // Initiating a fake provider redirect is local; no provider callback or credentials are used.
      const oauth = await auth.handler(new Request(`${baseURL}/api/auth/sign-in/social`, {
        method: 'POST', headers: { 'content-type': 'application/json', origin: baseURL },
        body: JSON.stringify({ provider: 'github', callbackURL: '/app/projects', additionalData: { email: recipient } }),
      }))
      expect(oauth.status).toBe(200)
      const state = new URL((await oauth.json()).url).searchParams.get('state')!
      expect(state).toBeTruthy()
      const stateRows = await db.select().from(schema.verification).where(eq(schema.verification.identifier, `auth-state:${state}`))
      expect(stateRows).toHaveLength(1)
      const confused = await auth.handler(new Request(`${baseURL}/api/auth/magic-link/verify?token=${encodeURIComponent(state)}`))
      expect(confused.headers.get('location')).toContain('error=')
      expect(confused.headers.getSetCookie().some(value => value.includes('session_token'))).toBe(false)
      expect(await db.select().from(schema.verification).where(eq(schema.verification.id, stateRows[0]!.id))).toHaveLength(1)
      // Unprefixed rows model pending 1.7.6 state, which the coordinated cutover invalidates.
      await db.update(schema.verification).set({ identifier: state }).where(eq(schema.verification.id, stateRows[0]!.id))
      const pendingState = await auth.handler(new Request(`${baseURL}/api/auth/callback/github?state=${encodeURIComponent(state)}&code=local-test-code`, {
        headers: { cookie: oauth.headers.getSetCookie().map(value => value.split(';')[0]).join('; ') },
      }))
      expect(pendingState.headers.get('location')).toContain('error=')
      expect(pendingState.headers.getSetCookie().some(value => value.includes('session_token'))).toBe(false)
      await db.delete(schema.verification).where(eq(schema.verification.id, stateRows[0]!.id))

      await auth.handler(new Request(`${baseURL}/api/auth/sign-in/magic-link`, {
        method: 'POST', headers: { 'content-type': 'application/json', origin: baseURL }, body: JSON.stringify({ email: recipient }),
      }))
      const pendingMail = await fixture.api(`message/${(await fixture.messages())[0]!.ID}`)
      const pendingLink = pendingMail.Text.match(/https?:\/\/[^\s]+/u)?.[0]
      const pendingRows = await db.select().from(schema.verification).where(like(schema.verification.value, `%${recipient}%`))
      const pendingRow = pendingRows.find(row => row.identifier.startsWith('magic-link:'))!
      expect(pendingRow).toBeTruthy()
      await db.update(schema.verification).set({ identifier: pendingRow.identifier.slice('magic-link:'.length) }).where(eq(schema.verification.id, pendingRow.id))
      const pendingLinkResponse = await auth.handler(new Request(pendingLink))
      expect(pendingLinkResponse.headers.get('location')).toContain('error=')
      expect(pendingLinkResponse.headers.getSetCookie().some(value => value.includes('session_token'))).toBe(false)
    }
    finally {
      await db.delete(schema.verification).where(like(schema.verification.value, `%${recipient}%`))
      await db.delete(schema.user).where(eq(schema.user.email, recipient))
      await sql.end(); closeEmail(); await fixture.close()
    }
  }, 60000)
})
