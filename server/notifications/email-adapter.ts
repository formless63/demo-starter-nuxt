import { EmailError, getEmail } from '@repo/nuxt-email/server'
import { NotificationError, checkNotificationCancellation, resolveNotificationTarget } from '@repo/nuxt-notifications/server'
import type { NotificationAdapter } from '@repo/nuxt-notifications/server'
/** The application resolves current email at execution, never inside queued data. */
export function createNotificationEmailAdapter(resolveEmail: (recipientId: string, signal: AbortSignal) => Promise<string | undefined>): NotificationAdapter {
  return async (notification, signal) => {
    const address = await resolveNotificationTarget(signal, () => resolveEmail(notification.recipientId, signal))
    checkNotificationCancellation(signal)
    if (!address) return { outcome: 'rejected' }
    try {
      const result = await getEmail().send({ to: [{ address }], subject: notification.title, text: notification.body })
      return { outcome: result.outcome === 'accepted' ? 'delivered' : 'rejected' }
    }
    catch (error) {
      // Email's uncertainty/partial-delivery policy remains authoritative.
      if (error instanceof EmailError) {
        const retryable = error.retryable && ['temporary-rejection', 'connection'].includes(error.code)
        throw new NotificationError(error.code === 'timeout' ? 'timeout' : 'unavailable', retryable)
      }
      throw new NotificationError('rejected')
    }
  }
}
