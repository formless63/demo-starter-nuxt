// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { createNotificationJobs, createNtfyAdapter, NotificationError, resolveNtfyConfig, validateMetadata, notificationDeliveryPayload } from '@repo/nuxt-notifications/server'
import type { NotificationRecord } from '@repo/nuxt-notifications/server'
const record: NotificationRecord = { id: crypto.randomUUID(), recipientId: 'stable-recipient', type: 'test.created', title: 'Private title', body: 'Private body', metadata: {}, createdAt: new Date(), readAt: null }
const context = { id: crypto.randomUUID(), signal: new AbortController().signal }
describe('Notifications v1', () => {
  it('enforces every metadata bound and rejects non-JSON, credentials and controls without invoking accessors', () => {
    expect(validateMetadata()).toEqual({})
    expect(validateMetadata({ ['x'.repeat(64)]: 'x'.repeat(1024) })).toHaveProperty('x'.repeat(64))
    let deep: unknown = {}; for (let i = 0; i < 7; i++) deep = { next: deep }
    const cycle: Record<string, unknown> = {}; cycle.self = cycle
    const getter = vi.fn(() => 'private'), accessor = Object.defineProperty({}, 'value', { get: getter, enumerable: true })
    const invalid = [deep, cycle, accessor, [], null, new Date(), { x: new Error('private') }, { x: undefined }, { x: NaN }, { x: BigInt(1) }, { x: Symbol() }, { x: () => 1 }, { x: Array(101).fill(1) }, { x: Array(3) }, { x: 'x'.repeat(1025) }, { x: '\u0000' }, { x: '\u007f' }, { x: '\ud800' }, { '': 1 }, { ['x'.repeat(65)]: 1 }, Object.fromEntries(Array.from({ length: 51 }, (_, i) => [String(i), 1])), Object.fromEntries(Array.from({ length: 10 }, (_, i) => [String(i), 'x'.repeat(1024)])), { x: Array.from({ length: 100 }, () => Array(11).fill(1)) }, Object.defineProperty({}, 'x', { value: 1 }), JSON.parse('{"__proto__":{"x":1}}')]
    for (const metadata of invalid) expect(() => validateMetadata(metadata)).toThrow(NotificationError)
    for (const key of ['password', 'PASSWD', 'pwd', 'client_secret', 'access.token', 'Authorization', 'cookie', 'api-key', 'credential', 'request', 'session', 'body', 'header', 'headers', 'r_e_q_u_e_s_t']) expect(() => validateMetadata({ nested: [{ [key]: 'private' }] })).toThrow(NotificationError)
    expect(getter).not.toHaveBeenCalled()
  })
  it('keeps Jobs payload minimal and reloads the current record each attempt', async () => {
    const load = vi.fn(async () => record), deliver = vi.fn(async () => ({ outcome: 'delivered' as const }))
    const jobs = createNotificationJobs({ load, adapters: { email: deliver } })
    expect(jobs.prepare(record.id, 'email')).toEqual({ notificationId: record.id, channel: 'email' })
    expect(notificationDeliveryPayload.safeParse({ ...jobs.prepare(record.id, 'email'), recipientId: 'private' }).success).toBe(false)
    expect(jobs.delivery.send).toEqual({ retryLimit: 5, retryDelay: 30, retryBackoff: true, retryDelayMax: 900, expireInSeconds: 60, retentionSeconds: 86400, deleteAfterSeconds: 86400 })
    for (let i = 0; i < 2; i++) expect(await jobs.delivery.handler(jobs.prepare(record.id, 'email'), context)).toEqual({ outcome: 'delivered' })
    expect(load).toHaveBeenCalledTimes(2); expect(deliver).toHaveBeenCalledWith(record, expect.any(AbortSignal))
  })
  it('returns terminal rejected outcomes for missing/disabled/permanent and throws safe transient failures', async () => {
    const payload = { notificationId: record.id, channel: 'email' as const }
    expect(await createNotificationJobs({ load: async () => undefined }).delivery.handler(payload, context)).toEqual({ outcome: 'rejected', code: 'missing' })
    expect(await createNotificationJobs({ load: async () => record }).delivery.handler(payload, context)).toEqual({ outcome: 'rejected', code: 'disabled' })
    for (const retryable of [true, false]) {
      const job = createNotificationJobs({ load: async () => record, adapters: { email: async () => { throw new NotificationError('rejected', retryable) } } }).delivery
      if (retryable) await expect(job.handler(payload, context)).rejects.toMatchObject({ code: 'rejected', retryable: true })
      else expect(await job.handler(payload, context)).toEqual({ outcome: 'rejected', code: 'rejected' })
    }
    expect(await createNotificationJobs({ load: async () => { throw new Error('postgres://secret') } }).delivery.handler(payload, context)).toEqual({ outcome: 'rejected', code: 'rejected' })
  })
  it('requires explicit ntfy server, validates bounds and never defaults to a public service', () => {
    expect(() => resolveNtfyConfig({})).toThrow(NotificationError)
    expect(resolveNtfyConfig({ NODE_ENV: 'test', NTFY_BASE_URL: 'http://localhost:8090' })).toMatchObject({ baseUrl: 'http://localhost:8090/', timeoutSeconds: 10 })
    expect(() => resolveNtfyConfig({ NTFY_BASE_URL: 'http://localhost' })).toThrow(NotificationError)
    expect(resolveNtfyConfig({ NODE_ENV: 'test', NTFY_BASE_URL: 'http://[::1]:8090' }).baseUrl).toBe('http://[::1]:8090/')
    for (const value of ['0', '31', '1.5', 'invalid']) expect(() => resolveNtfyConfig({ NODE_ENV: 'test', NTFY_BASE_URL: 'http://localhost', NTFY_TIMEOUT_SECONDS: value })).toThrow(NotificationError)
    for (const value of ['http://remote.example', 'http://127.1', 'http://2130706433', 'http://0x7f000001', 'http://0177.0.0.1', 'file:///tmp', 'https://user:private@server', 'https://server/?token=private', 'https://server/#private']) expect(() => resolveNtfyConfig({ NODE_ENV: 'test', NTFY_BASE_URL: value })).toThrow(NotificationError)
  })
  it('implements official ntfy JSON, current target lookup, manual redirects and response discard', async () => {
    const cancel = vi.fn(async () => {}), fetch = vi.fn(async () => ({ status: 200, body: { cancel }, text: () => { throw new Error('must not consume') } }) as unknown as Response)
    const topic = vi.fn(async () => 'current_topic')
    const adapter = createNtfyAdapter(topic, { env: { NODE_ENV: 'test', NTFY_BASE_URL: 'http://localhost', NTFY_TOKEN: 'tk_private' }, fetch: fetch as never })
    expect(await adapter(record, context.signal)).toEqual({ outcome: 'delivered' })
    expect(topic).toHaveBeenCalledWith(record.recipientId, expect.any(AbortSignal))
    const [, init] = fetch.mock.calls[0]! as unknown as [string, RequestInit]
    expect(init.redirect).toBe('manual'); expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({ topic: 'current_topic', title: record.title, message: record.body })
    expect(init.headers).toMatchObject({ Authorization: 'Bearer tk_private' }); expect(cancel).toHaveBeenCalledTimes(1)
  })
  it('classifies HTTP/network/timeouts without exposing response or target secrets', async () => {
    for (const status of [408, 425, 429, 500, 503, 599, 301, 302, 400, 401, 403, 404, 422]) {
      const adapter = createNtfyAdapter(async () => 'private_topic', { env: { NODE_ENV: 'test', NTFY_BASE_URL: 'http://localhost' }, fetch: (async () => new Response('private response', { status })) as typeof fetch })
      if ([408, 425, 429].includes(status) || status >= 500) await expect(adapter(record, context.signal)).rejects.toMatchObject({ code: 'unavailable', retryable: true })
      else expect(await adapter(record, context.signal)).toEqual({ outcome: 'rejected', code: 'rejected' })
    }
    const network = createNtfyAdapter(async () => 'topic', { env: { NODE_ENV: 'test', NTFY_BASE_URL: 'http://localhost' }, fetch: async () => { throw new Error('private URL/token') } })
    await expect(network(record, context.signal)).rejects.toMatchObject({ message: 'Notifications unavailable', retryable: true })
    const abort = new AbortController(); abort.abort()
    await expect(network(record, abort.signal)).rejects.toMatchObject({ code: 'timeout', retryable: false })
  })
})
