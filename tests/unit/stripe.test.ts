import { describe, expect, it } from 'vitest'
import { checkoutInput, validate, trustedContext, checkoutUrl, checkoutProjection, paymentProjection, connectionFromEnvironment, encodeCursor, decodeCursor } from '@repo/nuxt-stripe/server'
import type Stripe from 'stripe'
const id = '11111111-1111-4111-8111-111111111111'
describe('Stripe closed public contract', () => {
  it('rejects ownership, unknown properties and duplicate offer intent', () => {
    expect(() => trustedContext({ actorUserId: 'one', scope: { kind: 'user', id: 'two' } })).toThrow('Access denied.')
    for (const items of [[], [{ offerId: 'approved', quantity: 0 }], [{ offerId: 'approved', quantity: 1 }, { offerId: 'approved', quantity: 1 }]]) expect(() => validate(checkoutInput, { customerBindingId: id, idempotencyKey: 'key', items })).toThrow('Invalid input.')
    expect(() => validate(checkoutInput, { customerBindingId: id, idempotencyKey: 'key', items: [{ offerId: 'approved', quantity: 1 }], price: 'arbitrary' })).toThrow('Invalid input.')
  })
  it('keeps configuration lazy and rejects publishable/wrong mode keys', () => {
    for (const key of [undefined, 'pk_test_public', 'sk_live_private']) expect(() => connectionFromEnvironment({ STRIPE_SECRET_KEY: key, STRIPE_ACCOUNT_ID: 'acct_expected' })).toThrow('Integration is not configured.')
  })
  it('exposes only closed known enums and exact safe minor units', () => {
    const payment = { id: 'pi_local', status: 'future', amount: 1, amount_received: 0, currency: 'usd', metadata: { secret: 'private' } } as unknown as Stripe.PaymentIntent
    expect(paymentProjection(payment)).toEqual({ status: 'unknown', amount: 1, amountReceived: 0, currency: 'usd', sourceUpdatedAt: null })
    for (const amount of [Number.MAX_SAFE_INTEGER + 1, -1, 1.25]) expect(() => paymentProjection({ ...payment, amount })).toThrow('Operation unsupported.')
    const checkout = { id: 'cs_local', status: 'complete', payment_status: 'unpaid', currency: 'usd', amount_total: 100, url: 'https://checkout.stripe.com/private', metadata: { owner: 'forged' } } as unknown as Stripe.Checkout.Session
    expect(checkoutProjection(checkout)).toEqual({ status: 'complete', paymentStatus: 'unpaid', currency: 'usd', amountTotal: 100, checkoutUrl: null, sourceUpdatedAt: null })
  })
  it('requires exact provider host and canonical versioned cursor', () => {
    for (const url of ['http://checkout.stripe.com/a', 'https://checkout.stripe.com.evil/a', 'https://user:pass@checkout.stripe.com/a', 'https://checkout.stripe.com:444/a']) expect(() => checkoutUrl(url)).toThrow()
    const date = new Date('2026-10-02T00:00:00.000Z'), cursor = encodeCursor(date, id)
    expect(decodeCursor(cursor)).toEqual({ id, createdAt: date })
    for (const invalid of [cursor + '=', Buffer.from('[1,"2026-10-02T00:00:00Z","' + id + '"]').toString('base64url'), 'x'.repeat(2049)]) expect(() => decodeCursor(invalid)).toThrow('Invalid input.')
  })
})
