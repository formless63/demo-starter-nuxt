import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createClient } from 'redis'
import { createServer, type Socket } from 'node:net'
import { createCache, closeCache, getCache, CacheError, resolveCacheConfig } from '@repo/nuxt-cache/server'
import { smokeCache } from '@repo/nuxt-cache/testing'

const url = process.env.CACHE_URL!
const prefix = `fixture-${randomUUID()}`
const cache = createCache({ url, keyPrefix: prefix, env: {} })
const raw = createClient({ url, socket: { reconnectStrategy: false } })
raw.on('error', () => {})
const waitFor = async (action: () => Promise<boolean>, label: string) => {
  const deadline = Date.now() + 12000
  while (Date.now() < deadline) {
    if (await action()) return
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  assert.fail(label)
}
try {
  await raw.connect()
  assert.deepEqual(await smokeCache(cache), { ok: true })
  assert.equal(resolveCacheConfig({ url }, {}).defaultTtlSeconds, 300)
  assert.equal(resolveCacheConfig({ url }, {}).keyPrefix, 'app')
  assert.equal(resolveCacheConfig({ url }, {}).maxValueBytes, 1048576)
  for (const options of [{ url: `${url}/?private=value` }, { url: `${url}/?` }, { url: `${url}/#private` }, { url: `${url}/#` }, { url: `${url}/not-a-db` }, { url, keyPrefix: 'a'.repeat(129) }, { url, maxValueBytes: 1048577 }, { url, defaultTtlSeconds: 86401 }]) {
    assert.throws(() => resolveCacheConfig(options, {}), { code: 'configuration' })
  }
  assert.equal(resolveCacheConfig({ url, keyPrefix: 'a'.repeat(128), defaultTtlSeconds: 86400 }, {}).defaultTtlSeconds, 86400)
  for (const bad of ['', '../bad', 'a//b', 'a b', 'a\nb', 'a*', 'a?b', 'a\\b', 'a'.repeat(257)]) {
    await assert.rejects(cache.get(bad), { code: 'invalid-input' })
  }
  for (const ttlSeconds of [0, -1, 86401, 1.5, NaN]) await assert.rejects(cache.set('ttl', 'x', { ttlSeconds }), { code: 'invalid-input' })
  for (const ttl of [0, 1, 301]) await assert.rejects(cache.acquireLease('lease', ttl), { code: 'invalid-input' })
  await assert.rejects(cache.set('large', Buffer.alloc(1048577)), { code: 'invalid-input' })
  await assert.rejects(cache.publish('large', Buffer.alloc(1048577)), { code: 'invalid-input' })
  await assert.rejects(cache.subscribe('a*', () => {}), { code: 'invalid-input' })
  await cache.set('exact', Buffer.alloc(1048576))
  assert.equal((await cache.get('exact'))?.length, 1048576)
  assert.equal(await raw.pTTL(`${prefix}:value:exact`) > 0, true)
  await cache.set('default', 'x')
  assert(await raw.ttl(`${prefix}:value:default`) >= 295, 'Default approximately 300 seconds')
  assert.equal(await raw.get('default'), null, 'Logical keys never sent unprefixed')
  await cache.set('maximum-ttl', 'x', { ttlSeconds: 86400 })
  assert(await raw.ttl(`${prefix}:value:maximum-ttl`) >= 86395)
  const other = createCache({ url, keyPrefix: `${prefix}-other`, env: {} })
  try { assert.equal(await other.get('default'), null) }
  finally { await other.close() }
  await raw.set(`${prefix}:value:oversized`, Buffer.alloc(1048577), { expiration: { type: 'EX', value: 10 } })
  await assert.rejects(cache.get('oversized'), { code: 'invalid-input' })
  await cache.setWithoutExpiry('persistent', '0')
  assert.equal(await raw.pTTL(`${prefix}:value:persistent`), -1)
  assert.equal(await cache.setWithoutExpiry('persistent', 'replacement', { ifAbsent: true }), false)
  assert.equal((await cache.get('persistent'))?.toString(), '0')
  await cache.increment('persistent', 1, 10)
  assert(await raw.pTTL(`${prefix}:value:persistent`) > 0, 'Persistent counters acquire TTL atomically')
  await cache.increment('counter', 1, 10)
  const initial = await raw.pTTL(`${prefix}:value:counter`)
  await cache.increment('counter', 1, 60)
  assert(await raw.pTTL(`${prefix}:value:counter`) <= initial, 'Increment never refreshes initial TTL')
  await cache.set('counter', String(Number.MAX_SAFE_INTEGER))
  await assert.rejects(cache.increment('counter'), { code: 'invalid-input' })
  assert.equal((await cache.get('counter'))?.toString(), String(Number.MAX_SAFE_INTEGER), 'Rejected overflow never mutates')
  await assert.rejects(cache.increment('counter', 1.5), { code: 'invalid-input' })
  await cache.set('counter', 'noninteger')
  await assert.rejects(cache.increment('counter'), { code: 'invalid-input' })
  assert.equal((await cache.get('counter'))?.toString(), 'noninteger')
  const limited = createCache({ url, keyPrefix: `${prefix}-limited`, maxValueBytes: 1, env: {} })
  try {
    await assert.rejects(limited.set('value', 'xx'), { code: 'invalid-input' })
    await limited.increment('value', 9)
    await assert.rejects(limited.increment('value'), { code: 'invalid-input' })
    assert.equal((await limited.get('value'))?.toString(), '9')
    await limited.delete('value')
  }
  finally { await limited.close() }
  const lease = await cache.acquireLease('renew', 2)
  assert(lease)
  const before = await raw.pTTL(`${prefix}:lease:renew`)
  assert.equal(await cache.renewLease(lease, 10), true)
  assert(await raw.pTTL(`${prefix}:lease:renew`) > before + 5000, 'Renew extends expiry')
  await new Promise(resolve => setTimeout(resolve, 2500))
  assert.equal(await cache.acquireLease('renew', 10), null, 'Renewal outlives original lease')
  await cache.releaseLease(lease)
  const longestLease = await cache.acquireLease('maximum-lease', 300)
  assert(longestLease && Object.isFrozen(longestLease))
  assert(await raw.pTTL(`${prefix}:lease:maximum-lease`) >= 295000)
  await cache.set('maximum-lease', 'independent value')
  await cache.delete('maximum-lease')
  assert.equal(await cache.acquireLease('maximum-lease'), null, 'Value deletion cannot delete a lease')
  await cache.releaseLease(longestLease)
  const errors: CacheError[] = []
  const subscriber = createCache({ url, keyPrefix: prefix, env: {}, onError: error => errors.push(error) })
  try {
    const handle = await subscriber.subscribe('callback', async () => { throw new Error('SECRET_CALLBACK') })
    await cache.publish('callback', 'x')
    await waitFor(async () => errors.length > 0, 'Safe async callback error')
    assert.equal(errors[0]?.message, 'Cache: callback-failed')
    await subscriber.close() // active subscription must unsubscribe on close
    await handle.unsubscribe() // Also idempotent after instance close.
    assert.equal(await cache.publish('callback', 'x'), 0)
    await assert.rejects(subscriber.get('x'), { code: 'closed' })
  }
  finally { await subscriber.close() }
  const brokenTelemetry = createCache({ url, keyPrefix: prefix, env: {}, onOperation: async () => { throw new Error('SECRET_TELEMETRY') }, onError: async () => { throw new Error('SECRET_DIAGNOSTIC') } })
  try {
    assert.deepEqual(await brokenTelemetry.checkCache(), { ok: true })
    const handle = await brokenTelemetry.subscribe('broken-telemetry', async () => { throw new Error('SECRET_CALLBACK') })
    await cache.publish('broken-telemetry', 'x')
    await new Promise(resolve => setTimeout(resolve, 100))
    await handle.unsubscribe()
  }
  finally { await brokenTelemetry.close() }
  const boundedSubscriptions = createCache({ url, keyPrefix: prefix, env: {} })
  try {
    const handles = await Promise.all(Array.from({ length: 32 }, (_, i) => boundedSubscriptions.subscribe(`bounded/${i}`, () => {})))
    await assert.rejects(boundedSubscriptions.subscribe('bounded/overflow', () => {}), { code: 'invalid-input' })
    await handles[0]!.unsubscribe()
    const replacement = await boundedSubscriptions.subscribe('bounded/replacement', () => {})
    await replacement.unsubscribe()
  }
  finally { await boundedSubscriptions.close() }
  const username = `fixture_${randomUUID().replaceAll('-', '')}`
  await raw.aclSetUser(username, ['on', '>fixture-password', '~*', '+@all'])
  const authUrl = new URL(url); authUrl.username = username; authUrl.password = 'SECRET_WRONG_PASSWORD'
  const unauthorized = createCache({ url: authUrl.href, env: {} })
  try {
    await assert.rejects(unauthorized.checkCache(), error => error instanceof CacheError && error.code === 'authentication' && !JSON.stringify(error).includes('SECRET'))
  }
  finally { await unauthorized.close(); await raw.aclDelUser(username) }
  const sockets = new Set<Socket>()
  const blackhole = createServer((socket) => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)) })
  await new Promise<void>(resolve => blackhole.listen(0, '127.0.0.1', resolve))
  const stalled = createCache({ url: `redis://127.0.0.1:${(blackhole.address() as { port: number }).port}`, env: {} })
  try {
    const start = performance.now()
    await assert.rejects(stalled.checkCache(), { code: 'timeout' })
    assert(performance.now() - start < 7000, 'Unresponsive protocol handshake is bounded')
  }
  finally {
    await stalled.close()
    for (const socket of sockets) socket.destroy()
    await new Promise<void>(resolve => blackhole.close(() => resolve()))
  }
  const unavailable = createCache({ url: 'redis://SECRET_USER:SECRET_PASSWORD@127.0.0.1:1', env: {} })
  try {
    const start = performance.now()
    await assert.rejects(unavailable.checkCache(), error => error instanceof CacheError && error.message === 'Cache: unavailable' && !JSON.stringify(error).includes('SECRET'))
    assert(performance.now() - start < 7000)
  }
  finally { await unavailable.close() }
  const lazy = createCache({ env: {} })
  await assert.rejects(lazy.checkCache(), { code: 'configuration' })
  await lazy.close()
  const previousUrl = process.env.CACHE_URL
  const manual = createCache({ url, env: {} })
  try {
    process.env.CACHE_URL = url
    const singleton = getCache()
    assert.deepEqual(await singleton.checkCache(), { ok: true })
    await closeCache()
    await assert.rejects(singleton.checkCache(), { code: 'closed' })
    assert.deepEqual(await manual.checkCache(), { ok: true }, 'closeCache never closes caller-owned instances')
    assert.notEqual(getCache(), singleton, 'Singleton resets for explicit later use')
    await closeCache()
  }
  finally {
    if (previousUrl === undefined) delete process.env.CACHE_URL
    else process.env.CACHE_URL = previousUrl
    await manual.close(); await closeCache()
  }
  const racing = createCache({ url, env: {} })
  const pending = racing.checkCache().catch(error => { assert.equal(error.code, 'closed') })
  await racing.close()
  await pending
  for (const method of ['eval', 'keys', 'scan', 'flush', 'flushAll', 'client', 'getBytes', 'setPersistent']) assert.equal(method in cache, false)
  console.info('[cache] Node 24 real Valkey bounds, TTL, atomicity, lease, pub/sub and lifecycle passed')
}
finally {
  for (const key of ['exact', 'default', 'maximum-ttl', 'oversized', 'persistent', 'counter']) await cache.delete(key)
  await cache.close()
  await raw.close()
}
