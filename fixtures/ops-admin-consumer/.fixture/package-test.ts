import { writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import pg from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { createServer } from 'node:net'
import { createOpsService, parseOpsAllowlist } from '@repo/nuxt-ops-admin/server'

const databaseUrl = process.env.DATABASE_URL
assert(databaseUrl, 'Disposable PostgreSQL required')
const admin = new pg.Pool({ connectionString: databaseUrl, max: 1 })
admin.on('error', () => {})
const database = `ops_fixture_${crypto.randomUUID().replaceAll('-', '')}`
await admin.query(`CREATE DATABASE "${database}"`)
const url = new URL(databaseUrl); url.pathname = `/${database}`
const sql = new pg.Pool({ connectionString: url.toString(), max: 1 })
sql.on('error', () => {})
const secret = 'ops-disposable-fixture-signing-secret-32-characters'
async function cookie(token: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(token))
  return `better-auth.session_token=${encodeURIComponent(`${token}.${btoa(String.fromCharCode(...new Uint8Array(signature)))}`)}`
}
const operator = 'ops-opaque:操作者', outsider = 'organization-owner', token = crypto.randomUUID(), other = crypto.randomUUID()
await writeFile('.fixture/state.json', JSON.stringify({ database, url: url.toString(), secret, operator, token }))
async function boot(allowlist: string, check: (base: string) => Promise<void>) {
  const reservation = createServer(); await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve))
  const port = (reservation.address() as { port: number }).port
  await new Promise<void>(resolve => reservation.close(() => resolve()))
  const base = `http://127.0.0.1:${port}`
  const server = Bun.spawn(['node', '.output/server/index.mjs'], { env: { ...process.env, NODE_ENV: 'production', NITRO_PORT: String(port), NITRO_HOST: '127.0.0.1', NUXT_DATABASE_URL: url.toString(), NUXT_AUTH_SECRET: secret, NUXT_PUBLIC_APP_BASE_URL: base, OPS_ADMIN_USER_IDS: allowlist }, stdout: 'pipe', stderr: 'pipe' })
  const output = new Response(server.stdout).text(), errors = new Response(server.stderr).text()
  try {
    let ready = false
    for (let i = 0; i < 100; i++) {
      assert.equal(server.exitCode, null)
      try { if ((await fetch(`${base}/api/ops/summary`)).status === 401) { ready = true; break } } catch { /* bounded local startup */ }
      await Bun.sleep(100)
    }
    assert(ready)
    await check(base)
  }
  finally { server.kill('SIGTERM'); await server.exited; const logs = await output + await errors; assert(!logs.includes(secret)); assert(!logs.includes(token)); assert(!logs.includes(operator)) }
}
try {
  await migrate(drizzle(sql), { migrationsFolder: 'server/database/migrations' })
  await sql.query(`INSERT INTO "user" (id,name,email) VALUES ($1,'Operator','operator@example.test'),($2,'Owner','owner@example.test')`, [operator, outsider])
  await sql.query(`INSERT INTO session (id,token,user_id,expires_at) VALUES ($1,$2,$3,now()+interval '1 hour'),($4,$5,$6,now()+interval '1 hour')`, [crypto.randomUUID(), token, operator, crypto.randomUUID(), other, outsider])
  const operatorCookie = await cookie(token), otherCookie = await cookie(other)
  await boot(operator, async (base) => {
    for (const headers of [{}, { 'X-API-Key': 'fixture-non-session-credential' }, { cookie: otherCookie }]) {
      const response = await fetch(`${base}/api/ops/summary`, { headers })
      assert.equal(response.status, 'cookie' in headers ? 403 : 401)
      assert.deepEqual(Object.keys(await response.json()).sort(), ['code', 'message', 'retryable'])
      assert.match(response.headers.get('cache-control')!, /private.*no-store/u)
    }
    const response = await fetch(`${base}/api/ops/summary`, { headers: { cookie: operatorCookie } })
    assert.equal(response.status, 200); assert.equal(response.headers.get('vary'), 'Cookie')
    assert.deepEqual((await response.json()).adapters, [])
    const page = await fetch(`${base}/admin/ops`, { headers: { cookie: operatorCookie } })
    const html = await page.text(); assert.equal(page.status, 200); assert(html.includes('No operational adapters'))
    assert(!html.includes(secret)); assert(!html.includes(operator)); assert(!html.includes('operator@example.test'))
    const forbidden = await fetch(`${base}/admin/ops`, { headers: { cookie: otherCookie, 'Purpose': 'prefetch' } })
    assert.equal(forbidden.status, 403); assert((await forbidden.text()).includes('Access denied'))
    assert.equal((await fetch(`${base}/api/ops/summary`, { method: 'POST', headers: { cookie: operatorCookie } })).status, 404)
    await sql.query(`UPDATE session SET expires_at=now()-interval '1 second' WHERE token=$1`, [token])
    assert.equal((await fetch(`${base}/api/ops/summary`, { headers: { cookie: operatorCookie } })).status, 401)
    await sql.query(`INSERT INTO session (id,token,user_id,expires_at) VALUES ($1,$2,$3,now()+interval '1 hour')`, [crypto.randomUUID(), token, operator])
  })
  await boot(Array(101).fill(operator).join(','), async (base) => {
    assert.equal((await fetch(`${base}/api/ops/summary`, { headers: { cookie: operatorCookie } })).status, 200)
  })
  for (const allowlist of ['', 'malformed\nidentifier', Array.from({ length: 101 }, (_, i) => `u${i}`).join(',')]) await boot(allowlist, async (base) => {
    const response = await fetch(`${base}/api/ops/summary`, { headers: { cookie: operatorCookie } })
    assert.equal(response.status, allowlist ? 503 : 403)
  })
  assert.equal(parseOpsAllowlist('a, a, ,b').size, 2)
  let calls = 0
  const service = createOpsService([{ id: 'disabled', title: 'Disabled', isConfigured: () => false, inspect: async () => { calls++; return { status: 'ok' } } }])
  assert.equal(calls, 0); assert.equal((await service.summary()).adapters[0]!.status, 'not-configured'); assert.equal(calls, 0)
  console.info('[ops-admin] Packed baseline-only Better Auth/PostgreSQL access, SSR, privacy, empty/malformed allowlist, no startup inspection passed')
}
finally { await sql.end(); await admin.end() }
