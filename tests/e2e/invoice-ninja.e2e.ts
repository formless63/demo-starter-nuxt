import { bootstrapDiagnostics } from './bootstrap-diagnostics'
import { waitForHydration } from './hydration'
import { browserDiagnostics } from './browser-diagnostics'
import { expect, test } from '@playwright/test'
import { createHmac, randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import { invoiceNinjaBinding as bindings, invoiceNinjaProjection as projections, invoiceNinjaOperation as operations } from '@repo/nuxt-invoice-ninja/schema'
import { user, session } from '../../server/database/schema'
test('Invoice Ninja native scoped local projections, queued cancellation and authenticated reference UI', async ({ browser, request }) => {
  test.setTimeout(60_000)
  const dbUrl = process.env.DATABASE_URL; expect(dbUrl).toBeTruthy()
  const client = new pg.Pool({ connectionString: dbUrl!, max: 1 }).on('error', () => {}), db = drizzle(client)
  const owner = randomUUID(), other = randomUUID(), binding = randomUUID(), foreign = randomUUID(), operation = randomUUID(), token = randomUUID()
  const secret = process.env.NUXT_AUTH_SECRET || 'e2e-secret-that-is-at-least-thirty-two-chars'
  const name = process.env.PLAYWRIGHT_BASE_URL ? '__Secure-better-auth.session_token' : 'better-auth.session_token'
  const value = encodeURIComponent(`${token}.${createHmac('sha256', secret).update(token).digest('base64')}`), headers = { cookie: `${name}=${value}` }
  const context = await browser.newContext()
  try {
    expect((await request.get('/api/integrations/invoice-ninja/invoices')).status()).toBe(401)
    expect((await request.post('/api/integrations/invoice-ninja/drafts', { data: {} })).status()).toBe(401)
    await db.insert(user).values([{ id: owner, name: 'Invoice fixture', email: `${owner}@example.test` }, { id: other, name: 'Foreign fixture', email: `${other}@example.test` }])
    await db.insert(session).values({ id: randomUUID(), token, userId: owner, expiresAt: new Date(Date.now() + 120_000) })
    await db.insert(bindings).values([{ id: binding, scopeKind: 'user', scopeId: owner, localResourceId: 'fixture', resourceKind: 'invoice', connectionId: 'default', remoteId: `remote-${binding}` }, { id: foreign, scopeKind: 'user', scopeId: other, localResourceId: 'fixture', resourceKind: 'invoice', connectionId: 'default', remoteId: `remote-${foreign}` }])
    await db.insert(projections).values({ bindingId: binding, syncedAt: new Date(), value: { bindingId: binding, remoteId: `remote-${binding}`, number: 'LOCAL-1', status: 'draft', currency: 'USD', amount: '10.1234', balance: '10.1234', sourceUpdatedAt: null, syncedAt: new Date().toISOString(), deleted: false } })
    await db.insert(operations).values({ id: operation, scopeKind: 'user', scopeId: owner, actorUserId: owner, connectionId: 'default', kind: 'reconcile_invoice', callerKey: randomUUID(), digest: '0'.repeat(64), bindingId: binding })
    const response = await request.get('/api/integrations/invoice-ninja/invoices', { headers })
    expect(response.status()).toBe(200); expect(response.headers()['cache-control']).toBe('no-store')
    expect((await response.json()).items).toHaveLength(1)
    expect((await request.get(`/api/integrations/invoice-ninja/invoices/${foreign}`, { headers })).status()).toBe(404)
    expect((await request.get('/api/integrations/invoice-ninja/invoices?limit=1.5', { headers })).status()).toBe(400)
    const bad = await request.post('/api/integrations/invoice-ninja/drafts', { headers, data: { clientBindingId: binding, send_email: true } })
    expect(bad.status()).toBe(400); expect(await bad.json()).toEqual({ error: { code: 'invalid_input', message: 'Invalid input.', retryable: false } })
    await context.addCookies([{ name, value, domain: '127.0.0.1', path: '/', httpOnly: true, secure: Boolean(process.env.PLAYWRIGHT_BASE_URL) }])
    const page = await context.newPage(), base = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:3000'
    browserDiagnostics(page)
    const reportBootstrap = bootstrapDiagnostics(page)
    await page.goto(`${base}/invoice-ninja`)
    await expect(page.getByRole('heading', { name: 'Invoice Ninja', exact: true })).toBeVisible()
    await expect(page.getByText('LOCAL-1', { exact: true })).toBeVisible()
    try { await waitForHydration(page) }
    catch (error) { await reportBootstrap(); throw error }
    await page.getByLabel('Operation UUID').fill(operation)
    await page.getByRole('button', { name: 'Refresh operation', exact: true }).click()
    await expect(page.getByText('reconcile_invoice: queued', { exact: false })).toBeVisible()
    await page.getByRole('button', { name: 'Cancel queued operation', exact: true }).click()
    await expect(page.getByText('reconcile_invoice: cancelled', { exact: false })).toBeVisible()
    await page.getByRole('button', { name: 'Cancel queued operation', exact: true }).click()
    await expect(page.getByText('reconcile_invoice: cancelled', { exact: false })).toBeVisible()
    await page.getByRole('button', { name: 'Refresh local list', exact: true }).click()
    await expect(page.getByText('LOCAL-1', { exact: true })).toBeVisible()
  }
  finally {
    await context.close().catch(() => {})
    await db.delete(operations).where(eq(operations.id, operation)); await db.delete(projections).where(eq(projections.bindingId, binding))
    await db.delete(bindings).where(eq(bindings.id, binding)); await db.delete(bindings).where(eq(bindings.id, foreign))
    await db.delete(user).where(eq(user.id, owner)); await db.delete(user).where(eq(user.id, other)); await client.end()
  }
})
