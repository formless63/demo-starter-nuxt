// Repository-only proof: an independent disposable backend lives across the
// actual generic pack/install/removal lifecycle. No alternate removal machinery.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createClient, RESP_TYPES } from 'redis'
import { createCache } from '@repo/nuxt-cache/server'
import { compose, startValkey } from './valkey'

const project = `cache-removal-${randomUUID().slice(0, 8)}`
const reader = (url: string) => createClient({ url, socket: { reconnectStrategy: false } }).withTypeMapping({ [RESP_TYPES.BLOB_STRING]: Buffer })
let raw: ReturnType<typeof reader> | undefined
try {
  const url = await startValkey(project)
  const keyPrefix = `retained-${randomUUID()}`
  const cache = createCache({ url, keyPrefix, env: {} })
  const bytes = Buffer.from([0, 255, 128, 1])
  try { await cache.setWithoutExpiry('existing', bytes) }
  finally { await cache.close() }
  const lifecycle = Bun.spawn(['bun', 'run', 'packages:test', 'cache-coordination'], {
    env: { ...process.env, CACHE_URL: url, CACHE_KEY_PREFIX: keyPrefix }, stdout: 'inherit', stderr: 'inherit',
  })
  assert.equal(await lifecycle.exited, 0, 'Actual generic Cache install/removal lifecycle')
  raw = reader(url)
  raw.on('error', () => {})
  await raw.connect()
  assert.deepEqual(await raw.get(`${keyPrefix}:value:existing`), bytes, 'External data survives application/package removal')
  assert.equal(await raw.pTTL(`${keyPrefix}:value:existing`), -1)
  console.info('[cache] External data retained across generic application/package removal')
}
finally {
  await raw?.close()
  await compose(project, ['down', '--remove-orphans'])
}
