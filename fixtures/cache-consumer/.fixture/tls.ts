import assert from 'node:assert/strict'
import { createCache } from '@repo/nuxt-cache/server'

const cache = createCache({ url: process.env.CACHE_URL, env: {} })
try {
  await assert.rejects(cache.checkCache(), { code: 'unavailable' })
  console.info('[cache] Untrusted TLS certificate rejected without disabling verification')
}
finally { await cache.close() }
