import { defineJob } from '@repo/nuxt-jobs/server'
import { z } from 'zod'
import type { NotificationRecord } from './schema'
import { NotificationError } from './errors'
import { checkNotificationCancellation, resolveNotificationTarget } from './cancellation'

const terminalCodes = new Set(['missing', 'disabled', 'rejected', 'unavailable', 'configuration', 'invalid-input', 'timeout'])
export type NotificationChannel = 'email' | 'ntfy'
export interface NotificationDeliveryResult { outcome: 'delivered' | 'rejected', code?: 'missing' | 'disabled' | 'rejected' | 'unavailable' | 'configuration' | 'invalid-input' | 'timeout' }
export type NotificationAdapter = (notification: NotificationRecord, signal: AbortSignal) => Promise<NotificationDeliveryResult>
export const notificationDeliveryPayload = z.object({ notificationId: z.uuid(), channel: z.enum(['email', 'ntfy']) }).strict()
export interface NotificationDeliveryOptions {
  load: (notificationId: string, signal: AbortSignal) => Promise<NotificationRecord | undefined>
  adapters?: Partial<Record<NotificationChannel, NotificationAdapter>>
}
/** Application composes this definition into its existing shared worker registry. */
export function createNotificationJobs(options: NotificationDeliveryOptions) {
  const delivery = defineJob({
    name: 'notifications.deliver',
    payload: notificationDeliveryPayload,
    send: { retryLimit: 5, retryDelay: 30, retryBackoff: true, retryDelayMax: 900, expireInSeconds: 60, retentionSeconds: 86_400, deleteAfterSeconds: 86_400 },
    async handler(payload, context): Promise<NotificationDeliveryResult> {
      // Settle before pg-boss's 60s expiration; SMTP cannot be undone after invocation.
      const signal = AbortSignal.any([context.signal, AbortSignal.timeout(50_000)])
      try {
        const record = await resolveNotificationTarget(signal, () => options.load(payload.notificationId, signal))
        checkNotificationCancellation(signal)
        if (!record) return { outcome: 'rejected', code: 'missing' }
        const adapter = options.adapters?.[payload.channel]
        if (!adapter) return { outcome: 'rejected', code: 'disabled' }
        const result = await resolveNotificationTarget(signal, () => adapter(record, signal))
        // Persist only finite outcomes, even when an application adapter returns extras.
        if (result.outcome === 'delivered') return { outcome: 'delivered' }
        return { outcome: 'rejected', code: 'rejected' }
      }
      catch (error) {
        const safe = error instanceof NotificationError ? error : new NotificationError('rejected')
        if (safe.retryable) throw safe
        return { outcome: 'rejected', code: terminalCodes.has(safe.code) ? safe.code : 'rejected' }
      }
    },
  })
  return { delivery, prepare: (notificationId: string, channel: NotificationChannel) => notificationDeliveryPayload.parse({ notificationId, channel }) }
}
