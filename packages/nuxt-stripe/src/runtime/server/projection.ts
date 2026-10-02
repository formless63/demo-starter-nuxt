import type Stripe from 'stripe'
import { StripeCapabilityError } from './errors'
import { checkoutUrl } from './config'
import { opaque, validate } from './validation'
import type { CheckoutProjection, PaymentProjection } from './schema'
function currency(value: unknown) { if (value == null) return null; if (typeof value !== 'string' || !/^[a-z]{3}$/.test(value)) throw new StripeCapabilityError('unsupported'); return value }
function amount(value: unknown) { if (value == null) return null; if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new StripeCapabilityError('unsupported'); return value }
export function checkoutProjection(session: Stripe.Checkout.Session): CheckoutProjection {
  validate(opaque, session.id)
  return { status: session.status && ['open', 'complete', 'expired'].includes(session.status) ? session.status as CheckoutProjection['status'] : 'unknown', paymentStatus: ['paid', 'unpaid', 'no_payment_required'].includes(session.payment_status) ? session.payment_status as CheckoutProjection['paymentStatus'] : 'unknown', currency: currency(session.currency), amountTotal: amount(session.amount_total), checkoutUrl: session.status === 'open' ? checkoutUrl(session.url) : null, sourceUpdatedAt: null }
}
export function paymentProjection(payment: Stripe.PaymentIntent): PaymentProjection {
  validate(opaque, payment.id)
  return { status: ['requires_payment_method', 'requires_confirmation', 'requires_action', 'processing', 'requires_capture', 'canceled', 'succeeded'].includes(payment.status) ? payment.status as PaymentProjection['status'] : 'unknown', currency: currency(payment.currency), amount: amount(payment.amount), amountReceived: amount(payment.amount_received), sourceUpdatedAt: null }
}
