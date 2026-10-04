import assert from 'node:assert/strict'
import { randomUUID, createHmac } from 'node:crypto'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { spawn } from 'node:child_process'
import { setTimeout as wait } from 'node:timers/promises'
import { writeFile } from 'node:fs/promises'
import pg from 'pg'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { drizzle } from 'drizzle-orm/node-postgres'
import { eq } from 'drizzle-orm'
import { createJobsBoss, defineQueues } from '@repo/nuxt-jobs/server'
import { createStripeService, API_VERSION } from '@repo/nuxt-stripe/server'
import { stripeBinding, stripeOperationLedger, stripeInbox } from '@repo/nuxt-stripe/schema'
import type { StripeConnection, TrustedContext } from '@repo/nuxt-stripe/server'
const adminUrl = process.env.DATABASE_URL
assert.ok(adminUrl, 'Disposable local PostgreSQL is required')
const admin = new pg.Pool({ connectionString: adminUrl, max: 1 }), name = `stripe_fixture_${randomUUID().replaceAll('-', '')}`
admin.on('error', () => {})
await admin.query(`create database "${name}"`)
const url = new URL(adminUrl); url.pathname = `/${name}`
const sql = new pg.Pool({ connectionString: url.toString(), max: 4 }), db = drizzle(sql)
sql.on('error', () => {})
const config = { databaseUrl: url.toString(), schema: 'pgboss', concurrency: 1, useListenNotify: false }
const migration = createJobsBoss(config, 'migration'); migration.on('error', () => {})
await migration.start(); await migration.stop()
const boss = createJobsBoss(config, 'producer'); boss.on('error', () => {}); await boss.start()
let checkoutId = 'cs_owned', paymentId = 'pi_owned', customerId = 'cus_owned'
let authorized = true, transport = 'ok', posts = 0, gets = 0, providerStatus = 'unpaid', providerPaymentStatus = 'processing'
let holdNext = false, holdPost = false, holdPayment = false, held: (() => void) | undefined
const seenKeys: string[] = [], seenBodies: string[] = []
const remote = createServer(async (request, response) => {
  let body = ''; for await (const chunk of request) body += chunk
  assert.equal(request.headers.authorization, 'Bearer sk_test_fixture')
  if (request.method === 'POST') { posts++; seenKeys.push(String(request.headers['idempotency-key'])); seenBodies.push(body) }
  else gets++
  if (transport === 'reject400' && request.method === 'POST') { response.writeHead(400); response.end('{"error":{"message":"private rejection","type":"invalid_request_error"}}'); return }
  if (transport === 'disconnect' && request.method === 'POST') { request.socket.destroy(); return }
  if (transport === 'cached500' && request.method === 'POST') { response.writeHead(500); response.end('{"error":{"message":"private customer body","type":"api_error"}}'); return }
  response.setHeader('content-type', 'application/json')
  const snapshot = JSON.stringify(request.url?.startsWith('/v1/payment_intents/') ? { id: paymentId, object: 'payment_intent', livemode: false, status: providerPaymentStatus, amount: transport === 'badPayment' ? -1 : 100, amount_received: providerStatus === 'paid' ? 100 : 0, currency: 'usd', metadata: { ownerId: 'forged' } } : { id: checkoutId, object: 'checkout.session', livemode: false, status: 'complete', payment_status: providerStatus, currency: 'usd', amount_total: 100, payment_intent: paymentId, url: null, customer: customerId, metadata: { ownerId: 'forged' } })
  if ((holdNext && request.method === 'GET') || (holdPost && request.method === 'POST') || (holdPayment && request.url?.startsWith('/v1/payment_intents/'))) { holdNext = false; holdPost = false; holdPayment = false; await new Promise<void>(resolve => { held = resolve }) }
  response.end(snapshot)
})
remote.listen(0, '127.0.0.1'); await once(remote, 'listening')
const configured: StripeConnection = { id: 'default', secretKey: 'sk_test_fixture', accountId: 'acct_expected', mode: 'test', webhookSecrets: ['whsec_fixture'], apiBase: `http://127.0.0.1:${(remote.address() as { port: number }).port}` }
const context: TrustedContext = { actorUserId: 'owner-one', scope: { kind: 'user', id: 'owner-one' } }, foreign: TrustedContext = { actorUserId: 'owner-two', scope: { kind: 'user', id: 'owner-two' } }
const service = createStripeService({ database: () => db, boss: async () => boss, env: { DATABASE_URL: url.toString(), NODE_ENV: 'test' }, resolveConnection: async () => configured, authorizeScope: async () => authorized, authorizeBoundResource: async (ctx, binding) => binding.scopeId === ctx.actorUserId && authorized, authorizeReconciliation: async () => authorized, resolveOffer: async () => ({ priceId: 'price_registered', currency: 'usd' }), approvedRedirects: async () => ({ successUrl: 'https://app.example/success', cancelUrl: 'https://app.example/cancel' }) })
await defineQueues(boss, { [service.runJob.name]: service.runJob, [service.inboxJob.name]: service.inboxJob })
const job = () => ({ id: randomUUID(), signal: new AbortController().signal, retryCount: 0, retryLimit: 5 })
try {
  await migrate(db, { migrationsFolder: '.fixture/migrations' })
  await migrate(db, { migrationsFolder: '.fixture/migrations' })
  assert.equal(((await sql.query(`select count(*)::int n from drizzle.__drizzle_migrations`)).rows)[0]!.n, 2)
  const binding = await db.transaction(tx => service.bindInTransaction(tx, context, { localResourceId: 'local-customer', connectionId: 'default', resourceKind: 'customer', remoteId: 'cus_owned' }))
  const otherBinding = await db.transaction(tx => service.bindInTransaction(tx, foreign, { localResourceId: 'other-customer', connectionId: 'default', resourceKind: 'customer', remoteId: 'cus_other' }))
  const input = { customerBindingId: binding.id, idempotencyKey: 'one', items: [{ offerId: 'approved', quantity: 1 }] }
  await assert.rejects(service.requestCheckout(foreign, input))
  await assert.rejects(service.requestCheckout(context, { ...input, customerBindingId: randomUUID() }))
  await assert.rejects(db.transaction(async tx => { await service.requestCheckoutInTransaction(tx, context, input); throw new Error('rollback') }))
  assert.equal((await db.select().from(stripeOperationLedger)).length, 0)
  const jobsAfterRollback = (await sql.query(`select count(*)::int n from pgboss.job where name='stripe.operation'`)).rows; assert.equal(jobsAfterRollback[0]!.n, 0)
  const created = await service.requestCheckout(context, input)
  const operationId = 'operationId' in created ? created.operationId : created.id
  assert.equal((await service.requestCheckout(context, input) as { id: string }).id, operationId)
  await assert.rejects(service.requestCheckout(context, { ...input, items: [{ offerId: 'approved', quantity: 2 }] }))
  const outcome = await service.runJob.handler({ operationId }, job())
  assert.deepEqual(outcome, { status: 'processed' })
  assert.equal(posts, 1)
  const operation = await service.getOperation(context, { operationId }); assert.equal(operation.status, 'succeeded')
  const checkout = await service.getCheckout(context, { bindingId: operation.bindingId! }); assert.equal(checkout.status, 'complete'); assert.equal(checkout.paymentStatus, 'unpaid')
  await assert.rejects(service.getCheckout(foreign, { bindingId: operation.bindingId! }))
  assert.equal((await service.listPayments(context)).items[0]!.status, 'processing')
  assert.equal((await service.listPayments(foreign)).items.length, 0)
  // Checkout-derived payment retrieval and independent payment reconciliation
  // must share a lease before HTTP, not merely lock during the final write.
  const paymentBindingId = (await service.listPayments(context)).items[0]!.bindingId
  const checkoutRefresh = await service.requestPaymentReconciliation(context, { kind: 'checkout', bindingId: operation.bindingId })
  const checkoutRefreshId = 'operationId' in checkoutRefresh ? checkoutRefresh.operationId : checkoutRefresh.id
  holdPayment = true; held = undefined
  const checkoutInFlight = service.runJob.handler({ operationId: checkoutRefreshId }, job())
  for (let count = 0; !held && count < 500; count++) await wait(10)
  assert.ok(held, 'Checkout payment GET is paused after acquiring its child lease')
  const paymentRefresh = await service.requestPaymentReconciliation(context, { kind: 'payment', bindingId: paymentBindingId })
  const paymentRefreshId = 'operationId' in paymentRefresh ? paymentRefresh.operationId : paymentRefresh.id
  providerPaymentStatus = 'succeeded'; providerStatus = 'paid'
  const beforeContendedGet = gets
  try {
    await assert.rejects(service.runJob.handler({ operationId: paymentRefreshId }, job()), { code: 'unavailable' })
    assert.equal(gets, beforeContendedGet, 'Competing payment worker cannot retrieve or commit around the child lease')
  }
  finally { held!(); await checkoutInFlight }
  assert.equal((await service.getOperation(context, { operationId: checkoutRefreshId })).status, 'succeeded')
  assert.deepEqual(await service.runJob.handler({ operationId: paymentRefreshId }, job()), { status: 'processed' })
  assert.equal((await service.listPayments(context)).items[0]!.status, 'succeeded')
  providerPaymentStatus = 'processing'; providerStatus = 'unpaid'
  const sign = (id: string, remoteId = 'cs_owned', type = 'checkout.session.completed') => {
    const timestamp = Math.floor(Date.now() / 1000), bytes = Buffer.from(JSON.stringify({ id, object: 'event', api_version: API_VERSION, type, livemode: false, data: { object: { id: remoteId, object: type.startsWith('checkout.') ? 'checkout.session' : 'payment_intent', metadata: { ownerId: 'owner-two' } } } }))
    return { bytes, signature: `t=${timestamp},v1=${createHmac('sha256', 'whsec_fixture').update(`${timestamp}.`).update(bytes).digest('hex')}` }
  }
  const first = sign('evt_first')
  await assert.rejects(db.transaction(async tx => { const { verifyStripeWebhook } = await import('@repo/nuxt-stripe/server'); await service.receiveInTransaction(tx, configured, await verifyStripeWebhook(first.bytes, first.signature, configured)); throw new Error('rollback') }))
  assert.equal((await db.select().from(stripeInbox)).length, 0)
  await service.receive('default', first.bytes, first.signature); await service.receive('default', first.bytes, first.signature)
  const rows = await db.select().from(stripeInbox); assert.equal(rows.length, 1)
  assert.equal(((await sql.query(`select count(*)::int n from pgboss.job where name='stripe.receipt'`)).rows)[0]!.n, 1)
  providerStatus = 'paid'; providerPaymentStatus = 'succeeded'; await service.inboxJob.handler({ inboxId: rows[0]!.id }, job())
  assert.equal((await service.listPayments(context)).items[0]!.status, 'succeeded')
  const originalReceipt = (await db.select().from(stripeInbox).where(eq(stripeInbox.id, rows[0]!.id)))[0]!
  const collision = sign('evt_first', 'cs_unbound')
  await service.receive('default', collision.bytes, collision.signature); await service.receive('default', collision.bytes, collision.signature)
  const collided = (await db.select().from(stripeInbox).where(eq(stripeInbox.id, rows[0]!.id)))[0]!
  assert.equal(collided.bodySha256, originalReceipt.bodySha256)
  assert.equal(collided.bindingId, originalReceipt.bindingId)
  assert.equal(collided.remoteHint, 'cs_owned', 'A signed collision cannot replace original ownership with its new hint')
  assert.equal(collided.status, 'received')
  assert.equal(((await sql.query(`select count(*)::int n from pgboss.job where name='stripe.receipt'`)).rows)[0]!.n, 2, 'Repeated conflicting bytes coalesce into one new reconciliation')
  holdNext = true; held = undefined
  const collisionWork = service.inboxJob.handler({ inboxId: collided.id }, job())
  for (let count = 0; !held && count < 500; count++) await wait(10)
  assert.ok(held)
  const during = sign('evt_first', 'cs_another_unbound')
  await service.receive('default', during.bytes, during.signature); await service.receive('default', during.bytes, during.signature)
  assert.equal(((await sql.query(`select count(*)::int n from pgboss.job where name='stripe.receipt'`)).rows)[0]!.n, 2, 'An active receipt records one follow-up rather than dispatching parallel jobs')
  held!(); await collisionWork
  assert.equal((await db.select().from(stripeInbox).where(eq(stripeInbox.id, collided.id)))[0]!.status, 'received')
  assert.equal(((await sql.query(`select count(*)::int n from pgboss.job where name='stripe.receipt'`)).rows)[0]!.n, 3)
  assert.deepEqual(await service.inboxJob.handler({ inboxId: collided.id }, job()), { status: 'processed' })
  assert.equal((await db.select().from(stripeInbox).where(eq(stripeInbox.id, collided.id)))[0]!.reconcileAgain, false)
  const old = sign('evt_out_of_order'); await service.receive('default', old.bytes, old.signature)
  const [oldRow] = await db.select().from(stripeInbox).where(eq(stripeInbox.eventId, 'evt_out_of_order')); await service.inboxJob.handler({ inboxId: oldRow!.id }, job())
  assert.equal((await service.listPayments(context)).items[0]!.status, 'succeeded', 'older event hint retrieves current authoritative state')
  const unbound = sign('evt_unbound', 'cs_unbound'); await service.receive('default', unbound.bytes, unbound.signature)
  assert.equal((await db.select().from(stripeInbox).where(eq(stripeInbox.eventId, 'evt_unbound')))[0]!.status, 'ignored')
  for (const [type, state, remoteId] of [
    ['checkout.session.async_payment_failed', 'requires_payment_method', 'cs_owned'],
    ['checkout.session.async_payment_succeeded', 'succeeded', 'cs_owned'],
    ['payment_intent.payment_failed', 'requires_payment_method', 'pi_owned'],
    ['payment_intent.canceled', 'canceled', 'pi_owned'],
    ['payment_intent.succeeded', 'succeeded', 'pi_owned'],
  ]) {
    providerPaymentStatus = state!; providerStatus = state === 'succeeded' ? 'paid' : 'unpaid'
    const event = sign(`evt_${type!.replaceAll('.', '_')}`, remoteId!, type!)
    await service.receive('default', event.bytes, event.signature)
    const [receipt] = await db.select().from(stripeInbox).where(eq(stripeInbox.eventId, `evt_${type!.replaceAll('.', '_')}`))
    assert.deepEqual(await service.inboxJob.handler({ inboxId: receipt!.id }, job()), { status: 'processed' })
    assert.equal((await service.listPayments(context)).items[0]!.status, state)
  }
  providerStatus = 'unpaid'; providerPaymentStatus = 'processing'
  const fenced = sign('evt_fenced'); await service.receive('default', fenced.bytes, fenced.signature)
  const [fencedReceipt] = await db.select().from(stripeInbox).where(eq(stripeInbox.eventId, 'evt_fenced'))
  holdNext = true; held = undefined
  const late = service.inboxJob.handler({ inboxId: fencedReceipt!.id }, job())
  for (let count = 0; !held && count < 500; count++) await wait(10)
  assert.ok(held, 'First authoritative GET is held after its claim')
  await db.update(stripeInbox).set({ leaseUntil: new Date(0) }).where(eq(stripeInbox.id, fencedReceipt!.id))
  await db.update(stripeBinding).set({ leaseUntil: new Date(0) }).where(eq(stripeBinding.id, operation.bindingId!))
  assert.equal((await service.recoverExpiredAttempts()).receipts, 1)
  providerStatus = 'paid'; providerPaymentStatus = 'succeeded'
  assert.deepEqual(await service.inboxJob.handler({ inboxId: fencedReceipt!.id }, job()), { status: 'processed' })
  held!(); await late
  assert.equal((await service.getCheckout(context, { bindingId: operation.bindingId! })).paymentStatus, 'paid', 'Late expired attempt cannot overwrite newer authoritative state')
  const deniedEvent = sign('evt_denied_callback')
  await service.receive('default', deniedEvent.bytes, deniedEvent.signature)
  const [deniedReceipt] = await db.select().from(stripeInbox).where(eq(stripeInbox.eventId, 'evt_denied_callback'))
  authorized = false; const callbackGets = gets
  await service.inboxJob.handler({ inboxId: deniedReceipt!.id }, job())
  assert.equal(gets, callbackGets, 'Callback has no invented human actor and rechecks current policy')
  authorized = true
  const blocked = await service.requestPaymentReconciliation(context, { kind: 'checkout', bindingId: operation.bindingId })
  const blockedId = 'operationId' in blocked ? blocked.operationId : blocked.id
  authorized = false; const priorGets = gets; await service.runJob.handler({ operationId: blockedId }, job()); assert.equal(gets, priorGets); authorized = true
  transport = 'disconnect'
  const ambiguous = await service.requestCheckout(context, { ...input, idempotencyKey: 'ambiguous' }), ambiguousId = 'operationId' in ambiguous ? ambiguous.operationId : ambiguous.id
  await service.runJob.handler({ operationId: ambiguousId }, job()); assert.equal((await service.getOperation(context, { operationId: ambiguousId })).status, 'reconciliation_required')
  await assert.rejects(service.requestCheckout(context, { ...input, idempotencyKey: 'fresh-key-cannot-escape' }))
  const priorPosts = posts; await service.runJob.handler({ operationId: ambiguousId }, job()); assert.equal(posts, priorPosts)
  transport = 'cached500'; await service.replayCheckout(context, { operationId: ambiguousId }); await assert.rejects(service.cancelOperation(context, { operationId: ambiguousId }), { code: 'conflict' }); await service.runJob.handler({ operationId: ambiguousId }, job())
  assert.equal(seenKeys.at(-1), seenKeys.at(-2)); assert.equal(seenBodies.at(-1), seenBodies.at(-2))
  await db.update(stripeOperationLedger).set({ firstDispatchAt: new Date(Date.now() - 23 * 60 * 60 * 1000) }).where(eq(stripeOperationLedger.id, ambiguousId))
  await assert.rejects(service.replayCheckout(context, { operationId: ambiguousId }))
  transport = 'ok'
  const crashed = await service.requestCheckout(foreign, { customerBindingId: otherBinding.id, idempotencyKey: 'crash-after-acceptance', items: [{ offerId: 'approved', quantity: 1 }] })
  const crashedId = 'operationId' in crashed ? crashed.operationId : crashed.id
  holdPost = true; held = undefined
  const driver = spawn('node', ['--experimental-strip-types', '.fixture/crash-driver.ts', crashedId], { env: { ...process.env, DATABASE_URL: url.toString(), STRIPE_FIXTURE_URL: configured.apiBase }, stdio: 'ignore' })
  try {
    for (let count = 0; !held && count < 500; count++) await wait(10)
    assert.ok(held, 'Pinned SDK child dispatched and local provider accepted POST')
    driver.kill('SIGKILL'); await once(driver, 'exit'); held!()
    assert.equal((await service.getOperation(foreign, { operationId: crashedId })).status, 'dispatching')
    await db.update(stripeOperationLedger).set({ leaseUntil: new Date(0) }).where(eq(stripeOperationLedger.id, crashedId))
    await db.update(stripeBinding).set({ leaseUntil: new Date(0) }).where(eq(stripeBinding.id, otherBinding.id))
    assert.equal((await service.recoverExpiredAttempts()).operations, 1)
    assert.equal((await service.getOperation(foreign, { operationId: crashedId })).status, 'reconciliation_required')
    const afterCrash = posts; await service.runJob.handler({ operationId: crashedId }, job()); assert.equal(posts, afterCrash)
  }
  finally { if (driver.exitCode === null && driver.signalCode === null) { driver.kill('SIGKILL'); await once(driver, 'exit') } held?.() }
  // Accepted Checkout identity survives later local projection rejection. Its
  // explicit recovery must GET even after the POST idempotency horizon expires.
  const knownContext: TrustedContext = { actorUserId: 'owner-known', scope: { kind: 'user', id: 'owner-known' } }
  const knownCustomer = await db.transaction(tx => service.bindInTransaction(tx, knownContext, { localResourceId: 'known-customer', connectionId: 'default', resourceKind: 'customer', remoteId: 'cus_known' }))
  const knownInput = { customerBindingId: knownCustomer.id, idempotencyKey: 'known', items: [{ offerId: 'approved', quantity: 1 }] }
  checkoutId = 'cs_known'; paymentId = 'pi_known'; customerId = 'cus_known'
  transport = 'reject400'
  const rejection = await service.requestCheckout(knownContext, { ...knownInput, idempotencyKey: 'rejected' }), rejectionId = 'operationId' in rejection ? rejection.operationId : rejection.id
  await service.runJob.handler({ operationId: rejectionId }, job())
  assert.equal((await service.getOperation(knownContext, { operationId: rejectionId })).status, 'failed')
  transport = 'badPayment'
  const known = await service.requestCheckout(knownContext, knownInput), knownId = 'operationId' in known ? known.operationId : known.id
  await service.runJob.handler({ operationId: knownId }, job())
  const accepted = await service.getOperation(knownContext, { operationId: knownId })
  assert.equal(accepted.status, 'reconciliation_required', 'A local 422 after provider acceptance is not a definitive provider rejection')
  assert.notEqual(accepted.bindingId, knownCustomer.id)
  assert.equal((await db.select().from(stripeBinding).where(eq(stripeBinding.id, accepted.bindingId!)))[0]!.remoteId, 'cs_known')
  await db.update(stripeOperationLedger).set({ firstDispatchAt: new Date(Date.now() - 24 * 60 * 60 * 1000) }).where(eq(stripeOperationLedger.id, knownId))
  transport = 'ok'; const beforeKnownRecovery = posts
  await service.replayCheckout(knownContext, { operationId: knownId })
  assert.deepEqual(await service.runJob.handler({ operationId: knownId }, job()), { status: 'processed' })
  assert.equal(posts, beforeKnownRecovery, 'Known remote identity always uses authoritative GET, never POST replay')
  assert.equal((await service.getOperation(knownContext, { operationId: knownId })).status, 'succeeded')
  const queue = JSON.stringify((await sql.query(`select data,output from pgboss.job where name like 'stripe.%'`)).rows)
  assert.ok(!/checkout\.stripe|cus_owned|price_registered|sk_test|owner-one|metadata|success_url/.test(queue))
  const publicView = JSON.stringify({ operation: await service.getOperation(context, { operationId: ambiguousId }), payments: await service.listPayments(context) })
  assert.ok(!/private customer|sk_test|price_registered|metadata|success_url/.test(publicView))
  await boss.stop()
  const snapshot = (await sql.query(`select (select jsonb_agg(to_jsonb(t) order by id) from stripe_binding t) bindings,(select jsonb_agg(to_jsonb(t) order by id) from stripe_operation t) operations,(select jsonb_agg(to_jsonb(t) order by binding_id) from stripe_projection t) projections,(select jsonb_agg(to_jsonb(t) order by id) from stripe_inbox t) inbox,(select jsonb_agg(to_jsonb(t) order by id) from drizzle.__drizzle_migrations t) history`)).rows
  await writeFile('.fixture/retained.json', JSON.stringify({ name, url: url.toString(), snapshot }), { mode: 0o600 })
  console.info('Stripe disposable PostgreSQL transactions, scoped state, authoritative hints, uncertainty, replay cutoff and privacy passed.')
}
finally { await boss.stop(); remote.closeAllConnections(); await new Promise<void>(resolve => remote.close(() => resolve())); await sql.end(); await admin.end() }
