import { NotificationError } from '@repo/nuxt-notifications/server'
const transient = new Set(['ECONNREFUSED', 'EAI_AGAIN', 'ENOTFOUND', '08001', '08006', '40001', '40P01', '57P03'])
/** Only for database reads before external delivery; never classify adapter/send errors here. */
export async function loadNotificationState<T>(load: () => Promise<T>): Promise<T> {
  try { return await load() }
  catch (error) {
    let cause = error
    // Drizzle wraps driver errors. Inspect bounded codes, never serialize SQL/cause/provider data.
    for (let depth = 0; depth < 3 && cause && typeof cause === 'object'; depth++) {
      if ('code' in cause && typeof cause.code === 'string' && transient.has(cause.code)) throw new NotificationError('unavailable', true)
      cause = 'cause' in cause ? cause.cause : undefined
    }
    throw error
  }
}
