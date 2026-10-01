import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import type { Cache } from './index'

// Uses only unique exact keys/channels and token-safe release; safe for a configured backend.
export async function smokeCache(cache: Cache) {
  const base = `smoke/${randomUUID()}`
  const keys = ['value', 'bytes', 'expires', 'nx', 'counter', 'persistent'].map(key => `${base}/${key}`)
  const channel = `${base}/channel`
  const leaseKey = `${base}/lease`
  let subscription: Awaited<ReturnType<Cache['subscribe']>> | undefined
  let lease: Awaited<ReturnType<Cache['acquireLease']>> = null
  const waitFor = async (action: () => Promise<boolean>, label: string, timeout = 12000) => {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      if (await action()) return
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    assert.fail(label)
  }
  try {
    assert.deepEqual(await cache.checkCache(), { ok: true })
    assert.equal(await cache.get(keys[0]!), null)
    assert.equal(await cache.set(keys[0]!, 'hello'), true)
    assert.equal((await cache.get(keys[0]!))?.toString(), 'hello')
    assert.equal(await cache.delete(keys[0]!), true)
    assert.equal(await cache.delete(keys[0]!), false)
    const bytes = Buffer.from([0, 255, 13, 10, 128])
    await cache.set(keys[1]!, bytes)
    assert.deepEqual(await cache.get(keys[1]!), bytes)
    await cache.set(keys[2]!, 'expires', { ttlSeconds: 2 })
    await waitFor(async () => await cache.get(keys[2]!) === null, 'TTL expiration')
    const nx = await Promise.all(Array.from({ length: 20 }, () => cache.set(keys[3]!, 'winner', { ifAbsent: true })))
    assert.equal(nx.filter(Boolean).length, 1)
    const increments = await Promise.all(Array.from({ length: 100 }, () => cache.increment(keys[4]!, 1, 10)))
    assert.deepEqual(increments.sort((a, b) => a - b), Array.from({ length: 100 }, (_, i) => i + 1))
    assert.equal((await cache.get(keys[4]!))?.toString(), '100')
    // Counters have an initial TTL; adding again must not extend it.
    await cache.delete(keys[4]!)
    assert.equal(await cache.increment(keys[4]!, 1, 2), 1)
    assert.equal(await cache.increment(keys[4]!, 1, 60), 2)
    await waitFor(async () => await cache.get(keys[4]!) === null, 'Initial counter TTL retained')
    await cache.setWithoutExpiry(keys[5]!, 'persistent')
    assert.equal((await cache.get(keys[5]!))?.toString(), 'persistent')
    const contenders = await Promise.all(Array.from({ length: 20 }, () => cache.acquireLease(leaseKey, 10)))
    assert.equal(contenders.filter(Boolean).length, 1)
    lease = contenders.find(Boolean)!
    const wrong = { key: leaseKey, token: '0'.repeat(64) }
    assert.equal(await cache.releaseLease(wrong), false)
    assert.equal(await cache.renewLease(wrong, 10), false)
    assert.equal(await cache.renewLease(lease!, 10), true)
    assert.equal(await cache.acquireLease(leaseKey, 10), null)
    assert.equal(await cache.releaseLease(lease!), true)
    lease = await cache.acquireLease(leaseKey, 2)
    const stale = lease!
    await waitFor(async () => {
      const replacement = await cache.acquireLease(leaseKey, 10)
      if (!replacement) return false
      lease = replacement
      return true
    }, 'Lease expiry/replacement')
    assert.notEqual(lease!.token, stale.token)
    assert.equal(await cache.releaseLease(stale), false)
    assert.equal(await cache.renewLease(stale, 10), false)
    assert.equal(await cache.acquireLease(leaseKey, 10), null)
    const messages: Buffer[] = []
    subscription = await cache.subscribe(channel, (message) => { messages.push(message) })
    assert.equal(await cache.publish(channel, bytes), 1)
    await waitFor(async () => messages.length === 1, 'pub/sub delivery')
    assert.deepEqual(messages[0], bytes)
    await subscription.unsubscribe()
    await subscription.unsubscribe()
    assert.equal(await cache.publish(channel, 'after unsubscribe'), 0)
    assert.equal(messages.length, 1)
    console.info('[cache] real backend primitive smoke passed')
    return { ok: true as const }
  }
  finally {
    await subscription?.unsubscribe()
    if (lease) await cache.releaseLease(lease)
    await Promise.all(keys.map(key => cache.delete(key)))
  }
}
