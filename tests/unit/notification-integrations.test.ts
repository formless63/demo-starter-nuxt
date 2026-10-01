// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EmailError } from '@repo/nuxt-email/server'
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
  it('resolves current email and uses the existing Email capability once', async () => {
    const resolve = vi.fn(async () => 'current@example.test')
    send.mockResolvedValue({ outcome: 'accepted' })
    const adapter = createNotificationEmailAdapter(resolve)
    expect(await adapter(record, new AbortController().signal)).toEqual({ outcome: 'delivered' })
    expect(resolve).toHaveBeenCalledWith('stable-id')
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
