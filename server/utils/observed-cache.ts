import { createCache } from '@repo/nuxt-cache/server'
import type { CacheMeasurement } from '@repo/nuxt-cache/server'
import { getLogger, getMeter } from '@repo/nuxt-observability/server'

// Optional app-owned adapter. Receives no keys/channels/values/tokens/URL/errors.
export function recordCacheOperation(measurement: CacheMeasurement) {
  const { operation, outcome, duration, hit } = measurement
  const attributes = { 'app.cache.operation': operation, 'app.cache.outcome': outcome,
    ...(hit === undefined ? {} : { 'app.cache.result': hit ? 'hit' : 'miss' }) }
  getMeter().createHistogram('app.cache.operation.duration', { unit: 's' }).record(duration, attributes)
  getLogger().info({ operation, outcome, duration, ...(hit === undefined ? {} : { result: hit ? 'hit' : 'miss' }) }, 'cache.operation')
}
let applicationCache: ReturnType<typeof createCache> | undefined
export function getObservedCache() { return applicationCache ??= createCache({ onOperation: recordCacheOperation }) }
export async function closeObservedCache() { await applicationCache?.close(); applicationCache = undefined }
