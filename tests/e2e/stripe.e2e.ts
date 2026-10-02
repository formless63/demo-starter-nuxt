import { test, expect } from '@playwright/test'
import { createHmac, randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { eq } from 'drizzle-orm'
import * as tables from '../../server/database/schema'
test('Stripe native auth, scoped projections, repeated operation reads and queued cancellation', async ({ page, request, context, baseURL }) => {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 }), db = drizzle(sql)
  const owner = randomUUID(), token = randomUUID(), bindingId = randomUUID(), operationId = randomUUID()
  const secret = process.env.NUXT_AUTH_SECRET || 'e2e-secret-that-is-at-least-thirty-two-chars'
  const cookieName = process.env.PLAYWRIGHT_BASE_URL ? '__Secure-better-auth.session_token' : 'better-auth.session_token'
  const cookie = `${token}.${createHmac('sha256', secret).update(token).digest('base64')}`
  try {
    expect((await request.get('/api/integrations/stripe/payments')).status()).toBe(401)
    expect((await request.post('/api/integrations/stripe/checkout', { data: {} })).status()).toBe(401)
    const overflow = await request.post('/api/integrations/stripe/webhooks/default', { headers: { 'stripe-signature': 't=1,v1=' + '0'.repeat(64) }, data: 'x'.repeat(1024 * 1024 + 1) })
    expect(overflow.status()).toBe(413)
    expect(await overflow.json()).toEqual({ error: { code: 'limit_exceeded', message: 'Limit exceeded.', retryable: false } })
    await db.insert(tables.user).values({ id: owner, name: 'Stripe browser fixture', email: `${owner}@example.test` })
    await db.insert(tables.session).values({ id: randomUUID(), token, userId: owner, expiresAt: new Date(Date.now() + 3600000) })
    await db.insert(tables.stripeBinding).values({ id: bindingId, scopeKind: 'user', scopeId: owner, localResourceId: 'browser-fixture', connectionId: 'default', resourceKind: 'payment', remoteId: `pi_${owner.replaceAll('-', '')}` })
    await db.insert(tables.stripeProjection).values({ bindingId, payment: { status: 'processing', currency: 'usd', amount: 100, amountReceived: 0, sourceUpdatedAt: null }, syncedAt: new Date() })
    await db.insert(tables.stripeOperationLedger).values({ id: operationId, actorUserId: owner, scopeKind: 'user', scopeId: owner, connectionId: 'default', bindingId, kind: 'reconcile_payment', callerKey: randomUUID(), inputDigest: '0'.repeat(64), status: 'queued' })
    await context.addCookies([{ name: cookieName, value: encodeURIComponent(cookie), url: baseURL! }])
    await page.goto('/stripe')
    await expect(page.getByRole('heading', { name: 'One-time Checkout' })).toBeVisible()
    await expect(page.locator('pre')).toContainText('processing')
    await page.getByLabel('Operation', { exact: true }).fill(operationId)
    await page.getByRole('button', { name: 'Refresh operation' }).click()
    await expect(page.locator('output')).toContainText('queued')
    await page.getByRole('button', { name: 'Refresh operation' }).click()
    await expect(page.locator('output')).toContainText(operationId)
    await page.getByRole('button', { name: 'Cancel queued operation' }).click()
    await expect(page.locator('output')).toContainText('cancelled')
    const response = await page.request.get('/api/integrations/stripe/payments')
    expect(response.headers()['cache-control']).toBe('no-store')
    expect(JSON.stringify(await response.json())).not.toMatch(/checkoutUrl|intent|actorUserId|metadata|secretKey/)
    expect((await page.request.get('/api/integrations/stripe/operation', { params: { operationId: randomUUID() } })).status()).toBe(404)
    expect((await page.request.post('/api/integrations/stripe/checkout', { data: { arbitrary: 'private' } })).status()).toBe(400)
    expect((await page.request.post('/api/integrations/stripe/reconcile', { data: { kind: 'payment', bindingId } })).status()).toBe(503)
  }
  finally {
    await db.delete(tables.stripeOperationLedger).where(eq(tables.stripeOperationLedger.id, operationId))
    await db.delete(tables.stripeProjection).where(eq(tables.stripeProjection.bindingId, bindingId))
    await db.delete(tables.stripeBinding).where(eq(tables.stripeBinding.id, bindingId))
    await db.delete(tables.user).where(eq(tables.user.id, owner)); await sql.end()
  }
})
