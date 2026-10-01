import { getLogger, getMeter } from '@repo/nuxt-observability/server'
import type { NotificationAdapter } from '@repo/nuxt-notifications/server'
export function observeNotificationAdapter(channel: 'email' | 'ntfy', adapter: NotificationAdapter): NotificationAdapter {
  return async (...args) => {
    const start = performance.now()
    let outcome = 'error'
    try { const result = await adapter(...args); outcome = result.outcome; return result }
    finally {
      const duration = (performance.now() - start) / 1000
      getMeter().createHistogram('app.notifications.delivery.duration', { unit: 's' }).record(duration, { 'app.notifications.operation': 'deliver', 'app.notifications.channel': channel, 'app.notifications.outcome': outcome })
      getLogger().info({ operation: 'deliver', channel, outcome, duration }, 'notifications.operation')
    }
  }
}
