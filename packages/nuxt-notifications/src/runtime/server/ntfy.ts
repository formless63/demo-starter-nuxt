import type { NotificationAdapter } from './delivery'
import { NotificationError } from './errors'
import { checkNotificationCancellation, resolveNotificationTarget } from './cancellation'
export function resolveNtfyConfig(env: Record<string, string | undefined> = process.env) {
  try {
    if (!env.NTFY_BASE_URL) throw new NotificationError('configuration')
    const baseUrl = new URL(env.NTFY_BASE_URL)
    if (!['http:', 'https:'].includes(baseUrl.protocol) || baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash) throw new NotificationError('configuration')
    // Check the original authority: URL normalization must not admit alternate IP spellings.
    const authority = /^http:\/\/([^/?#]+)/.exec(env.NTFY_BASE_URL)?.[1]
    if (baseUrl.protocol === 'http:' && (!['development', 'test'].includes(env.NODE_ENV ?? '') || !authority || !/^(?:localhost|127\.0\.0\.1|\[::1\])(?::[0-9]+)?$/.test(authority))) throw new NotificationError('configuration')
    const timeoutSeconds = Number(env.NTFY_TIMEOUT_SECONDS ?? 10)
    if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 1 || timeoutSeconds > 30) throw new NotificationError('configuration')
    const token = env.NTFY_TOKEN || undefined
    if (token !== undefined && (!token || token.length > 4096 || /[^\x21-\x7e]/.test(token))) throw new NotificationError('configuration')
    return { baseUrl: baseUrl.href.replace(/\/*$/, '/'), token, timeoutSeconds }
  }
  catch { throw new NotificationError('configuration') }
}
/** Official JSON POST to the configured server root; topic resolves at execution. */
export function createNtfyAdapter(resolveTopic: (recipientId: string, signal: AbortSignal) => Promise<string | undefined>, options: { env?: Record<string, string | undefined>, fetch?: typeof globalThis.fetch } = {}): NotificationAdapter {
  return async (notification, workerSignal) => {
    checkNotificationCancellation(workerSignal)
    const config = resolveNtfyConfig(options.env)
    const deadline = AbortSignal.timeout(config.timeoutSeconds * 1000)
    const signal = AbortSignal.any([workerSignal, deadline])
    try {
      // Race the target lookup too; never retain a stuck attempt indefinitely.
      const topic = await resolveNotificationTarget(signal, () => resolveTopic(notification.recipientId, signal))
      checkNotificationCancellation(signal)
      if (!topic || !/^[A-Za-z0-9_-]{1,64}$/.test(topic)) throw new NotificationError('rejected')
      const response = await (options.fetch ?? globalThis.fetch)(config.baseUrl, {
        method: 'POST', redirect: 'manual', signal,
        headers: { 'Content-Type': 'application/json', ...(config.token ? { Authorization: `Bearer ${config.token}` } : {}) },
        body: JSON.stringify({ topic, title: notification.title, message: notification.body }),
      })
      // Do not inspect, consume or log the provider's response body.
      void response.body?.cancel().catch(() => {})
      if (response.status >= 200 && response.status < 300) return { outcome: 'delivered' }
      if ([408, 425, 429].includes(response.status) || response.status >= 500) throw new NotificationError('unavailable', true)
      return { outcome: 'rejected', code: 'rejected' }
    }
    catch (error) {
      if (error instanceof NotificationError) throw error
      throw new NotificationError(signal.aborted ? 'timeout' : 'unavailable', true)
    }
  }
}
