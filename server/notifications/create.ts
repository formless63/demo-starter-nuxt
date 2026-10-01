import { appendNotification } from '@repo/nuxt-notifications/server'
import type { NotificationInput, NotificationChannel } from '@repo/nuxt-notifications/server'
import type { useDb } from '../utils/db'
import { publishNotificationHint } from '../realtime/application'

export async function createApplicationNotification(db: ReturnType<typeof useDb>, input: NotificationInput, channels: readonly NotificationChannel[] = []) {
  const record = await db.transaction(async (tx) => {
    const created = await appendNotification(tx, input)
    for (const channel of channels) await sendJobInTransaction(tx, 'notifications.deliver', { notificationId: created.id, channel })
    return created
  })
  // Transaction promise has resolved: durable record/Jobs are committed already.
  try { await publishNotificationHint(record.recipientId, record.id) }
  catch { /* A lost hint must not turn a committed write into an HTTP retry. */ }
  return record
}
