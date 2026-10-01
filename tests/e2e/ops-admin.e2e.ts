import { expect, test } from '@playwright/test'
import { createHmac } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as tables from '../../server/database/schema'

// The explicitly launched disposable test app configures this single fixture ID.
// No startup account promotion or test bypass exists in the application.
test('Ops guards direct API/SSR, provides manual accessible refresh and clears stale work on navigation', async ({ page, request, context, baseURL }) => {
  const sql = postgres(process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/nuxt_starter', { max: 1 })
  const db = drizzle(sql)
  const operator = 'ops-e2e-operator', outsider = crypto.randomUUID(), token = crypto.randomUUID(), outsideToken = crypto.randomUUID()
  const secret = process.env.NUXT_AUTH_SECRET || 'e2e-secret-that-is-at-least-thirty-two-chars'
  const name = process.env.PLAYWRIGHT_BASE_URL ? '__Secure-better-auth.session_token' : 'better-auth.session_token'
  const value = (token: string) => encodeURIComponent(`${token}.${createHmac('sha256', secret).update(token).digest('base64')}`)
  try {
    await db.insert(tables.user).values([{ id: operator, name: 'Private Ops fixture', email: 'ops-fixture@example.test' }, { id: outsider, name: 'Organization owner', email: `${outsider}@example.test` }])
    await db.insert(tables.session).values([{ id: crypto.randomUUID(), token, userId: operator, expiresAt: new Date(Date.now() + 3600000) }, { id: crypto.randomUUID(), token: outsideToken, userId: outsider, expiresAt: new Date(Date.now() + 3600000) }])
    expect((await request.get('/api/ops/summary')).status()).toBe(401)
    expect((await request.get('/api/ops/summary', { headers: { 'X-API-Key': 'credential-does-not-establish-human-session' } })).status()).toBe(401)
    const forbidden = await request.get('/admin/ops', { headers: { cookie: `${name}=${value(outsideToken)}`, Purpose: 'prefetch' } })
    expect(forbidden.status()).toBe(403); expect(await forbidden.text()).toContain('Access denied')
    const response = await request.get('/api/ops/summary', { headers: { cookie: `${name}=${value(token)}` } })
    expect(response.status()).toBe(200)
    expect(response.headers()['cache-control']).toContain('private, no-store')
    expect(response.headers()['vary']).toBe('Cookie')
    const summary = await response.json()
    expect(summary.adapters.map((card: { id: string }) => card.id)).toEqual(['jobs', 'storage', 'cache', 'audit', 'webhooks', 'observability'])
    for (const value of [token, secret, operator, 'ops-fixture@example.test']) expect(JSON.stringify(summary)).not.toContain(value)
    await context.addCookies([{ name, value: value(token), url: baseURL!, secure: Boolean(process.env.PLAYWRIGHT_BASE_URL), httpOnly: true, sameSite: 'Lax' }])
    await page.setViewportSize({ width: 375, height: 812 })
    await page.goto('/admin/ops')
    await expect(page.getByRole('heading', { name: 'Operations overview' })).toBeVisible()
    await expect(page.getByText('Last checked:')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled()
    expect(await page.locator('body').innerText()).not.toContain('ops-fixture@example.test')
    let calls = 0
    await page.route('**/api/ops/summary', async (route) => {
      calls++; await new Promise(resolve => setTimeout(resolve, 500))
      await route.fulfill({ json: summary })
    })
    await page.getByRole('button', { name: 'Refresh', exact: true }).focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('button', { name: 'Checking…' })).toBeDisabled()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled()
    expect(calls).toBe(1)
    await page.getByRole('button', { name: 'Refresh', exact: true }).click()
    await page.getByRole('link', { name: 'Back to application' }).click()
    await expect(page).toHaveURL(/\/app$/u)
    await expect(page.getByRole('heading', { name: 'Operations overview' })).toHaveCount(0)
    await page.unroute('**/api/ops/summary')
    await db.delete(tables.session).where(eq(tables.session.token, token))
    expect((await request.get('/api/ops/summary', { headers: { cookie: `${name}=${value(token)}` } })).status()).toBe(401)
    await page.goto('/admin/ops'); await expect(page).toHaveURL(/\/\?redirect=/u)
  }
  finally { await db.delete(tables.user).where(eq(tables.user.id, operator)); await db.delete(tables.user).where(eq(tables.user.id, outsider)); await sql.end() }
})
