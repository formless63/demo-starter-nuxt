import { getLogger, getMeter } from '@repo/nuxt-observability/server'
import { getRealtime, resolveRealtimeConfig } from '@repo/nuxt-realtime/server'
export async function observeRealtimePublish(action: () => Promise<void>) {
  const transport = resolveRealtimeConfig().normalized
  const start = performance.now()
  let outcome = 'success'
  try { await action() }
  catch (error) { outcome = 'error'; throw error }
  finally {
    const duration = (performance.now() - start) / 1000
    const attributes = { 'app.realtime.operation': 'publish', 'app.realtime.type': 'notifications.created', 'app.realtime.transport': transport, 'app.realtime.outcome': outcome }
    getMeter().createHistogram('app.realtime.duration', { unit: 's' }).record(duration, attributes)
    getMeter().createHistogram('app.realtime.active').record(getRealtime().activeCount, { 'app.realtime.transport': transport })
    getLogger().info({ operation: 'publish', type: 'notifications.created', transport, outcome, duration, active: getRealtime().activeCount }, 'realtime.operation')
  }
}
