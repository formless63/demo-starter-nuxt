import { StripeCapabilityError } from './errors'
export const API_VERSION = '2026-09-30.endive' as const
export interface StripeConnection { id: string, secretKey: string, accountId: string, mode: 'test' | 'live', webhookSecrets: string[], apiBase?: string }
export function connectionFromEnvironment(env: NodeJS.ProcessEnv = process.env): StripeConnection {
  const mode = env.STRIPE_MODE ?? 'test'
  if (mode !== 'test' && mode !== 'live') throw new StripeCapabilityError('unconfigured')
  const secretKey = env.STRIPE_SECRET_KEY ?? '', accountId = env.STRIPE_ACCOUNT_ID ?? ''
  if (!new RegExp(`^(sk|rk)_${mode}_[A-Za-z0-9]+$`).test(secretKey) || !/^acct_[A-Za-z0-9]+$/.test(accountId)) throw new StripeCapabilityError('unconfigured')
  return { id: 'default', secretKey, accountId, mode, webhookSecrets: [env.STRIPE_WEBHOOK_SECRET, env.STRIPE_WEBHOOK_SECRET_PREVIOUS].filter((secret): secret is string => Boolean(secret)) }
}
export function validateConnection(connection: StripeConnection, environment = process.env.NODE_ENV) {
  if (!new RegExp(`^(sk|rk)_${connection.mode}_[A-Za-z0-9]+$`).test(connection.secretKey) || !/^acct_[A-Za-z0-9]+$/.test(connection.accountId)) throw new StripeCapabilityError('unconfigured')
  if (connection.apiBase) {
    let url: URL
    try { url = new URL(connection.apiBase) } catch { throw new StripeCapabilityError('unconfigured') }
    const loopback = /^(127(?:\.\d{1,3}){3}|\[::1\])$/.test(url.hostname)
    // Original spelling must be literal: URL canonicalization alone accepts numeric/octal aliases.
    const literal = /^http:\/\/(127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?\/?$/.test(connection.apiBase)
    if (url.username || url.password || url.hash || url.search || url.pathname !== '/' || (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback && literal && ['test', 'development'].includes(environment ?? '')))) throw new StripeCapabilityError('unconfigured')
  }
  return connection
}
export function checkoutUrl(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string' || value.length > 2048) throw new StripeCapabilityError('unsupported')
  let url: URL
  try { url = new URL(value) } catch { throw new StripeCapabilityError('unsupported') }
  if (url.protocol !== 'https:' || url.hostname !== 'checkout.stripe.com' || url.port || url.username || url.password) throw new StripeCapabilityError('unsupported')
  return value
}
