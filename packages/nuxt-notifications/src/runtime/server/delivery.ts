import { defineJob } from '@repo/nuxt-jobs/server'
import { z } from 'zod'
import type { NotificationRecord } from './schema'
import { NotificationError } from './errors'
export type NotificationChannel = 'email' | 'ntfy'
export interface NotificationDeliveryResult { outcome: 'delivered' | 'rejected', code?: 'missing' | 'disabled' | 'rejected' | 'unavailable' | 'configuration' | 'invalid-input' | 'timeout' }
export type NotificationAdapter = (notification: NotificationRecord, signal: AbortSignal) => Promise<NotificationDeliveryResult>
export const notificationDeliveryPayload = z.object({ notificationId: z.uuid(), channel: z.enum(['email', 'ntfy']) }).strict()
export interface NotificationDeliveryOptions {
  load: (notificationId: string) => Promise<NotificationRecord | undefined>
  adapters?: Partial<Record<NotificationChannel, NotificationAdapter>>
}
/** Application composes this definition into its existing shared worker registry. */
export function createNotificationJobs(options: NotificationDeliveryOptions) {
  const delivery = defineJob({
    name: 'notifications.deliver',
    payload: notificationDeliveryPayload,
    send: { retryLimit: 5, retryDelay: 30, retryBackoff: true, retryDelayMax: 900, expireInSeconds: 60, retentionSeconds: 86_400, deleteAfterSeconds: 86_400 },
    async handler(payload, context): Promise<NotificationDeliveryResult> {
      try {
        const record = await options.load(payload.notificationId)
        if (!record) return { outcome: 'rejected', code: 'missing' }
        const adapter = options.adapters?.[payload.channel]
        if (!adapter) return { outcome: 'rejected', code: 'disabled' }
        const result = await adapter(record, context.signal)
        // Persist only finite outcomes, even when an application adapter returns extras.
        if (result.outcome === 'delivered') return { outcome: 'delivered' }
        return { outcome: 'rejected', code: 'rejected' }
      }
      catch (error) {
        const safe = error instanceof NotificationError ? error : new NotificationError('unavailable', true)
        if (safe.retryable) throw safe
        return { outcome: 'rejected', code: safe.code }
      }
    },
  })
  return { delivery, prepare: (notificationId: string, channel: NotificationChannel) => notificationDeliveryPayload.parse({ notificationId, channel }) }
}
