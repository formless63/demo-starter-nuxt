import { randomBytes } from 'node:crypto'
import { ConnectionTimeoutError, createClient, ErrorReply, RESP_TYPES, SocketTimeoutError, TimeoutError } from 'redis'
import { CacheError, resolveCacheConfig, validateCacheKey, validateCacheTtl } from './config'
import type { CacheConfig } from './config'
import { incrementValue, readValue, releaseToken, renewToken } from './scripts'

export { CacheError, resolveCacheConfig, validateCacheKey, validateCacheTtl } from './config'
export type { CacheConfig, CacheErrorCode } from './config'

export type CacheOperation = 'check' | 'get' | 'set' | 'set-without-expiry' | 'delete' | 'increment' | 'publish' | 'subscribe' | 'unsubscribe' | 'acquire-lease' | 'renew-lease' | 'release-lease' | 'close'
export interface CacheMeasurement {
  operation: CacheOperation
  outcome: 'success' | 'error'
  duration: number
  hit?: boolean
}
export interface CacheOptions extends CacheConfig {
  env?: NodeJS.ProcessEnv
  onOperation?: (measurement: CacheMeasurement) => void
  onError?: (error: CacheError) => void
}
export interface CacheLease { readonly key: string, readonly token: string }
export interface CacheWriteOptions { ttlSeconds?: number, ifAbsent?: boolean }

// Fixed bounds avoid hanging first-use, half-open commands and shutdown. No offline replay:
// a timeout/disconnect may have committed a write; callers must not blindly retry increments.
const CONNECT_TIMEOUT_MS = 2000
const OPERATION_TIMEOUT_MS = 5000

function safeError(error: unknown): CacheError {
  if (error instanceof CacheError) return error
  if (error instanceof ConnectionTimeoutError || error instanceof SocketTimeoutError || error instanceof TimeoutError) return new CacheError('timeout')
  if (error instanceof ErrorReply && /^(WRONGPASS|NOAUTH|NOPERM)(?:\s|$)/.test(error.message)) return new CacheError('authentication')
  return new CacheError('unavailable')
}

function newClient(url: string) {
  return createClient({
    url, disableOfflineQueue: true, commandsQueueMaxLength: 1024,
    socket: { connectTimeout: CONNECT_TIMEOUT_MS, reconnectStrategy: false },
    commandOptions: { timeout: OPERATION_TIMEOUT_MS },
  }).withTypeMapping({ [RESP_TYPES.BLOB_STRING]: Buffer })
}
type Client = ReturnType<typeof newClient>
interface Connection { client: Client, ready: Promise<Client> }

export function createCache(options: CacheOptions = {}) {
  let config: ReturnType<typeof resolveCacheConfig> | undefined
  let connection: Connection | undefined
  let closed = false
  let closing: Promise<void> | undefined
  const connections = new Set<Connection>()
  const unsubscribers = new Set<() => Promise<void>>()

  function settings() { return config ??= resolveCacheConfig(options, options.env ?? process.env) }
  function assertOpen() { if (closed) throw new CacheError('closed') }
  function reportCallbackError() {
    try { Promise.resolve(options.onError?.(new CacheError('callback-failed'))).catch(() => {}) }
    catch { /* User diagnostics must not escape an EventEmitter callback. */ }
  }
  function destroy(slot: Connection) {
    connections.delete(slot)
    if (connection === slot) connection = undefined
    // node-redis destroy is idempotent, including after terminal failure/graceful close.
    slot.client.destroy()
  }
  async function bounded<T>(action: Promise<T>, slot: Connection): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([action, new Promise<never>((_, reject) => {
        timer = setTimeout(() => { reject(new CacheError('timeout')); destroy(slot) }, OPERATION_TIMEOUT_MS)
        timer.unref()
      })])
    }
    finally { if (timer) clearTimeout(timer) }
  }
  function connect(): Connection {
    assertOpen()
    let client: Client
    try { client = newClient(settings().url) }
    catch (error) { throw error instanceof CacheError ? error : new CacheError('configuration') }
    const slot = { client, ready: undefined as unknown as Promise<Client> }
    connections.add(slot)
    client.on('error', () => { /* Transport errors are sanitized at the operation boundary. */ })
    slot.ready = bounded(client.connect().then(() => {
      assertOpen()
      return client
    }), slot).catch((error) => { destroy(slot); throw closed ? new CacheError('closed') : safeError(error) })
    return slot
  }
  async function command<T>(action: (client: Client) => Promise<T>): Promise<T> {
    assertOpen()
    if (!connection || !connection.client.isOpen) {
      if (connection) destroy(connection)
      connection = connect()
    }
    const slot = connection
    const client = await slot.ready
    try { return await bounded(action(client), slot) }
    catch (error) {
      if (error instanceof Error && ['value bound', 'integer required', 'integer bound', 'value size', 'ERR value is not an integer or out of range'].includes(error.message)) throw new CacheError('invalid-input')
      const safe = safeError(error)
      if (safe.code === 'timeout') destroy(slot)
      throw safe
    }
  }
  async function operation<T>(name: CacheOperation, action: () => Promise<T>): Promise<T> {
    const start = performance.now()
    let outcome: CacheMeasurement['outcome'] = 'success'
    let hit: boolean | undefined
    try {
      if (name !== 'unsubscribe' && name !== 'close') assertOpen()
      const result = await action()
      if (name === 'get') hit = result !== null
      return result
    }
    catch (error) {
      outcome = 'error'
      throw safeError(error)
    }
    finally {
      try { Promise.resolve(options.onOperation?.({ operation: name, outcome, duration: (performance.now() - start) / 1000, ...(hit === undefined ? {} : { hit }) })).catch(() => {}) }
      catch { /* Optional telemetry cannot alter operation results. */ }
    }
  }
  function physical(key: string, kind: 'value' | 'lease' | 'channel' = 'value') {
    return `${settings().keyPrefix}:${kind}:${validateCacheKey(key)}`
  }
  function valueBytes(value: string | Uint8Array): Buffer {
    if (typeof value !== 'string' && !(value instanceof Uint8Array)) throw new CacheError('invalid-input')
    const size = typeof value === 'string' ? Buffer.byteLength(value) : value.byteLength
    if (size > settings().maxValueBytes) throw new CacheError('invalid-input')
    return Buffer.from(value)
  }
  function leaseArgs(lease: CacheLease) {
    if (!lease || typeof lease.token !== 'string' || !/^[a-f0-9]{64}$/.test(lease.token)) throw new CacheError('invalid-input')
    return { key: physical(lease.key, 'lease'), token: lease.token }
  }
  async function write(key: string, value: string | Uint8Array, input: CacheWriteOptions, persistent: boolean) {
    const name = physical(key)
    const bytes = valueBytes(value)
    const ttl = persistent ? undefined : validateCacheTtl(input.ttlSeconds ?? settings().defaultTtlSeconds)
    const result = await command(client => client.set(name, bytes, {
      ...(ttl === undefined ? {} : { expiration: { type: 'EX' as const, value: ttl } }),
      ...(input.ifAbsent ? { condition: 'NX' as const } : {}),
    }))
    return result !== null
  }
  const cache = {
    checkCache: () => operation('check', async () => {
      await command(client => client.ping())
      return { ok: true as const }
    }),
    get: (key: string) => operation('get', async (): Promise<Buffer | null> => {
      const name = physical(key)
      const result = await command(client => client.eval(readValue, { keys: [name], arguments: [String(settings().maxValueBytes)] }))
      return result === null ? null : Buffer.from(result as Uint8Array)
    }),
    set: (key: string, value: string | Uint8Array, input: CacheWriteOptions = {}) => operation('set', () => write(key, value, input, false)),
    // Deliberate escape hatch, never the default cache write.
    setWithoutExpiry: (key: string, value: string | Uint8Array, input: Pick<CacheWriteOptions, 'ifAbsent'> = {}) => operation('set-without-expiry', () => write(key, value, input, true)),
    delete: (key: string) => operation('delete', async () => {
      const name = physical(key)
      return (await command(client => client.del(name))) === 1
    }),
    increment: (key: string, amount = 1, ttlSeconds?: number) => operation('increment', async () => {
      const name = physical(key)
      const ttl = validateCacheTtl(ttlSeconds ?? settings().defaultTtlSeconds)
      if (!Number.isSafeInteger(amount)) throw new CacheError('invalid-input')
      return Number(await command(client => client.eval(incrementValue, { keys: [name], arguments: [String(amount), String(ttl * 1000), String(settings().maxValueBytes)] })))
    }),
    acquireLease: (key: string, ttlSeconds = 30) => operation('acquire-lease', async (): Promise<CacheLease | null> => {
      const name = physical(key, 'lease')
      const ttl = validateCacheTtl(ttlSeconds, true)
      const token = randomBytes(32).toString('hex')
      const result = await command(client => client.set(name, token, { condition: 'NX', expiration: { type: 'PX', value: ttl * 1000 } }))
      return result === null ? null : Object.freeze({ key, token })
    }),
    renewLease: (lease: CacheLease, ttlSeconds = 30) => operation('renew-lease', async () => {
      const { key, token } = leaseArgs(lease)
      const ttl = validateCacheTtl(ttlSeconds, true)
      return Number(await command(client => client.eval(renewToken, { keys: [key], arguments: [token, String(ttl * 1000)] }))) === 1
    }),
    releaseLease: (lease: CacheLease) => operation('release-lease', async () => {
      const { key, token } = leaseArgs(lease)
      return Number(await command(client => client.eval(releaseToken, { keys: [key], arguments: [token] }))) === 1
    }),
    publish: (channel: string, message: string | Uint8Array) => operation('publish', async () => {
      const name = physical(channel, 'channel')
      const bytes = valueBytes(message)
      return command(client => client.publish(name, bytes))
    }),
    subscribe: (channel: string, listener: (message: Buffer) => void | Promise<void>) => operation('subscribe', async () => {
      const name = physical(channel, 'channel')
      if (typeof listener !== 'function') throw new CacheError('invalid-input')
      if (unsubscribers.size >= 32) throw new CacheError('invalid-input')
      const slot = connect() // Dedicated connection per subscription; command client remains independent.
      let stopped = false
      let stopping: Promise<void> | undefined
      const receive = (message: Buffer) => {
        if (stopped || closed) return
        if (message.length > settings().maxValueBytes) { reportCallbackError(); return }
        try { Promise.resolve(listener(message)).catch(() => reportCallbackError()) }
        catch { reportCallbackError() }
      }
      const unsubscribe = () => stopping ??= (async () => {
        stopped = true
        try {
          await slot.ready
          if (slot.client.isReady) await bounded(slot.client.unsubscribe(name, receive, true), slot)
        }
        catch { /* A disconnected subscription is already stopped. */ }
        finally { destroy(slot); unsubscribers.delete(unsubscribe) }
      })()
      unsubscribers.add(unsubscribe)
      slot.client.on('error', () => { void unsubscribe() })
      try {
        const client = await slot.ready
        await bounded(client.subscribe(name, receive, true), slot)
        assertOpen()
        return { unsubscribe: () => operation('unsubscribe', unsubscribe) }
      }
      catch (error) { await unsubscribe(); throw error }
    }),
    close: () => closing ??= operation('close', async () => {
      closed = true // Immediately reject new work, before draining/unsubscribing.
      await Promise.all([...unsubscribers].map(unsubscribe => unsubscribe()))
      await Promise.all([...connections].map(async (slot) => {
        try {
          await slot.ready.catch(() => undefined) // Settle first-use races before final disposal.
          if (slot.client.isOpen) await bounded(slot.client.close(), slot)
        }
        catch { /* Shutdown remains bounded when the backend is unavailable. */ }
        finally { destroy(slot) }
      }))
    }),
  }
  return cache
}

export type Cache = ReturnType<typeof createCache>
let singleton: Cache | undefined
export function getCache() { return singleton ??= createCache() }
export function checkCache() { return getCache().checkCache() }
export async function closeCache() {
  const cache = singleton
  singleton = undefined
  await cache?.close()
}
