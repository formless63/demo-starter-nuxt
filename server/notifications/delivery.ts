import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { eq } from 'drizzle-orm'
import { createNotificationJobs, createNtfyAdapter, getNotification, NotificationError } from '@repo/nuxt-notifications/server'
import { user } from '../database/schema'
import { observeNotificationAdapter } from '../utils/observed-notifications'
import { createNotificationEmailAdapter } from './email-adapter'

// Runtime-neutral lazy database access shared by Nitro and the existing Jobs worker.
let client: ReturnType<typeof postgres> | undefined
function deliveryDb() {
  const url = process.env.DATABASE_URL
  if (!url) throw new NotificationError('configuration')
  client ??= postgres(url, { max: 3, idle_timeout: 20 })
  return drizzle(client)
}
export const notificationJobs = createNotificationJobs({
  async load(id) {
    try { return await getNotification(deliveryDb(), id) }
    catch (error) {
      // Known pre-delivery connection/serialization failures cannot have sent externally.
      const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined
      if (['ECONNREFUSED', 'EAI_AGAIN', 'ENOTFOUND', '08001', '08006', '40001', '40P01', '57P03'].includes(String(code))) throw new NotificationError('unavailable', true)
      throw error
    }
  },
  adapters: {
    email: observeNotificationAdapter('email', createNotificationEmailAdapter(async (id) => {
      const [recipient] = await deliveryDb().select({ email: user.email }).from(user).where(eq(user.id, id)).limit(1)
      return recipient?.email
    })),
    // An application must supply its current recipient-to-topic policy here.
    // No public ntfy service, guessed topic or remote provisioning by default.
    ntfy: observeNotificationAdapter('ntfy', createNtfyAdapter(async () => undefined)),
  },
})
export async function closeNotificationDeliveryDatabase() { const active = client; client = undefined; await active?.end() }
