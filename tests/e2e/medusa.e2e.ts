import { waitForHydration } from './hydration'
import { test, expect } from '@playwright/test'
import { createHmac } from 'node:crypto'
import pg from 'pg'
test('Medusa user isolation, local projections, repeated actions and queued cancellation', async ({ page, request, context, baseURL }) => {
  test.setTimeout(60_000)
  const client = new pg.Pool({ connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/nuxt_starter', max: 1 }).on('error', () => {})
  const owner = `medusa-e2e-${crypto.randomUUID()}`, outsider = `medusa-e2e-${crypto.randomUUID()}`, token = crypto.randomUUID(), other = crypto.randomUUID(), binding = crypto.randomUUID(), operation = crypto.randomUUID()
  const secret = process.env.NUXT_AUTH_SECRET || 'e2e-secret-that-is-at-least-thirty-two-chars'
  const cookieName = process.env.PLAYWRIGHT_BASE_URL ? '__Secure-better-auth.session_token' : 'better-auth.session_token'
  const value = (token: string) => encodeURIComponent(`${token}.${createHmac('sha256', secret).update(token).digest('base64')}`)
  try {
    await client.query(`INSERT INTO "user" (id,name,email) VALUES ($1,'Medusa owner',$2),($3,'Other owner',$4)`, [owner, `${owner}@example.test`, outsider, `${outsider}@example.test`])
    await client.query(`INSERT INTO session (id,token,user_id,expires_at) VALUES ($1,$2,$3,now()+interval '1 hour'),($4,$5,$6,now()+interval '1 hour')`, [crypto.randomUUID(), token, owner, crypto.randomUUID(), other, outsider])
    await client.query(`INSERT INTO medusa_binding (id,scope_kind,scope_id,local_resource_id,connection_id,resource_kind,remote_id) VALUES ($1,'user',$2,$3,'default','product',$4)`, [binding, owner, crypto.randomUUID(), `prod_${binding}`])
    const projection = { bindingId: binding, remoteId: `prod_${binding}`, title: 'Scoped product fixture', handle: 'scoped', status: 'published', sourceUpdatedAt: null, syncedAt: new Date().toISOString(), deleted: false }
    await client.query(`INSERT INTO medusa_projection (binding_id,data,synced_at,revision) VALUES ($1,$2,now(),0)`, [binding, JSON.stringify(projection)])
    await client.query(`INSERT INTO medusa_operation (id,actor_user_id,scope_kind,scope_id,connection_id,kind,status,binding_id,caller_key,digest,intent) VALUES ($1,$2,'user',$2,'default','reconcile_product','queued',$3,$1,$4,$5)`, [operation, owner, binding, 'a'.repeat(64), JSON.stringify({ kind: 'product' })])
    const userCookie = `${cookieName}=${value(token)}`, foreignCookie = `${cookieName}=${value(other)}`
    expect((await request.get('/api/integrations/medusa/products')).status()).toBe(401)
    const foreign = await request.get('/api/integrations/medusa/product', { headers: { cookie: foreignCookie }, params: { bindingId: binding } }); expect(foreign.status()).toBe(404)
    const local = await request.get('/api/integrations/medusa/products', { headers: { cookie: userCookie } }); expect(local.status()).toBe(200); expect(local.headers()['cache-control']).toContain('no-store'); expect((await local.json()).items).toHaveLength(1)
    const unavailable = await request.post('/api/integrations/medusa/reconcile', { headers: { cookie: userCookie }, data: { kind: 'product', bindingId: binding } }); expect(unavailable.status()).toBe(503); expect(await unavailable.json()).toEqual({ code: 'unconfigured', message: 'Integration is not configured.', retryable: false })
    expect((await request.post('/api/integrations/medusa/reconcile', { headers: { cookie: userCookie }, data: { kind: 'product', bindingId: binding, remoteId: 'foreign' } })).status()).toBe(400)
    await context.addCookies([{ name: cookieName, value: value(token), domain: new URL(baseURL!).hostname, path: '/', secure: Boolean(process.env.PLAYWRIGHT_BASE_URL), httpOnly: true, sameSite: 'Lax' }])
    await page.goto('/integrations/medusa'); await expect(page.getByRole('heading', { name: 'Medusa reconciliation' })).toBeVisible(); await expect(page.getByText('Scoped product fixture', { exact: false })).toBeVisible()
    await waitForHydration(page)
    let count = 0, releaseResponse!: () => void
    const responseGate = new Promise<void>(resolve => { releaseResponse = resolve })
    await page.route('**/api/integrations/medusa/reconcile', async route => { count++; await responseGate; await route.fulfill({ json: { operationId: operation, status: 'queued' } }) })
    const reconcile = page.getByRole('button', { name: 'Reconcile product' })
    try {
      await expect(reconcile).toBeEnabled()
      await reconcile.click()
      await expect(reconcile).toBeDisabled()
      // A native repeated click cannot enqueue another request while disabled.
      await reconcile.evaluate(button => (button as HTMLButtonElement).click())
      await expect.poll(() => count).toBe(1)
    }
    finally { releaseResponse() }
    await expect(page.getByRole('button', { name: 'Cancel queued work' })).toBeEnabled()
    expect(count).toBe(1)
    await page.getByRole('button', { name: 'Cancel queued work' }).click(); await expect(page.getByRole('status')).toContainText('cancelled')
    expect((await request.get('/api/integrations/medusa/operation', { headers: { cookie: foreignCookie }, params: { operationId: operation } })).status()).toBe(404)
    await page.unrouteAll({ behavior: 'wait' })
    await client.query('DELETE FROM session WHERE token=$1', [token])
    expect((await request.get('/api/integrations/medusa/products', { headers: { cookie: userCookie } })).status()).toBe(401)
  }
  finally {
    await client.query('DELETE FROM medusa_operation WHERE id=$1', [operation]); await client.query('DELETE FROM medusa_projection WHERE binding_id=$1', [binding]); await client.query('DELETE FROM medusa_binding WHERE id=$1', [binding])
    await client.query('DELETE FROM "user" WHERE id IN ($1,$2)', [owner, outsider]); await client.end()
  }
})
