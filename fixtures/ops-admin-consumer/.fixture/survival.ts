import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHmac } from 'node:crypto'
import { createServer } from 'node:net'
const state = JSON.parse(await readFile('.fixture/state.json', 'utf8'))
const reservation = createServer(); await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve))
const port = (reservation.address() as { port: number }).port
await new Promise<void>(resolve => reservation.close(() => resolve()))
const base = `http://127.0.0.1:${port}`
const server = Bun.spawn(['node', '.output/server/index.mjs'], { env: { ...process.env, NITRO_PORT: String(port), NITRO_HOST: '127.0.0.1', NUXT_DATABASE_URL: state.url, NUXT_AUTH_SECRET: state.secret, NUXT_PUBLIC_APP_BASE_URL: base }, stdout: 'ignore', stderr: 'ignore' })
try {
  let ready = false
  for (let i = 0; i < 100; i++) {
    assert.equal(server.exitCode, null)
    try { if ((await fetch(`${base}/api/health`)).ok) { ready = true; break } } catch { /* local bounded startup */ }
    await Bun.sleep(100)
  }
  assert(ready)
  assert.equal((await fetch(`${base}/api/ops/summary`)).status, 404)
  assert.equal((await fetch(`${base}/admin/ops`)).status, 404)
  assert.equal((await fetch(base)).status, 200)
  const signature = createHmac('sha256', state.secret).update(state.token).digest('base64')
  const response = await fetch(`${base}/api/auth/get-session`, { headers: { cookie: `better-auth.session_token=${encodeURIComponent(`${state.token}.${signature}`)}` } })
  assert.equal(response.status, 200); assert.equal((await response.json()).user.id, state.operator)
  console.info('[ops-admin] Removal/rebuild preserves baseline session, login API and database health; Ops routes 404')
}
finally { server.kill('SIGTERM'); await server.exited }
