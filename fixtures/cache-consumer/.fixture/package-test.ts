import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:net'
import { chmod, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCache, closeCache } from '@repo/nuxt-cache/server'
import { smokeCache } from '@repo/nuxt-cache/testing'
import { compose, startValkey } from './valkey'

const backendlessEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('CACHE_')))
async function boot(env: NodeJS.ProcessEnv, check = false) {
  const reservation = createServer()
  await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve))
  const port = (reservation.address() as { port: number }).port
  await new Promise<void>((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()))
  const server = Bun.spawn(['node', '.output/server/index.mjs'], {
    env: { ...backendlessEnv, ...env, PORT: String(port), NITRO_PORT: String(port), HOST: '127.0.0.1', NITRO_HOST: '127.0.0.1' }, stdout: 'ignore', stderr: 'ignore',
  })
  try {
    const deadline = Date.now() + 15000
    let ready = false
    while (Date.now() < deadline) {
      assert.equal(server.exitCode, null, 'Production Node fixture must stay running')
      try {
        if ((await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(2000) })).status === 200) { ready = true; break }
      }
      catch { /* Bounded startup polling. */ }
      await Bun.sleep(250)
    }
    assert(ready, 'Production Node fixture must boot')
    if (check) assert.deepEqual(await (await fetch(`http://127.0.0.1:${port}/api/check`)).json(), { ok: true })
  }
  finally {
    server.kill('SIGTERM')
    const stopped = await Promise.race([server.exited.then(() => true), Bun.sleep(15000).then(() => false)])
    if (!stopped) { server.kill('SIGKILL'); await server.exited }
    assert(stopped, 'Production Node fixture must stop gracefully')
  }
}
await boot({})
await boot({ CACHE_URL: 'redis://127.0.0.1:1' })
console.info('[cache] Installed but unconfigured/unavailable production boots passed')
const project = `cache-test-${randomUUID().slice(0, 8)}`
let cache: ReturnType<typeof createCache> | undefined
let certDir: string | undefined
try {
  const url = await startValkey(project)
  const node = Bun.spawn(['node', '--experimental-strip-types', '.fixture/contract.ts'], {
    env: { ...process.env, CACHE_URL: url }, stdout: 'inherit', stderr: 'inherit',
  })
  assert.equal(await node.exited, 0, 'Full protocol contract in production Node 24')
  cache = createCache({ url, keyPrefix: `bun-${randomUUID()}`, env: {} })
  await smokeCache(cache) // Bun tooling also supports the same client/API.
  console.info('[cache] Bun primitive smoke passed')
  await boot({ CACHE_URL: url, CACHE_KEY_PREFIX: `module-${randomUUID()}` }, true)
  console.info('[cache] Nuxt server auto-import passed')
  const subscription = await cache.subscribe('reconnect', () => { assert.fail('Failed subscriptions must not resume implicitly') })
  await compose(project, ['stop', 'valkey'])
  await assert.rejects(cache.checkCache(), { code: 'unavailable' })
  // Dynamic published ports can change on restart; rebind the original port explicitly.
  await compose(project, ['up', '-d', '--wait', 'valkey'], new URL(url).port)
  assert.deepEqual(await cache.checkCache(), { ok: true }, 'Same instance reconnects on next explicit operation')
  assert.equal(await cache.publish('reconnect', 'no continuity'), 0, 'Command reconnect never resubscribes failed subscriptions')
  await subscription.unsubscribe()
  const renewed = await cache.subscribe('reconnect', () => {})
  assert.equal(await cache.publish('reconnect', 'explicit subscription'), 1)
  await renewed.unsubscribe()
  // Real TLS Valkey, ephemeral test CA: reject untrusted, succeed with Node's normal CA extension.
  console.info('[cache] Deterministic explicit reconnect passed')
  certDir = await mkdtemp(join(tmpdir(), 'cache-tls-'))
  async function openssl(args: string[]) {
    const child = Bun.spawn(['openssl', ...args], { cwd: certDir, stdout: 'ignore', stderr: 'ignore' })
    assert.equal(await child.exited, 0, 'Generate temporary TLS test certificates')
  }
  await openssl(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=Cache Fixture CA', '-keyout', 'ca.key', '-out', 'ca.crt'])
  await openssl(['req', '-newkey', 'rsa:2048', '-nodes', '-subj', '/CN=localhost', '-addext', 'subjectAltName=IP:127.0.0.1,DNS:localhost', '-keyout', 'server.key', '-out', 'server.csr'])
  await openssl(['x509', '-req', '-in', 'server.csr', '-CA', 'ca.crt', '-CAkey', 'ca.key', '-CAcreateserial', '-days', '1', '-copy_extensions', 'copy', '-out', 'server.crt'])
  await chmod(certDir, 0o755)
  // These fresh disposable fixture files must be readable by the container's Valkey user.
  for (const file of ['ca.crt', 'server.crt', 'server.key']) await chmod(join(certDir, file), 0o644)
  await compose(project, ['up', '-d', '--wait', 'valkey'], '0', certDir)
  const address = await compose(project, ['port', 'valkey', '6380'], '0', certDir)
  const tlsEnv = { ...process.env, CACHE_URL: `rediss://${address}` }
  const rejected = Bun.spawn(['node', '--experimental-strip-types', '.fixture/tls.ts'], { env: tlsEnv, stdout: 'inherit', stderr: 'inherit' })
  assert.equal(await rejected.exited, 0, 'Untrusted TLS cannot connect')
  const trusted = Bun.spawn(['node', '--experimental-strip-types', '.fixture/contract.ts'], {
    env: { ...tlsEnv, NODE_EXTRA_CA_CERTS: join(certDir, 'ca.crt') }, stdout: 'inherit', stderr: 'inherit',
  })
  assert.equal(await trusted.exited, 0, 'Full contract over verified TLS')
  await cache.close()
  await assert.rejects(cache.checkCache(), { code: 'closed' })
  await cache.close()
  await closeCache()
  console.info('[cache] Bun client, Nuxt import, deterministic reconnect and graceful close passed')
}
finally {
  await cache?.close()
  await closeCache()
  await compose(project, ['down', '--remove-orphans'], '0', certDir)
  if (certDir) await rm(certDir, { recursive: true, force: true })
}
