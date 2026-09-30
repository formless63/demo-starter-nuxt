import { createCache, CacheError } from '@repo/nuxt-cache/server'
import { smokeCache } from '@repo/nuxt-cache/testing'
import { recordCacheOperation } from '../server/utils/observed-cache'
import { initializeObservability, shutdownObservability } from '@repo/nuxt-observability/server'

initializeObservability({ serviceName: 'nuxt-starter-cache-check' })
const cache = createCache({ onOperation: recordCacheOperation })
try {
  if (Bun.argv[2] === 'check') await cache.checkCache()
  else if (Bun.argv[2] === 'smoke') await smokeCache(cache)
  else throw new CacheError('invalid-input')
  console.info('Cache verification passed')
}
catch (error) {
  console.error(error instanceof CacheError ? error.message : 'Cache verification failed')
  process.exitCode = 1
}
finally { await cache.close(); await shutdownObservability() }
