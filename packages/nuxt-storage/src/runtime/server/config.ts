import { randomUUID } from 'node:crypto'

export type StorageErrorCode = 'configuration' | 'invalid-input' | 'unavailable' | 'not-found' | 'verification-failed'
export class StorageError extends Error {
  constructor(public readonly code: StorageErrorCode) {
    super(`Storage: ${code}`)
    this.name = 'StorageError'
  }
}

export interface StorageConfig {
  bucket?: string
  region?: string
  endpoint?: string
  accessKeyId?: string
  secretAccessKey?: string
  sessionToken?: string
  forcePathStyle?: boolean
  presignTtlSeconds?: number
  keyPrefix?: string
}

export function hasControlCharacters(value: string, spaces = false) {
  return [...value].some(char => char.charCodeAt(0) < (spaces ? 33 : 32) || char.charCodeAt(0) === 127)
}

export function validateStorageKey(key: string): string {
  if (typeof key !== 'string' || !key || Buffer.byteLength(key) > 1024
    || hasControlCharacters(key, true) || /[\\?#%]/.test(key) || key.startsWith('/')
    || key.split('/').some(segment => !segment || segment === '.' || segment === '..')) {
    throw new StorageError('invalid-input')
  }
  return key
}

export function normalizeStoragePrefix(prefix = ''): string {
  const normalized = prefix.replace(/\/+$/, '')
  if (normalized) validateStorageKey(normalized)
  if (prefix.startsWith('/')) throw new StorageError('invalid-input')
  return normalized
}

export function createStorageKey(namespace: string, prefix = ''): string {
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(namespace)) throw new StorageError('invalid-input')
  return validateStorageKey([normalizeStoragePrefix(prefix), namespace, randomUUID()].filter(Boolean).join('/'))
}

export function validateTtl(ttl: number): number {
  if (!Number.isInteger(ttl) || ttl < 30 || ttl > 3600) throw new StorageError('invalid-input')
  return ttl
}

export function resolveStorageConfig(options: StorageConfig = {}, env: NodeJS.ProcessEnv = process.env) {
  const bucket = options.bucket ?? env.STORAGE_BUCKET
  const region = options.region ?? (env.STORAGE_REGION || env.AWS_REGION || env.AWS_DEFAULT_REGION || 'us-east-1')
  const endpoint = options.endpoint ?? env.STORAGE_ENDPOINT
  const accessKeyId = options.accessKeyId ?? env.STORAGE_ACCESS_KEY_ID
  const secretAccessKey = options.secretAccessKey ?? env.STORAGE_SECRET_ACCESS_KEY
  const sessionToken = options.sessionToken ?? env.STORAGE_SESSION_TOKEN
  const pathStyle = env.STORAGE_FORCE_PATH_STYLE || undefined
  const presignTtlSeconds = options.presignTtlSeconds ?? Number(env.STORAGE_PRESIGN_TTL_SECONDS || 600)
  let keyPrefix: string
  try { keyPrefix = normalizeStoragePrefix(options.keyPrefix ?? env.STORAGE_KEY_PREFIX ?? '') }
  catch { throw new StorageError('configuration') }
  if (!bucket || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)
    || !/^[a-z0-9-]{1,64}$/.test(region) || Boolean(accessKeyId) !== Boolean(secretAccessKey)
    || (sessionToken && !accessKeyId) || (pathStyle !== undefined && !['true', 'false'].includes(pathStyle))) {
    throw new StorageError('configuration')
  }
  if (endpoint) {
    let url: URL
    try { url = new URL(endpoint) }
    catch { throw new StorageError('configuration') }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash
      || (url.pathname !== '/' && url.pathname !== '')) throw new StorageError('configuration')
  }
  try { validateTtl(presignTtlSeconds) }
  catch { throw new StorageError('configuration') }
  return {
    bucket, region, endpoint: endpoint || undefined, keyPrefix, presignTtlSeconds,
    forcePathStyle: options.forcePathStyle ?? (pathStyle === undefined ? Boolean(endpoint) : pathStyle === 'true'),
    // Omit credentials completely to retain the SDK's normal workload/default chain.
    credentials: accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey, sessionToken } : undefined,
  }
}

export function safeMetadata(metadata: Record<string, string> = {}) {
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(metadata)) {
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(key) || typeof value !== 'string'
      || /[^\x20-\x7E]/.test(value) || value.length > 512) throw new StorageError('invalid-input')
    result[key] = value
  }
  if (Buffer.byteLength(JSON.stringify(result)) > 2048) throw new StorageError('invalid-input')
  return result
}

export function safeHeader(value?: string) {
  if (value !== undefined && (!value || value.length > 512 || /[^\x20-\x7E]/.test(value))) throw new StorageError('invalid-input')
  return value
}
