import { expect, test } from '@playwright/test'
import { createHmac, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { cp, mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:net'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { eq } from 'drizzle-orm'
import { compose, startProvider } from '../../fixtures/import-export-consumer/.fixture/providers'
import * as tables from '../../server/database/schema'
async function freePort() {
  const server = createServer()
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port
  await new Promise<void>(resolve => server.close(() => resolve()))
  return port
}
test('personal Project CSV browser round-trip with actual Storage and existing worker', async ({ browser, request }) => {
  test.setTimeout(240000)
  expect((await request.get('/api/transfers')).status()).toBe(401)
  expect((await request.post('/api/transfers/stage', { data: 'name,description\n' })).status()).toBe(401)
  const root = process.cwd(), production = Boolean(process.env.PLAYWRIGHT_BASE_URL)
  const fixtureProject = `transfer-browser-${randomUUID().slice(0, 8)}`
  let backend: Awaited<ReturnType<typeof startProvider>> | undefined, isolated: string | undefined
  let app: ReturnType<typeof spawn> | undefined, worker: ReturnType<typeof spawn> | undefined
  const connection = postgres(process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/nuxt_starter', { max: 4 }), db = drizzle(connection)
  const owner = randomUUID(), other = randomUUID(), token = randomUUID(), secret = 'disposable-transfer-browser-secret-at-least32'
  let context: Awaited<ReturnType<typeof browser.newContext>> | undefined
  try {
    backend = await startProvider('rustfs', fixtureProject, true)
    const port = await freePort(), base = `http://127.0.0.1:${port}`
    const env = { ...process.env, DATABASE_URL: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/nuxt_starter', NUXT_AUTH_SECRET: secret, NUXT_PUBLIC_APP_BASE_URL: base, STORAGE_BUCKET: backend.config.bucket, STORAGE_REGION: backend.config.region, STORAGE_ENDPOINT: backend.config.endpoint, STORAGE_ACCESS_KEY_ID: backend.config.accessKeyId, STORAGE_SECRET_ACCESS_KEY: backend.config.secretAccessKey, PORT: String(port), HOST: '127.0.0.1', REALTIME_TRANSPORTS: 'sse,websocket' }
    let cwd = root
    if (!production) {
      isolated = await mkdtemp(join(tmpdir(), 'nuxt-transfer-browser-'))
      await cp(root, isolated, { recursive: true, filter: source => !/(?:^|\/)(?:node_modules|\.git|\.nuxt|\.output|test-results|playwright-report)(?:\/|$)/.test(source) && !source.endsWith('/.env') })
      await symlink(join(root, 'node_modules'), join(isolated, 'node_modules')); cwd = isolated
    }
    app = spawn(production ? 'node' : 'bun', production ? ['.output/server/index.mjs'] : ['run', 'dev', '--host', '127.0.0.1', '--port', String(port)], { cwd, env, stdio: ['ignore', 'ignore', 'pipe'] })
    // No raw application logs become test assertions or artifacts.
    app.stderr?.resume()
    await expect.poll(async () => { try { return (await fetch(`${base}/api/health`)).status } catch { return 0 } }, { timeout: 90000 }).toBe(200)
    worker = spawn('bun', ['scripts/jobs-worker.ts'], { cwd: root, env, stdio: 'ignore' })
    await db.insert(tables.user).values([{ id: owner, name: 'Transfer owner', email: `${owner}@example.test` }, { id: other, name: 'Other owner', email: `${other}@example.test` }])
    await db.insert(tables.session).values({ id: randomUUID(), token, userId: owner, expiresAt: new Date(Date.now() + 240000) })
    await db.insert(tables.project).values({ id: randomUUID(), ownerId: other, name: 'Foreign project must stay private' })
    const name = production ? '__Secure-better-auth.session_token' : 'better-auth.session_token', signature = createHmac('sha256', secret).update(token).digest('base64')
    context = await browser.newContext({ baseURL: base })
    await context.addCookies([{ name, value: encodeURIComponent(`${token}.${signature}`), domain: '127.0.0.1', path: '/', httpOnly: true, secure: production }])
    const page = await context.newPage()
    await page.goto(`${base}/app/projects`)
    await expect(page.getByRole('heading', { name: 'Project CSV transfers' })).toBeVisible()
    await page.getByLabel('CSV file').setInputFiles({ name: 'local-fixture.csv', mimeType: 'text/csv', buffer: Buffer.from('name,description\r\nBrowser CSV,"quoted\nline"\r\n') })
    await page.getByRole('button', { name: 'Upload CSV', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Start import', exact: true })).toBeEnabled()
    await page.getByRole('button', { name: 'Start import', exact: true }).click()
    await expect.poll(async () => {
      await page.getByRole('button', { name: 'Refresh transfers', exact: true }).click()
      return await page.getByText('import — succeeded', { exact: false }).count()
    }, { timeout: 30000 }).toBe(1)
    await page.getByRole('button', { name: 'Export Projects', exact: true }).click()
    await expect.poll(async () => {
      await page.getByRole('button', { name: 'Refresh transfers', exact: true }).click()
      return await page.getByRole('button', { name: 'Download CSV', exact: true }).count()
    }, { timeout: 30000 }).toBe(1)
    const list = await (await context.request.get('/api/transfers')).json() as { items: { id: string, direction: string, status: string }[] }
    const exported = list.items.find(item => item.direction === 'export')!
    const signed = await (await context.request.get(`/api/transfers/${exported.id}/download`)).json() as { url: string }
    const output = await (await fetch(signed.url)).text()
    expect(output).toBe('name,description\r\nBrowser CSV,"quoted\nline"\r\n')
    expect(output).not.toContain('Foreign project')
    // Validation failure is safe and creates no extra domain rows.
    await page.getByLabel('CSV file').setInputFiles({ name: 'invalid.csv', mimeType: 'text/csv', buffer: Buffer.from('name,description\n,private-cell\n') })
    await page.getByRole('button', { name: 'Upload CSV', exact: true }).click(); await expect(page.getByRole('button', { name: 'Start import', exact: true })).toBeEnabled(); await page.getByRole('button', { name: 'Start import', exact: true }).click()
    await expect.poll(async () => { await page.getByRole('button', { name: 'Refresh transfers', exact: true }).click(); return await page.getByText('validation-failed', { exact: true }).count() }, { timeout: 30000 }).toBe(1)
    await expect(page.getByText('Row 1, name: invalid-value', { exact: false })).toBeVisible()
    expect(await page.locator('body').innerText()).not.toContain('private-cell')
    expect((await db.select().from(tables.project).where(eq(tables.project.ownerId, owner))).length).toBe(1)
    const staged = await (await context.request.post('/api/transfers/stage', { data: 'name,description\nCancel me,text\n', headers: { 'content-type': 'text/csv' } })).json() as { id: string }
    expect((await context.request.post(`/api/transfers/${staged.id}/cancel`)).status()).toBe(200)
    await page.getByRole('button', { name: 'Refresh transfers', exact: true }).click()
    await expect(page.getByText('import — cancelled', { exact: false })).toBeVisible()
  }
  finally {
    await context?.close()
    for (const process of [worker, app]) if (process && process.exitCode === null) { process.kill('SIGTERM'); await Promise.race([new Promise(resolve => process.once('exit', resolve)), new Promise(resolve => setTimeout(resolve, 5000))]); if (process.exitCode === null) process.kill('SIGKILL') }
    await db.delete(tables.transfer).where(eq(tables.transfer.requesterId, owner))
    await db.delete(tables.notification).where(eq(tables.notification.recipientId, owner))
    await db.delete(tables.auditEvent).where(eq(tables.auditEvent.actorId, owner))
    await db.delete(tables.user).where(eq(tables.user.id, owner)); await db.delete(tables.user).where(eq(tables.user.id, other)); await connection.end()
    backend?.storage.close(); await compose(fixtureProject, ['down', '--volumes', '--remove-orphans'])
    if (isolated) await rm(isolated, { recursive: true, force: true })
  }
})
