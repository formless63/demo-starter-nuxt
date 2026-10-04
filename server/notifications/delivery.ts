import pg from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { eq } from 'drizzle-orm'
import { createNotificationJobs, createNtfyAdapter, getNotification, NotificationError } from '@repo/nuxt-notifications/server'
import { user } from '../database/schema'
import { observeNotificationAdapter } from '../utils/observed-notifications'
import { createNotificationEmailAdapter } from './email-adapter'
import { loadNotificationState } from './loading'

// Runtime-neutral lazy database access shared by Nitro and the existing Jobs worker.
let client: pg.Pool | undefined
function deliveryDb() {
  const url = process.env.DATABASE_URL
  if (!url) throw new NotificationError('configuration')
  client ??= new pg.Pool({ connectionString: url, max: 3, idleTimeoutMillis: 20_000, connectionTimeoutMillis: 30_000 }).on('error', () => { /* idle-client errors surface on the next query */ })
  return drizzle(client)
}
export const notificationJobs = createNotificationJobs({
  load: id => loadNotificationState(() => getNotification(deliveryDb(), id)),
  adapters: {
    email: observeNotificationAdapter('email', createNotificationEmailAdapter(id => loadNotificationState(async () => {
      const [recipient] = await deliveryDb().select({ email: user.email }).from(user).where(eq(user.id, id)).limit(1)
      return recipient?.email
    }))),
    // An application must supply its current recipient-to-topic policy here.
    // No public ntfy service, guessed topic or remote provisioning by default.
    ntfy: observeNotificationAdapter('ntfy', createNtfyAdapter(async () => undefined)),
  },
})
export async function closeNotificationDeliveryDatabase() { const active = client; client = undefined; await active?.end() }
