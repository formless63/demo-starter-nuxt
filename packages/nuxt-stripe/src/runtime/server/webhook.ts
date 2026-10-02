import Stripe from 'stripe'
import { createHash } from 'node:crypto'
import { StripeCapabilityError } from './errors'
import { API_VERSION } from './config'
import type { StripeConnection } from './config'
import { opaque, validate } from './validation'
export const supportedEvents = ['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'checkout.session.async_payment_failed', 'payment_intent.succeeded', 'payment_intent.payment_failed', 'payment_intent.canceled'] as const
export interface VerifiedHint { eventId: string, digest: string, eventType: string, kind: 'checkout' | 'payment' | null, remoteId: string | null }
/** Verify exact bytes with the pinned native verifier before any JSON inspection. */
export async function verifyStripeWebhook(raw: Uint8Array, signature: string, connection: StripeConnection, now = Date.now()): Promise<VerifiedHint> {
  if (raw.byteLength > 1024 * 1024 || Buffer.byteLength(signature) > 8192) throw new StripeCapabilityError('limit_exceeded')
  if (!connection.webhookSecrets.length) throw new StripeCapabilityError('unconfigured')
  const fields = signature.split(',')
  const timestamps = fields.filter(field => field.startsWith('t='))
  if (timestamps.length !== 1 || !/^t=(0|[1-9]\d*)$/.test(timestamps[0]!) || fields.some(field => !/^(t=\d+|v1=[0-9a-f]{64})$/.test(field))) throw new StripeCapabilityError('invalid_input')
  const timestamp = Number(timestamps[0]!.slice(2))
  if (!Number.isSafeInteger(timestamp) || Math.abs(Math.floor(now / 1000) - timestamp) > 300) throw new StripeCapabilityError('invalid_input')
  const verifier = new Stripe('sk_test_local', { apiVersion: API_VERSION, telemetry: false, maxNetworkRetries: 0 })
  let event: Stripe.Event | undefined
  for (const secret of connection.webhookSecrets) {
    if (!/^whsec_[A-Za-z0-9]+$/.test(secret) || Buffer.byteLength(secret) > 256) throw new StripeCapabilityError('unconfigured')
    try { event = await verifier.webhooks.constructEventAsync(Buffer.from(raw), signature, secret, 300, Stripe.createSubtleCryptoProvider(), Math.floor(now / 1000)); break } catch { /* Try previous server secret; never expose verifier causes. */ }
  }
  if (!event) throw new StripeCapabilityError('invalid_input')
  validate(opaque, event.id)
  if (event.object !== 'event' || event.livemode !== (connection.mode === 'live') || ('context' in event && event.context != null) || (event.account != null && event.account !== connection.accountId)) throw new StripeCapabilityError('invalid_input')
  const supported = (supportedEvents as readonly string[]).includes(event.type) && event.api_version === API_VERSION
  let kind: VerifiedHint['kind'] = null, remoteId: string | null = null
  if (supported) {
    kind = event.type.startsWith('checkout.') ? 'checkout' : 'payment'
    if (event.data?.object?.object !== (kind === 'checkout' ? 'checkout.session' : 'payment_intent')) throw new StripeCapabilityError('invalid_input')
    remoteId = validate(opaque, (event.data.object as { id: string }).id)
  }
  return { eventId: event.id, digest: createHash('sha256').update(raw).digest('hex'), eventType: supported ? event.type : 'unsupported', kind, remoteId }
}
