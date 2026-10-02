import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createHmac } from 'node:crypto'
import { once } from 'node:events'
import { stripeOperation, verifyStripeWebhook, StripeCapabilityError, API_VERSION, validateConnection, checkoutInput, validate, decodeCursor, encodeCursor } from '@repo/nuxt-stripe/server'
import type { StripeConnection } from '@repo/nuxt-stripe/server'
const key = 'sk_test_local', secret = 'whsec_current', previous = 'whsec_previous'
let requests = 0, behavior = 'ok'
let closed: boolean
const server = createServer(async (request, response) => {
  requests++
  assert.equal(request.headers.authorization, `Bearer ${key}`)
  assert.equal(request.headers['stripe-version'], API_VERSION)
  assert.equal(request.headers['stripe-account'], undefined)
  assert.equal(request.headers['stripe-context'], undefined)
  request.on('close', () => { closed = true })
  let body = ''
  for await (const chunk of request) body += chunk
  if (request.method === 'POST') {
    assert.equal(request.url, '/v1/checkout/sessions')
    const params = new URLSearchParams(body)
    assert.equal(params.get('mode'), 'payment')
    assert.equal(params.get('customer'), 'cus_bound')
    assert.equal(params.get('line_items[0][price]'), 'price_approved')
    assert.equal(params.get('automatic_tax[enabled]'), 'false')
    assert.equal(request.headers['idempotency-key'], 'gs-stripe:11111111-1111-4111-8111-111111111111')
  }
  if (behavior === 'headers') { setTimeout(() => response.end('{}'), 200); return }
  response.writeHead(behavior === '500' ? 500 : 200, { 'content-type': 'application/json' })
  if (behavior === 'body') { response.write('{'); setTimeout(() => response.end('}'), 300); return }
  if (behavior === 'oversize') { response.end('x'.repeat(2 * 1024 * 1024 + 1)); return }
  if (behavior === '500') { response.end('{"error":{"message":"private provider failure","type":"api_error"}}'); return }
  response.end(JSON.stringify({ id: 'cs_bound', object: 'checkout.session', status: 'open', payment_status: 'unpaid', url: 'https://checkout.stripe.com/c/pay/test', currency: 'usd', amount_total: 100 }))
})
server.listen(0, '127.0.0.1'); await once(server, 'listening')
const port = (server.address() as { port: number }).port
const connection: StripeConnection = { id: 'default', secretKey: key, accountId: 'acct_expected', mode: 'test', webhookSecrets: [secret, previous], apiBase: `http://127.0.0.1:${port}` }
const options = { environment: 'test' }
try {
  const params = { mode: 'payment' as const, customer: 'cus_bound', line_items: [{ price: 'price_approved', quantity: 1 }], success_url: 'https://app.example/success', cancel_url: 'https://app.example/cancel', automatic_tax: { enabled: false }, allow_promotion_codes: false, billing_address_collection: 'auto' as const }
  await stripeOperation(connection, client => client.checkout.sessions.create(params, { idempotencyKey: 'gs-stripe:11111111-1111-4111-8111-111111111111' }), options)
  assert.equal(requests, 1)
  behavior = '500'; const before = requests
  await assert.rejects(stripeOperation(connection, client => client.checkout.sessions.retrieve('cs_bound'), options))
  assert.equal(requests - before, 1, 'SDK performs no retry')
  behavior = 'oversize'
  await assert.rejects(stripeOperation(connection, client => client.checkout.sessions.retrieve('cs_bound'), options))
  for (const stage of ['headers', 'body']) {
    behavior = stage; closed = false
    await assert.rejects(stripeOperation(connection, client => client.checkout.sessions.retrieve('cs_bound'), { ...options, timeoutMs: 50 }), (error: unknown) => error instanceof StripeCapabilityError && error.code === 'deadline_exceeded')
    assert.equal(closed, true)
  }
  behavior = 'body'
  const controller = new AbortController(); setTimeout(() => controller.abort(), 50)
  await assert.rejects(stripeOperation(connection, client => client.checkout.sessions.retrieve('cs_bound'), { ...options, signal: controller.signal }), (error: unknown) => error instanceof StripeCapabilityError && error.code === 'cancelled')
  for (const base of ['http://localhost:1234', 'http://2130706433:1234', 'http://127.1:1234', 'https://u:p@example.com', 'https://example.com/#fragment']) assert.throws(() => validateConnection({ ...connection, apiBase: base }, 'test'))
  const timestamp = Math.floor(Date.now() / 1000)
  const event = { id: 'evt_local', object: 'event', api_version: API_VERSION, type: 'checkout.session.completed', livemode: false, data: { object: { id: 'cs_bound', object: 'checkout.session', metadata: { ownerId: 'forged' } } } }
  const raw = Buffer.from(JSON.stringify(event))
  const signature = (bytes: Uint8Array, time = timestamp, signingSecret = secret) => `t=${time},v1=${createHmac('sha256', signingSecret).update(`${time}.`).update(bytes).digest('hex')}`
  assert.equal((await verifyStripeWebhook(raw, signature(raw), connection)).remoteId, 'cs_bound')
  await verifyStripeWebhook(raw, signature(raw, timestamp, previous), connection)
  await verifyStripeWebhook(raw, `${signature(raw)},v1=${'0'.repeat(64)}`, connection)
  for (const time of [timestamp - 301, timestamp + 301]) await assert.rejects(verifyStripeWebhook(raw, signature(raw, time), connection))
  await assert.rejects(verifyStripeWebhook(Buffer.from('{}'), signature(raw), connection))
  for (const patch of [{ livemode: true }, { account: 'acct_other' }, { context: 'unexpected' }]) { const bytes = Buffer.from(JSON.stringify({ ...event, ...patch })); await assert.rejects(verifyStripeWebhook(bytes, signature(bytes), connection)) }
  const unknown = Buffer.from(JSON.stringify({ ...event, api_version: 'unknown' })); assert.equal((await verifyStripeWebhook(unknown, signature(unknown), connection)).kind, null)
  const id = '11111111-1111-4111-8111-111111111111', date = new Date('2026-10-02T00:00:00.000Z'), cursor = encodeCursor(date, id)
  assert.deepEqual(decodeCursor(cursor), { id, createdAt: date }); assert.throws(() => decodeCursor(`${cursor}=`))
  assert.throws(() => validate(checkoutInput, { customerBindingId: id, idempotencyKey: 'key', items: [{ offerId: 'registered', quantity: 1 }], customer: 'forged' }))
  console.info('Stripe official SDK local protocol/signature fixture passed; no financial certification.')
}
finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
