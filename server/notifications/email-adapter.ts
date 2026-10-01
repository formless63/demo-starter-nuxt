import { EmailError, getEmail } from '@repo/nuxt-email/server'
import { NotificationError } from '@repo/nuxt-notifications/server'
import type { NotificationAdapter } from '@repo/nuxt-notifications/server'
/** The application resolves current email at execution, never inside queued data. */
export function createNotificationEmailAdapter(resolveEmail: (recipientId: string) => Promise<string | undefined>): NotificationAdapter {
  return async (notification) => {
    const address = await resolveEmail(notification.recipientId)
    if (!address) return { outcome: 'rejected' }
    try {
      const result = await getEmail().send({ to: [{ address }], subject: notification.title, text: notification.body })
      return { outcome: result.outcome === 'accepted' ? 'delivered' : 'rejected' }
    }
    catch (error) {
      // Email's uncertainty/partial-delivery policy remains authoritative.
      if (error instanceof EmailError) throw new NotificationError('unavailable', error.retryable)
      throw new NotificationError('rejected')
    }
  }
}
