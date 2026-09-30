import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createClient } from 'redis'
import { createCache, CacheError, resolveCacheConfig } from '@repo/nuxt-cache/server'
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
  const other = createCache({ url, keyPrefix: `${prefix}-other`, env: {} })
  try { assert.equal(await other.get('default'), null) }
  finally { await other.close() }
  await raw.set(`${prefix}:value:oversized`, Buffer.alloc(1048577), { expiration: { type: 'EX', value: 10 } })
  await assert.rejects(cache.get('oversized'), { code: 'invalid-input' })
  await cache.setPersistent('persistent', '0')
  assert.equal(await raw.pTTL(`${prefix}:value:persistent`), -1)
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
  const racing = createCache({ url, env: {} })
  const pending = racing.checkCache().catch(error => { assert.equal(error.code, 'closed') })
  await racing.close()
  await pending
  assert.equal('eval' in cache, false)
  assert.equal('keys' in cache, false)
  assert.equal('flush' in cache, false)
  console.info('[cache] Node 24 real Valkey bounds, TTL, atomicity, lease, pub/sub and lifecycle passed')
}
finally {
  for (const key of ['exact', 'default', 'oversized', 'persistent', 'counter']) await cache.delete(key)
  await cache.close()
  await raw.close()
}
