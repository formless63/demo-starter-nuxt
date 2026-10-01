// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EmailError } from '@repo/nuxt-email/server'
import { loadNotificationState } from '../../server/notifications/loading'
import { createNotificationEmailAdapter } from '../../server/notifications/email-adapter'
import { createApplicationNotification } from '../../server/notifications/create'
import type { NotificationRecord } from '@repo/nuxt-notifications/server'
const send = vi.hoisted(() => vi.fn())
vi.mock('@repo/nuxt-email/server', async (original) => ({ ...await original<typeof import('@repo/nuxt-email/server')>(), getEmail: () => ({ send }) }))
const append = vi.hoisted(() => vi.fn())
vi.mock('@repo/nuxt-notifications/server', async original => ({ ...await original<typeof import('@repo/nuxt-notifications/server')>(), appendNotification: append }))
const hint = vi.hoisted(() => vi.fn())
vi.mock('../../server/realtime/application', () => ({ publishNotificationHint: hint }))
const record: NotificationRecord = { id: crypto.randomUUID(), recipientId: 'stable-id', type: 'test.created', title: 'Private title', body: 'Plain body', metadata: {}, createdAt: new Date(), readAt: null }
beforeEach(() => { send.mockReset(); append.mockReset(); hint.mockReset(); vi.stubGlobal('useJobsBoss', vi.fn(async () => {})); vi.stubGlobal('sendJobInTransaction', vi.fn(async () => {})) })
afterEach(() => vi.unstubAllGlobals())
describe('Application-owned Notification integrations', () => {
  it('recognizes bounded known database failures only before invocation', async () => {
    for (const code of ['ECONNREFUSED', '40001', '57P03']) {
      await expect(loadNotificationState(async () => { throw new Error('private SQL', { cause: { code } }) })).rejects.toMatchObject({ code: 'unavailable', retryable: true })
    }
    const unknown = new Error('unknown private database error')
    await expect(loadNotificationState(async () => { throw unknown })).rejects.toBe(unknown)
  })
  it('resolves current email and uses the existing Email capability once', async () => {
    const resolve = vi.fn(async () => 'current@example.test')
    send.mockResolvedValue({ outcome: 'accepted' })
    const adapter = createNotificationEmailAdapter(resolve)
    expect(await adapter(record, new AbortController().signal)).toEqual({ outcome: 'delivered' })
    expect(resolve).toHaveBeenCalledWith('stable-id', expect.any(AbortSignal))
    expect(send).toHaveBeenCalledExactlyOnceWith({ to: [{ address: 'current@example.test' }], subject: record.title, text: record.body })
  })
  it('honors Email ambiguous/permanent/partial delivery semantics', async () => {
    const adapter = createNotificationEmailAdapter(async () => 'current@example.test')
    for (const outcome of ['partial', 'rejected']) {
      send.mockResolvedValueOnce({ outcome })
      expect(await adapter(record, new AbortController().signal)).toEqual({ outcome: 'rejected' })
    }
    send.mockRejectedValueOnce(new EmailError('timeout'))
    await expect(adapter(record, new AbortController().signal)).rejects.toMatchObject({ retryable: false })
    send.mockRejectedValueOnce(new EmailError('temporary-rejection', true))
    await expect(adapter(record, new AbortController().signal)).rejects.toMatchObject({ retryable: true })
    expect(send).toHaveBeenCalledTimes(4)
  })
  it('publishes only after commit and preserves committed data when hint fails', async () => {
    append.mockResolvedValue(record)
    let committed = false
    const tx = {}
    const db = { transaction: async (action: (tx: unknown) => Promise<unknown>) => { const result = await action(tx); expect(hint).not.toHaveBeenCalled(); committed = true; return result } }
    hint.mockImplementation(async () => { expect(committed).toBe(true); throw new Error('lost hint') })
    expect(await createApplicationNotification(db as never, record, ['email'])).toBe(record)
    expect(append).toHaveBeenCalledWith(tx, record)
    expect(sendJobInTransaction).toHaveBeenCalledExactlyOnceWith(tx, 'notifications.deliver', { notificationId: record.id, channel: 'email' })
    expect(hint).toHaveBeenCalledExactlyOnceWith(record.recipientId, record.id)
  })
  it('never publishes on rollback', async () => {
    append.mockResolvedValue(record)
    const db = { transaction: async (action: (tx: unknown) => Promise<unknown>) => { await action({}); throw new Error('rollback') } }
    await expect(createApplicationNotification(db as never, record)).rejects.toThrow('rollback')
    expect(hint).not.toHaveBeenCalled()
  })
})

describe('Composed notification Jobs handler', () => {
  const context = (signal: AbortSignal) => ({ id: crypto.randomUUID(), signal })
  const payload = { notificationId: record.id, channel: 'email' as const }
  async function compose(load: () => Promise<NotificationRecord | undefined>, resolve: (id: string, signal: AbortSignal) => Promise<string | undefined>) {
    const { createNotificationJobs } = await import('@repo/nuxt-notifications/server')
    return createNotificationJobs({ load, adapters: { email: createNotificationEmailAdapter(resolve) } }).delivery
  }
  it('does no lookup/send on preabort and cancels deferred record resolution', async () => {
    const aborted = new AbortController(); aborted.abort()
    const load = vi.fn(async () => record), resolve = vi.fn(async () => 'current@example.test')
    const job = await compose(load, resolve)
    expect(await job.handler(payload, context(aborted.signal))).toEqual({ outcome: 'rejected', code: 'timeout' })
    expect(load).not.toHaveBeenCalled(); expect(resolve).not.toHaveBeenCalled(); expect(send).not.toHaveBeenCalled()
    const controller = new AbortController()
    let release!: (value: NotificationRecord | undefined) => void
    const deferred = new Promise<NotificationRecord | undefined>(accept => { release = accept })
    const waiting = (await compose(() => deferred, resolve)).handler(payload, context(controller.signal))
    await Promise.resolve(); controller.abort()
    expect(await waiting).toEqual({ outcome: 'rejected', code: 'timeout' })
    release(undefined); await Promise.resolve()
    expect(resolve).not.toHaveBeenCalled(); expect(send).not.toHaveBeenCalled()
  })
  it('handles late recipient rejection without SMTP', async () => {
    let fail!: (reason: Error) => void
    const deferred = new Promise<string | undefined>((_, reject) => { fail = reject })
    const resolve = vi.fn(() => deferred), controller = new AbortController()
    const pending = (await compose(async () => record, resolve)).handler(payload, context(controller.signal))
    await vi.waitFor(() => expect(resolve).toHaveBeenCalledOnce())
    controller.abort(); expect(await pending).toEqual({ outcome: 'rejected', code: 'timeout' })
    fail(new Error('private late recipient')); await Promise.resolve(); await Promise.resolve()
    expect(send).not.toHaveBeenCalled()
  })
  it('settles wrapper timeout terminally while in-flight SMTP finishes once', async () => {
    vi.useFakeTimers()
    const deadline = vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => {
      const controller = new AbortController(); setTimeout(() => controller.abort(), ms); return controller.signal
    })
    try {
      let finish!: (value: unknown) => void
      send.mockImplementation(() => new Promise(accept => { finish = accept }))
      const job = await compose(async () => record, async () => 'current@example.test')
      const result = job.handler(payload, context(new AbortController().signal))
      await vi.advanceTimersByTimeAsync(0); expect(send).toHaveBeenCalledOnce()
      await vi.advanceTimersByTimeAsync(50_000)
      expect(await result).toEqual({ outcome: 'rejected', code: 'timeout' })
      finish({ outcome: 'accepted' }); await vi.advanceTimersByTimeAsync(0)
      expect(send).toHaveBeenCalledOnce()
    }
    finally { deadline.mockRestore(); vi.useRealTimers() }
  })
  it('retries only explicit safe typed SMTP transients and makes unknown errors terminal', async () => {
    const job = await compose(async () => record, async () => 'current@example.test')
    send.mockRejectedValueOnce(new Error('private provider failure'))
    expect(await job.handler(payload, context(new AbortController().signal))).toEqual({ outcome: 'rejected', code: 'rejected' })
    send.mockRejectedValueOnce(new EmailError('temporary-rejection', true))
    await expect(job.handler(payload, context(new AbortController().signal))).rejects.toMatchObject({ code: 'unavailable', retryable: true })
    for (const error of [new EmailError('timeout', true), new EmailError('unknown', true), new EmailError('permanent-rejection', true)]) {
      send.mockRejectedValueOnce(error)
      expect((await job.handler(payload, context(new AbortController().signal))).outcome).toBe('rejected')
    }
  })
  it('filters private adapter extras and runtime-invalid error codes from Jobs output', async () => {
    const { createNotificationJobs, NotificationError } = await import('@repo/nuxt-notifications/server')
    const job = createNotificationJobs({ load: async () => record, adapters: { email: async () => ({ outcome: 'delivered', recipient: 'private', body: 'private', topic: 'private' }) } }).delivery
    expect(await job.handler(payload, context(new AbortController().signal))).toEqual({ outcome: 'delivered' })
    const rejected = createNotificationJobs({ load: async () => record, adapters: { email: async () => { throw new NotificationError('rejected', true) } } }).delivery
    expect(await rejected.handler(payload, context(new AbortController().signal))).toEqual({ outcome: 'rejected', code: 'rejected' })
    const broken = createNotificationJobs({ load: async () => record, adapters: { email: async () => { throw new NotificationError('private-extra' as never) } } }).delivery
    expect(await broken.handler(payload, context(new AbortController().signal))).toEqual({ outcome: 'rejected', code: 'rejected' })
  })
})
