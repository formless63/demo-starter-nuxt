import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { createServer as httpServer, request as httpRequest } from 'node:http'
import { createServer, connect } from 'node:net'
import postgres from 'postgres'
import { startProvider, compose as storageCompose } from '../../storage-consumer/.fixture/providers'
import { startValkey, compose as cacheCompose } from '../../cache-consumer/.fixture/valkey'
const suffix = crypto.randomUUID().replaceAll('-', '')
const project = `ops-protocol-${suffix.slice(0, 8)}`
const role = `ops_reader_${suffix}`
const operator = `ops_protocol_${suffix}`
const token = crypto.randomUUID(), secret = 'disposable-ops-protocol-auth-secret-32-characters'
const sql = postgres(process.env.DATABASE_URL!, { max: 1 })
let backend: Awaited<ReturnType<typeof startProvider>> | undefined
let app: ReturnType<typeof Bun.spawn> | undefined
let heads = 0, failStorage = false
const commands: string[] = []
const sockets = new Set<import('node:net').Socket>()
const storageProxy = httpServer((request, response) => {
  assert.equal(request.method, 'HEAD'); heads++
  if (failStorage) { response.writeHead(503); response.end(); return }
  const target = new URL(request.url!, backend!.config.endpoint)
  const upstream = httpRequest(target, { method: 'HEAD', headers: request.headers }, (result) => { response.writeHead(result.statusCode!, result.headers); result.pipe(response) })
  upstream.on('error', () => { response.writeHead(503); response.end() }); request.pipe(upstream)
})
let redisTarget: URL
const cacheProxy = createServer((socket) => {
  sockets.add(socket); socket.on('close', () => sockets.delete(socket))
  const upstream = connect(Number(redisTarget.port), redisTarget.hostname)
  sockets.add(upstream); upstream.on('close', () => sockets.delete(upstream))
  let pending = Buffer.alloc(0)
  socket.on('data', (data) => {
    pending = Buffer.concat([pending, data])
    while (pending.length) {
      const line = pending.indexOf('\r\n'); if (line < 0) break
      assert.equal(pending[0], 42)
      const count = Number(pending.subarray(1, line).toString()); let offset = line + 2; const args: string[] = []
      for (let i = 0; i < count; i++) {
        const end = pending.indexOf('\r\n', offset); if (end < 0) break
        assert.equal(pending[offset], 36); const size = Number(pending.subarray(offset + 1, end).toString())
        if (pending.length < end + 2 + size + 2) break
        args.push(pending.subarray(end + 2, end + 2 + size).toString()); offset = end + 2 + size + 2
      }
      if (args.length !== count) break
      const command = args[0]!.toUpperCase(); commands.push(command)
      assert(['HELLO', 'AUTH', 'SELECT', 'CLIENT', 'PING'].includes(command), 'Ops cache allows connection/PING only')
      if (command === 'CLIENT') assert(['SETINFO', 'SETNAME', 'MAINT_NOTIFICATIONS'].includes(args[1]!.toUpperCase()))
      pending = pending.subarray(offset)
    }
    upstream.write(data)
  })
  upstream.on('data', data => socket.write(data))
  upstream.on('error', () => { console.info('[ops-fixture] local upstream transport failed'); socket.destroy() }); socket.on('error', () => upstream.destroy()); socket.on('close', () => upstream.destroy())
})
async function listen(server: import('node:net').Server) { await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); return (server.address() as { port: number }).port }
try {
  backend = await startProvider('rustfs', project, true)
  redisTarget = new URL(await startValkey(project))
  const storagePort = await listen(storageProxy), cachePort = await listen(cacheProxy)
  const reservation = createServer(); const port = await listen(reservation); await new Promise<void>(resolve => reservation.close(() => resolve()))
  const base = `http://127.0.0.1:${port}`
  await sql.unsafe(`CREATE ROLE "${role}" LOGIN PASSWORD 'local-disposable-reader'`)
  await sql.unsafe(`ALTER ROLE "${role}" SET default_transaction_read_only = on`)
  await sql.unsafe(`GRANT USAGE ON SCHEMA pgboss TO "${role}"`)
  await sql.unsafe(`GRANT SELECT ON ALL TABLES IN SCHEMA pgboss TO "${role}"`)
  const readerUrl = new URL(process.env.DATABASE_URL!); readerUrl.username = role; readerUrl.password = 'local-disposable-reader'
  await sql`INSERT INTO "user" (id,name,email) VALUES (${operator},'Disposable Ops fixture',${operator + '@example.test'})`
  await sql`INSERT INTO session (id,token,user_id,expires_at) VALUES (${crypto.randomUUID()},${token},${operator},now()+interval '1 hour')`
  app = Bun.spawn(['node', '.output/server/index.mjs'], { env: { ...process.env, NITRO_PORT: String(port), NITRO_HOST: '127.0.0.1', NUXT_DATABASE_URL: process.env.DATABASE_URL, NUXT_AUTH_SECRET: secret, NUXT_PUBLIC_APP_BASE_URL: base, OPS_ADMIN_USER_IDS: operator, PGBOSS_DATABASE_URL: readerUrl.toString(), STORAGE_BUCKET: backend.config.bucket, STORAGE_REGION: backend.config.region, STORAGE_ENDPOINT: `http://127.0.0.1:${storagePort}`, STORAGE_ACCESS_KEY_ID: backend.config.accessKeyId, STORAGE_SECRET_ACCESS_KEY: backend.config.secretAccessKey, CACHE_URL: `redis://127.0.0.1:${cachePort}` }, stdout: 'pipe', stderr: 'pipe' })
  let ready = false
  for (let i = 0; i < 100; i++) { assert.equal(app.exitCode, null); try { if ((await fetch(`${base}/api/health`)).ok) { ready = true; break } } catch { /* bounded startup */ } await Bun.sleep(100) }
  assert(ready); assert.equal(heads, 0); assert.equal(commands.length, 0)
  assert.equal((await fetch(`${base}/api/ops/summary`)).status, 401); assert.equal(heads, 0); assert.equal(commands.length, 0)
  const signature = createHmac('sha256', secret).update(token).digest('base64')
  const headers = { cookie: `__Secure-better-auth.session_token=${encodeURIComponent(`${token}.${signature}`)}` }
  const response = await fetch(`${base}/api/ops/summary`, { headers }); assert.equal(response.status, 200)
  const cards = (await response.json()).adapters
  assert.equal(cards.find((card: { id: string }) => card.id === 'storage').status, 'ok')
  assert.equal(cards.find((card: { id: string }) => card.id === 'cache').status, 'ok')
  for (const id of ['jobs', 'webhooks']) assert.equal(cards.find((card: { id: string }) => card.id === id).code, 'sample-unknown')
  assert.equal(heads, 1); assert(commands.includes('PING'))
  heads = 0; failStorage = true
  const partial = await fetch(`${base}/api/ops/summary`, { headers }); assert.equal(partial.status, 200)
  const failed = (await partial.json()).adapters
  assert.equal(failed.find((card: { id: string }) => card.id === 'storage').status, 'unavailable')
  assert.equal(failed.find((card: { id: string }) => card.id === 'cache').status, 'ok')
  assert.equal(heads, 1); assert.equal((await fetch(`${base}/api/health`)).status, 200)
  app.kill('SIGTERM'); await app.exited
  const logs = await new Response(app.stdout).text() + await new Response(app.stderr).text()
  for (const privateValue of [operator, token, secret, backend.config.bucket, backend.config.secretAccessKey, role]) assert(!logs.includes(privateValue))
  console.info('[ops-admin] Real RustFS HEAD-only/503 oneHEAD, Valkey connection/PING-only, PostgreSQL read-only Jobs metadata, no startup/unauthorized traffic and health passed')
}
finally {
  if (app?.exitCode === null) { app.kill('SIGTERM'); await app.exited }
  for (const socket of sockets) socket.destroy()
  for (const server of [storageProxy, cacheProxy]) if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()))
  await sql`DELETE FROM "user" WHERE id=${operator}`
  await sql.unsafe(`DROP OWNED BY "${role}"`).catch(() => undefined)
  await sql.unsafe(`DROP ROLE IF EXISTS "${role}"`)
  await sql.end()
  backend?.storage.close()
  await storageCompose(project, ['down', '--volumes', '--remove-orphans']).catch(() => undefined)
  await cacheCompose(project, ['down', '--volumes', '--remove-orphans']).catch(() => undefined)
}
