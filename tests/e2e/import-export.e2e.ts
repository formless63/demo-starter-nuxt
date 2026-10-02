import { browserDiagnostics } from './browser-diagnostics'
import { expect, test } from '@playwright/test'
import { createHmac, randomUUID } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { cp, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:net'
import postgres from 'postgres'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { createJobsBoss } from '@repo/nuxt-jobs/server'
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
  const originalDatabase = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/nuxt_starter'
  const databaseName = `transfer_browser_${randomUUID().replaceAll('-', '')}`, databaseUrl = new URL(originalDatabase)
  databaseUrl.pathname = `/${databaseName}`
  const admin = postgres(originalDatabase, { max: 1 }), connection = postgres(databaseUrl.href, { max: 4 }), db = drizzle(connection)
  let createdDatabase = false
  const owner = randomUUID(), other = randomUUID(), token = randomUUID(), secret = 'disposable-transfer-browser-secret-at-least32'
  let context: Awaited<ReturnType<typeof browser.newContext>> | undefined
  try {
    await admin.unsafe(`CREATE DATABASE "${databaseName}"`); createdDatabase = true
    await migrate(db, { migrationsFolder: join(root, 'server/database/migrations') })
    const migrationBoss = createJobsBoss({ databaseUrl: databaseUrl.href, schema: 'pgboss', concurrency: 1, useListenNotify: false }, 'migration')
    try { await migrationBoss.start() } finally { await migrationBoss.stop() }
    backend = await startProvider('rustfs', fixtureProject, true)
    const port = await freePort(), base = `http://127.0.0.1:${port}`
    const env = { ...process.env, DATABASE_URL: databaseUrl.href, PGBOSS_DATABASE_URL: databaseUrl.href, NUXT_AUTH_SECRET: secret, NUXT_PUBLIC_APP_BASE_URL: base, STORAGE_BUCKET: backend.config.bucket, STORAGE_REGION: backend.config.region, STORAGE_ENDPOINT: backend.config.endpoint, STORAGE_ACCESS_KEY_ID: backend.config.accessKeyId, STORAGE_SECRET_ACCESS_KEY: backend.config.secretAccessKey, PORT: String(port), HOST: '127.0.0.1', REALTIME_TRANSPORTS: 'sse,websocket' }
    let cwd = root
    if (!production) {
      isolated = await mkdtemp(join(tmpdir(), 'nuxt-transfer-browser-'))
      await cp(root, isolated, { recursive: true, filter: source => !/(?:^|\/)(?:node_modules|\.git|\.nuxt|\.output|test-results|playwright-report)(?:\/|$)/.test(source) && !source.endsWith('/.env') })
      // A second Nuxt dev server needs its own dependency realpaths, not links
      // back into the active server's modules and optimizer cache identity.
      const installed = spawnSync('bun', ['install', '--frozen-lockfile', '--ignore-scripts'], { cwd: isolated, env, stdio: 'pipe', timeout: 60000 })
      expect(installed.status, 'Isolated browser fixture dependencies install from the unchanged lockfile').toBe(0)
      cwd = isolated
    }
    app = spawn(production ? 'node' : 'bun', production ? ['.output/server/index.mjs'] : ['run', 'dev', '--host', '127.0.0.1', '--port', String(port)], { cwd, env, detached: true, stdio: ['ignore', 'ignore', 'pipe'] })
    // No raw application logs become test assertions or artifacts.
    app.stderr?.resume()
    await expect.poll(async () => { try { return (await fetch(`${base}/api/health`)).status } catch { return 0 } }, { timeout: 90000 }).toBe(200)
    worker = spawn('bun', ['scripts/jobs-worker.ts'], { cwd: root, env, detached: true, stdio: 'ignore' })
    await db.insert(tables.user).values([{ id: owner, name: 'Transfer owner', email: `${owner}@example.test` }, { id: other, name: 'Other owner', email: `${other}@example.test` }])
    await db.insert(tables.session).values({ id: randomUUID(), token, userId: owner, expiresAt: new Date(Date.now() + 240000) })
    await db.insert(tables.project).values({ id: randomUUID(), ownerId: other, name: 'Foreign project must stay private' })
    const name = production ? '__Secure-better-auth.session_token' : 'better-auth.session_token', signature = createHmac('sha256', secret).update(token).digest('base64')
    const sessionHeaders = { cookie: `${name}=${encodeURIComponent(`${token}.${signature}`)}` }
    context = await browser.newContext({ baseURL: base })
    await context.addCookies([{ name, value: encodeURIComponent(`${token}.${signature}`), domain: '127.0.0.1', path: '/', httpOnly: true, secure: production }])
    const page = await context.newPage()
    browserDiagnostics(page)
    await page.goto(`${base}/app/projects`)
    await expect(page.getByRole('heading', { name: 'Project CSV transfers' })).toBeVisible()
    await expect(page.getByLabel('CSV file')).toBeEnabled({ timeout: 15000 })
    await page.getByLabel('CSV file').setInputFiles({ name: 'local-fixture.csv', mimeType: 'text/csv', buffer: Buffer.from('name,description\r\nBrowser CSV,"line1\nline2"\r\n') })
    await expect(page.getByRole('button', { name: 'Upload CSV', exact: true })).toBeEnabled({ timeout: 15000 })
    await page.getByRole('button', { name: 'Upload CSV', exact: true }).click({ timeout: 15000 })
    await expect(page.getByRole('button', { name: 'Start import', exact: true })).toBeEnabled()
    await page.getByRole('button', { name: 'Start import', exact: true }).click()
    await expect.poll(async () => {
      await page.getByRole('button', { name: 'Refresh transfers', exact: true }).click()
      expect(worker!.exitCode, 'Existing worker remains running').toBeNull()
      const visible = await (await context!.request.get('/api/transfers', { headers: sessionHeaders })).json() as { items: { status: string, errorCode: string | null }[] }
      const failure = visible.items.find(item => item.status === 'failed')
      if (failure) throw new Error(`Safe transfer failure: ${failure.errorCode}`)
      return await page.getByText('import — succeeded', { exact: false }).count()
    }, { timeout: 30000 }).toBe(1)
    await page.getByRole('button', { name: 'Export Projects', exact: true }).click()
    await expect.poll(async () => {
      await page.getByRole('button', { name: 'Refresh transfers', exact: true }).click()
      const visible = await (await context!.request.get('/api/transfers', { headers: sessionHeaders })).json() as { items: { direction: string, status: string, errorCode: string | null }[] }
      const failure = visible.items.find(item => item.direction === 'export' && item.status === 'failed')
      if (failure) throw new Error(`Safe export failure: ${failure.errorCode}`)
      return await page.getByRole('button', { name: 'Download CSV', exact: true }).count()
    }, { timeout: 30000 }).toBe(1)
    const list = await (await context.request.get('/api/transfers', { headers: sessionHeaders })).json() as { items: { id: string, direction: string, status: string }[] }
    const exported = list.items.find(item => item.direction === 'export')!
    const signed = await (await context.request.get(`/api/transfers/${exported.id}/download`, { headers: sessionHeaders })).json() as { url: string }
    const output = await (await fetch(signed.url)).text()
    expect(output).toBe('name,description\r\nBrowser CSV,"line1\nline2"\r\n')
    expect(output).not.toContain('Foreign project')
    await page.getByLabel('CSV file').setInputFiles({ name: 'round-trip.csv', mimeType: 'text/csv', buffer: Buffer.from(output) })
    await page.getByRole('button', { name: 'Upload CSV', exact: true }).click(); await expect(page.getByRole('button', { name: 'Start import', exact: true })).toBeEnabled(); await page.getByRole('button', { name: 'Start import', exact: true }).click()
    await expect.poll(async () => { await page.getByRole('button', { name: 'Refresh transfers', exact: true }).click(); return await page.getByText('import — succeeded', { exact: false }).count() }, { timeout: 30000 }).toBe(2)
    const roundTrip = await db.select().from(tables.project).where(eq(tables.project.ownerId, owner))
    expect(roundTrip).toHaveLength(2); expect(new Set(roundTrip.map(row => row.id)).size).toBe(2)
    for (const row of roundTrip) expect(row).toMatchObject({ name: 'Browser CSV', description: 'line1\nline2', ownerId: owner })
    // Validation failure is safe and creates no extra domain rows.
    await page.getByLabel('CSV file').setInputFiles({ name: 'invalid.csv', mimeType: 'text/csv', buffer: Buffer.from('name,description\n,private-cell\n') })
    await page.getByRole('button', { name: 'Upload CSV', exact: true }).click(); await expect(page.getByRole('button', { name: 'Start import', exact: true })).toBeEnabled(); await page.getByRole('button', { name: 'Start import', exact: true }).click()
    await expect.poll(async () => { await page.getByRole('button', { name: 'Refresh transfers', exact: true }).click(); return await page.getByText('validation-failed', { exact: true }).count() }, { timeout: 30000 }).toBe(1)
    await expect(page.getByText('Row 1, name: invalid-value', { exact: false })).toBeVisible()
    expect(await page.locator('body').innerText()).not.toContain('private-cell')
    expect((await db.select().from(tables.project).where(eq(tables.project.ownerId, owner))).length).toBe(2)
    const staged = await (await context.request.post('/api/transfers/stage', { data: 'name,description\nCancel me,text\n', headers: { ...sessionHeaders, 'content-type': 'text/csv' } })).json() as { id: string }
    expect((await context.request.post(`/api/transfers/${staged.id}/cancel`, { headers: sessionHeaders })).status()).toBe(200)
    await page.getByRole('button', { name: 'Refresh transfers', exact: true }).click()
    await expect(page.getByText('import — cancelled', { exact: false })).toBeVisible()
  }
  finally {
    await context?.close().catch(() => {})
    for (const process of [worker, app]) if (process && process.exitCode === null) { try { globalThis.process.kill(-process.pid!, 'SIGTERM') } catch { /* Already stopped. */ } await Promise.race([new Promise(resolve => process.once('exit', resolve)), new Promise(resolve => setTimeout(resolve, 5000))]); if (process.exitCode === null) { try { globalThis.process.kill(-process.pid!, 'SIGKILL') } catch { /* Already stopped. */ } } }
    await connection.end()
    if (createdDatabase) await admin.unsafe(`DROP DATABASE "${databaseName}" WITH (FORCE)`)
    await admin.end()
    backend?.storage.close(); await compose(fixtureProject, ['down', '--volumes', '--remove-orphans'])
    if (isolated) await rm(isolated, { recursive: true, force: true })
  }
})
