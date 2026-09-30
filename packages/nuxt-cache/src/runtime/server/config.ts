export type CacheErrorCode = 'configuration' | 'invalid-input' | 'unavailable' | 'closed' | 'callback-failed'
export class CacheError extends Error {
  constructor(public readonly code: CacheErrorCode) {
    super(`Cache: ${code}`)
    this.name = 'CacheError'
  }
}

export interface CacheConfig {
  url?: string
  keyPrefix?: string
  defaultTtlSeconds?: number
  maxValueBytes?: number
}

export function validateCacheKey(key: string): string {
  if (typeof key !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9:_./-]*$/.test(key)
    || Buffer.byteLength(key) > 256 || key.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new CacheError('invalid-input')
  }
  return key
}

export function validateCacheTtl(seconds: number, lease = false): number {
  if (!Number.isInteger(seconds) || seconds < (lease ? 2 : 1) || seconds > (lease ? 300 : 86400)) {
    throw new CacheError('invalid-input')
  }
  return seconds
}

export function resolveCacheConfig(options: CacheConfig = {}, env: NodeJS.ProcessEnv = process.env) {
  const url = options.url ?? env.CACHE_URL
  const keyPrefix = options.keyPrefix ?? (env.CACHE_KEY_PREFIX || 'nuxt-cache')
  const defaultTtlSeconds = options.defaultTtlSeconds ?? Number(env.CACHE_DEFAULT_TTL_SECONDS || 300)
  const maxValueBytes = options.maxValueBytes ?? Number(env.CACHE_MAX_VALUE_BYTES || 1048576)
  try {
    if (!url || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(keyPrefix)) throw new Error()
    const parsed = new URL(url)
    if (!['redis:', 'rediss:'].includes(parsed.protocol) || !parsed.hostname || parsed.search || parsed.hash
      || !/^\/(?:\d+)?$/.test(parsed.pathname || '/') || (parsed.port && Number(parsed.port) === 0)) throw new Error()
    validateCacheTtl(defaultTtlSeconds)
    if (!Number.isInteger(maxValueBytes) || maxValueBytes < 1 || maxValueBytes > 1048576) throw new Error()
  }
  catch { throw new CacheError('configuration') }
  return { url: url!, keyPrefix, defaultTtlSeconds, maxValueBytes }
}
