import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { eq } from 'drizzle-orm'
import { createJobsBoss, defineQueues, registerWorkers } from '@repo/nuxt-jobs/server'
import { signWebhook } from '@repo/nuxt-webhooks/server'
import {
  createMedusaService, createBridgeEvent, readBridge, deadline, adminGet, endpoint,
  MedusaError, bridgeSecrets, encodeCursor, localCursor, pageCursor, parse, reconcileInput,
  projectResource, parseExactJson,
} from '@repo/nuxt-medusa/server'
import type { TrustedContext } from '@repo/nuxt-medusa/server'
import { medusaBinding, medusaProjection, medusaOperation, medusaInbox } from '@repo/nuxt-medusa/schema'

export async function runContract(databaseUrl: string) {
  if (!process.versions.bun) assert.equal(Number(process.versions.node.split('.')[0]), 24, 'Actual Node24 required')
  else assert.equal(process.versions.bun, '1.4.2', 'Pinned Bun required')
  const sql = postgres(databaseUrl, { max: 4 }), db = drizzle(sql)
  await migrate(db, { migrationsFolder: 'server/database/migrations' })
  const config = { databaseUrl, schema: 'medusa_fixture_jobs', concurrency: 1, useListenNotify: false }
  const migrator = createJobsBoss(config, 'migration'); await migrator.start(); await migrator.stop()
  const boss = createJobsBoss(config); await boss.start()
  const secret = `whsec_${Buffer.alloc(32, 13).toString('base64')}`, previous = `whsec_${Buffer.alloc(32, 12).toString('base64')}`
  const actor = `owner-${randomUUID()}`, other = `owner-${randomUUID()}`
  const ctx: TrustedContext = { actorUserId: actor, scope: { kind: 'user', id: actor } }
  const outside: TrustedContext = { actorUserId: other, scope: { kind: 'user', id: other } }
  const owners = new Set([actor, other])
  const targetMap = new Map<string, string>([['prod_a', actor], ['prod_b', other], ['order_a', actor], ['missing', actor]])
  let calls = 0, title = 'Safe product', revoked = false, mode = 'normal', closed = 0
  const paths: string[] = []
  const fixture = createServer((request, response) => {
    calls++; paths.push(request.url!)
    request.on('close', () => { closed++ })
    assert.equal(request.headers.authorization, `Basic ${Buffer.from('fixture-admin-key:').toString('base64')}`)
    assert.equal(request.headers['x-medusa-access-token'], undefined)
    assert.equal(request.method, 'GET')
    const url = new URL(request.url!, 'http://127.0.0.1')
    assert(url.searchParams.has('fields'))
    const resource = { id: 'prod_a', title, handle: 'safe-product', status: 'published', updated_at: '2026-10-01T01:00:00.123Z', metadata: { password: 'PRIVATE-METADATA' }, images: [{ url: 'https://private.example.test/image' }] }
    const order = { id: 'order_a', status: 'pending', payment_status: 'captured', fulfillment_status: 'not_fulfilled', currency_code: 'usd', total: '9007199254740993.123400', updated_at: '2026-10-01T01:00:00.123Z', email: 'PRIVATE-EMAIL', shipping_address: { address: 'PRIVATE-ADDRESS' } }
    if (revoked) owners.delete(actor)
    if (mode === 'redirect') { response.writeHead(302, { location: '/admin/products/prod_b' }); response.end('{}'); return }
    if (mode === 'forbidden') { response.writeHead(403); response.end('{"private":"PRIVATE-ERROR"}'); return }
    if (url.pathname.endsWith('/missing') || mode === 'deleted') { response.writeHead(404); response.end('{}'); return }
    if (mode === 'huge') { response.writeHead(200, { 'content-type': 'application/json' }); response.end('x'.repeat(2 * 1024 * 1024 + 1)); return }
    const body = JSON.stringify(url.pathname === '/admin/products' ? { products: [resource, { ...resource, id: 'prod_b' }], count: 2, offset: 0, limit: 2 } : url.pathname === '/admin/orders' ? { orders: [order], count: 1 } : url.pathname.includes('/orders/') ? { order } : { product: { ...resource, id: decodeURIComponent(url.pathname.split('/').at(-1)!) } })
    if (mode === 'slow-header') { const timer = setTimeout(() => response.end(body), 250); response.on('close', () => clearTimeout(timer)); return }
    response.writeHead(200, { 'content-type': 'application/json' })
    if (mode === 'slow-body') { response.write(body.slice(0, 5)); const timer = setTimeout(() => response.end(body.slice(5)), 300); response.on('close', () => clearTimeout(timer)); return }
    response.end(body)
  })
  await new Promise<void>(resolve => fixture.listen(0, '127.0.0.1', resolve))
  const port = (fixture.address() as { port: number }).port
  const connection = { id: 'default', baseUrl: `http://127.0.0.1:${port}`, secretApiKey: 'fixture-admin-key' }
  const env = { NODE_ENV: 'test', DATABASE_URL: databaseUrl, MEDUSA_BASE_URL: connection.baseUrl, MEDUSA_SECRET_API_KEY: connection.secretApiKey, MEDUSA_BRIDGE_WEBHOOK_SECRET: secret, MEDUSA_BRIDGE_WEBHOOK_SECRET_PREVIOUS: previous }
  const policy = {
    database: () => db, boss: async () => boss, env,
    authorizeScope: async (actorUserId: string, scope: TrustedContext['scope']) => scope.kind === 'user' && scope.id === actorUserId && owners.has(actorUserId),
    authorizeBoundResource: async (context: TrustedContext, binding: typeof medusaBinding.$inferSelect) => context.scope.id === binding.scopeId && targetMap.get(binding.remoteId) === context.actorUserId,
    authorizeMedusaResource: async (context: TrustedContext, binding: Pick<typeof medusaBinding.$inferSelect, 'remoteId'>) => targetMap.get(binding.remoteId) === context.actorUserId,
    authorizeReconciliation: async (binding: typeof medusaBinding.$inferSelect) => owners.has(binding.scopeId) && targetMap.get(binding.remoteId) === binding.scopeId,
  }
  const service = createMedusaService(policy), registry = { [service.operationJob.name]: service.operationJob, [service.inboxJob.name]: service.inboxJob }
  await defineQueues(boss, registry)
  async function makeBinding(context: TrustedContext, resourceKind: 'product' | 'order', remoteId: string) {
    return db.transaction(tx => service.createBindingInTransaction(tx, context, { scope: context.scope, localResourceId: randomUUID(), connectionId: 'default', resourceKind, remoteId }))
  }
  async function operation(kind: 'product' | 'order', bindingId: string) {
    const queued = await service.requestResourceReconciliation(ctx, { kind, bindingId }); assert('operationId' in queued)
    return queued.operationId
  }
  const job = { id: randomUUID(), signal: new AbortController().signal, retryCount: 0, retryLimit: 5 }
  async function run(id: string) { return service.operationJob.handler({ operationId: id }, job) }
  function request(event: ReturnType<typeof createBridgeEvent>, signedSecret = secret, now?: number, changed?: Uint8Array) {
    const bytes = Buffer.from(JSON.stringify(event))
    return new Request(`http://127.0.0.1:${port}/bridge`, { method: 'POST', headers: signWebhook(event.id, bytes, signedSecret, now), body: changed ?? bytes })
  }
  try {
    assert.equal(calls, 0, 'lazy construction')
    for (const url of ['http://localhost:1', 'http://127.1:1', 'http://2130706433:1', 'http://0x7f000001:1', 'http://[::ffff:127.0.0.1]:1', 'https://u:p@example.test', 'https://example.test/#private', 'http://example.test']) assert.throws(() => endpoint(url, env), MedusaError)
    assert.throws(() => endpoint(connection.baseUrl, { NODE_ENV: 'production' }), MedusaError)
    assert.equal(endpoint(connection.baseUrl, env).hostname, '127.0.0.1')
    assert.throws(() => parse(reconcileInput, { kind: 'product', bindingId: randomUUID(), connectionId: 'evil' }), MedusaError)
    for (const cursor of ['e30=', encodeCursor([1, '2026-10-01T01:00:00Z', randomUUID()]), encodeCursor([1, '2026-99-01T01:00:00.000Z', randomUUID()])]) assert.throws(() => localCursor(cursor), MedusaError)
    assert.throws(() => pageCursor(encodeCursor([1, 'order', 'default', 0]), 'product', 'default'), MedusaError)
    assert.throws(() => pageCursor(encodeCursor([1, 'product', 'default', -1]), 'product', 'default'), MedusaError)
    const a = await makeBinding(ctx, 'product', 'prod_a'), b = await makeBinding(outside, 'product', 'prod_b'), order = await makeBinding(ctx, 'order', 'order_a')
    await assert.rejects(service.getProduct(outside, { bindingId: a.id }), /Resource not found/)
    await assert.rejects(service.requestResourceReconciliation(ctx, { kind: 'product', bindingId: b.id }), /Resource not found/)
    await assert.rejects(makeBinding(outside, 'product', 'prod_a'), /Access denied/)
    await assert.rejects(service.getProduct(ctx, { bindingId: a.id }), /Resource not found/)
    const first = await operation('product', a.id); assert.deepEqual(await run(first), { status: 'processed' })
    const product = await service.getProduct(ctx, { bindingId: a.id }); assert.equal('title' in product && product.title, title)
    const second = await operation('order', order.id); await run(second)
    const projectedOrder = await service.getOrder(ctx, { bindingId: order.id }); assert.equal('total' in projectedOrder && projectedOrder.total, '9007199254740993.1234')
    const precise = parseExactJson('{"order":{"id":"order_a","status":"foreign-status","currency_code":"usd","total":9007199254740993.123400}}') as { order: unknown }
    const exact = projectResource('order', order.id, 'order_a', precise.order); assert.equal(exact.status, 'unknown'); assert.equal('total' in exact && exact.total, '9007199254740993.1234')
    assert.throws(() => projectResource('product', a.id, 'prod_a', { id: 'prod_a', title: 'x'.repeat(257) }), MedusaError)
    assert.equal((await service.listProducts(ctx)).items.length, 1)
    assert.equal((await service.listProducts(outside)).items.length, 0)
    // A caller transaction rollback erases both operation and durable Jobs enqueue.
    const before = await sql`select count(*)::int as count from medusa_operation`
    const jobsBefore = await sql`select count(*)::int as count from medusa_fixture_jobs.job`
    await assert.rejects(db.transaction(async tx => { await service.requestResourceReconciliationInTransaction(tx, ctx, { kind: 'product', bindingId: a.id }, 'rollback'); throw new Error('rollback') }))
    assert.deepEqual(await sql`select count(*)::int as count from medusa_operation`, before)
    assert.deepEqual(await sql`select count(*)::int as count from medusa_fixture_jobs.job`, jobsBefore)
    // Same trusted caller key is immutable, including the binding target.
    await db.transaction(tx => service.requestResourceReconciliationInTransaction(tx, ctx, { kind: 'product', bindingId: a.id }, 'same-key'))
    const duplicate = await db.transaction(tx => service.requestResourceReconciliationInTransaction(tx, ctx, { kind: 'product', bindingId: a.id }, 'same-key'))
    assert('id' in duplicate)
    const missing = await makeBinding(ctx, 'product', 'missing')
    await assert.rejects(db.transaction(tx => service.requestResourceReconciliationInTransaction(tx, ctx, { kind: 'product', bindingId: missing.id }, 'same-key')), /Operation conflict/)
    // Cancellation before claim prevents transport; repeated cancellation is safe.
    const cancel = await operation('product', a.id), oldCalls = calls
    assert.equal((await service.cancelOperation(ctx, { operationId: cancel })).status, 'cancelled')
    assert.equal((await service.cancelOperation(ctx, { operationId: cancel })).status, 'cancelled')
    await run(cancel); assert.equal(calls, oldCalls)
    await assert.rejects(service.getOperation(outside, { operationId: cancel }), /Resource not found/)
    // Recheck current actor and callback policy; provider metadata cannot authorize.
    const revokedId = await operation('product', a.id); owners.delete(actor); await run(revokedId); assert.equal(calls, oldCalls); owners.add(actor)
    const deny = createMedusaService({ ...policy, authorizeReconciliation: undefined })
    const event = createBridgeEvent('product.updated', 'prod_a')
    const r = request(event); assert.deepEqual(await service.receive(r, 'default'), { accepted: true })
    const [receipt] = await db.select().from(medusaInbox).where(eq(medusaInbox.eventId, event.id))
    assert(receipt)
    await deny.inboxJob.handler({ inboxId: receipt.id }, job)
    assert.equal(calls, oldCalls)
    await deny.stop()
    // Rotation; raw tampering; stale/future; ambiguous header; ID/type agreement.
    const check = async (r: Request) => { const budget = deadline(5000, [r.signal]); try { return await readBridge(r, bridgeSecrets(env), budget) } finally { budget.close() } }
    await check(request(event, previous))
    for (const invalid of [request(event, secret, Date.now() - 301000), request(event, secret, Date.now() + 301000), request(event, secret, undefined, Buffer.from('{}'))]) await assert.rejects(check(invalid), MedusaError)
    const duplicateHeader = request(event); duplicateHeader.headers.append('webhook-id', event.id); await assert.rejects(check(duplicateHeader), MedusaError)
    const inboxBefore = await sql`select count(*)::int as count from medusa_inbox`
    await assert.rejects(db.transaction(async tx => { const r = request(createBridgeEvent('product.updated', 'prod_a')); const budget = deadline(5000); try { await service.receiveInTransaction(tx, 'default', await readBridge(r, [secret], budget), budget); throw new Error('rollback') } finally { budget.close() } }))
    assert.deepEqual(await sql`select count(*)::int as count from medusa_inbox`, inboxBefore)
    const supported = createBridgeEvent('product.updated', 'prod_a')
    await service.receive(request(supported), 'default'); await service.receive(request(supported), 'default')
    const [inbox] = await db.select().from(medusaInbox).where(eq(medusaInbox.eventId, supported.id)); assert(inbox)
    assert.equal((await sql`select count(*)::int as count from medusa_fixture_jobs.job where data->>'inboxId'=${inbox.id}`)[0]!.count, 1)
    title = 'Latest authoritative product'; await service.inboxJob.handler({ inboxId: inbox.id }, job)
    const sameResource = createBridgeEvent('product.created', 'prod_a'); await service.receive(request(sameResource), 'default')
    const [late] = await db.select().from(medusaInbox).where(eq(medusaInbox.eventId, sameResource.id)); await service.inboxJob.handler({ inboxId: late!.id }, job)
    // A same-ID/different-digest collision never remaps ownership or replaces the first hint.
    const collision = createBridgeEvent('product.deleted', 'prod_b', supported.id)
    await service.receive(request(collision), 'default'); await service.receive(request(collision), 'default')
    const [originalReceipt] = await db.select().from(medusaInbox).where(eq(medusaInbox.id, inbox.id))
    assert.equal(originalReceipt!.remoteHint, 'prod_a'); assert.equal(originalReceipt!.bodySha256, inbox.bodySha256)
    await service.inboxJob.handler({ inboxId: inbox.id }, job)
    assert.equal('title' in await service.getProduct(ctx, { bindingId: a.id }) && (await service.getProduct(ctx, { bindingId: a.id }) as { title: string }).title, title)
    await service.receive(request(createBridgeEvent('product.created', 'foreign')), 'default')
    const unsupported = { version: 1, id: randomUUID(), type: 'product.restored', resourceKind: 'product', resourceId: 'prod_a' }
    const raw = Buffer.from(JSON.stringify(unsupported)); await service.receive(new Request('http://127.0.0.1', { method: 'POST', headers: signWebhook(unsupported.id, raw, secret), body: raw }), 'default')
    // Callback cannot grant new ownership; public serializers and queue payloads remain closed.
    assert.equal((await db.select().from(medusaBinding)).length, 4)
    const page = await service.requestSyncPage(ctx, { kind: 'product', limit: 2 }); assert('operationId' in page); await run(page.operationId)
    assert.deepEqual(await service.getSyncResult(ctx, { operationId: page.operationId }), { processed: 1, nextCursor: null })
    assert.equal((await service.listProducts(outside)).items.length, 0)
    // Revocation between GET and commit prevents projection change.
    const beforeProjection = await service.getProduct(ctx, { bindingId: a.id }); const beforeCommit = await operation('product', a.id); revoked = true; title = 'Must not commit'; await run(beforeCommit); revoked = false; owners.add(actor)
    assert.deepEqual(await service.getProduct(ctx, { bindingId: a.id }), beforeProjection)
    // 403 never tombstones; authenticated absence retains history.
    mode = 'forbidden'; const forbidden = await operation('product', a.id); await run(forbidden); assert.equal((await service.getProduct(ctx, { bindingId: a.id })).deleted, false)
    mode = 'deleted'; const deletion = await operation('product', a.id); await run(deletion); assert.equal((await service.getProduct(ctx, { bindingId: a.id })).deleted, true)
    mode = 'normal'
    // Abandoned dispatch is explicitly recoverable; token revision fences stale work.
    const stale = await operation('product', a.id)
    await db.update(medusaOperation).set({ status: 'dispatching', attemptToken: randomUUID(), leaseExpiresAt: new Date(Date.now() - 1) }).where(eq(medusaOperation.id, stale))
    assert.equal((await service.repair({ operationIds: [stale] })).repaired, 1)
    await run(stale); assert.equal((await service.getOperation(ctx, { operationId: stale })).status, 'succeeded')
    // Bound response streaming, slow headers/body, and actual transport cancellation.
    for (const slow of ['slow-header', 'slow-body']) {
      mode = slow; await assert.rejects(adminGet(connection, 'product', { remoteId: 'prod_a' }, { env, timeoutMs: 30 }), /Operation deadline exceeded/)
    }
    mode = 'slow-body'; const controller = new AbortController(); const cancelled = adminGet(connection, 'product', { remoteId: 'prod_a' }, { env, signal: controller.signal }); setTimeout(() => controller.abort(), 30); await assert.rejects(cancelled, /Operation cancelled/)
    mode = 'redirect'; const beforeRedirect = calls; await assert.rejects(adminGet(connection, 'product', { remoteId: 'prod_a' }, { env }), /Operation unsupported/); assert.equal(calls, beforeRedirect + 1)
    mode = 'huge'; await assert.rejects(adminGet(connection, 'product', { remoteId: 'prod_a' }, { env }), /Limit exceeded/)
    mode = 'normal'; assert(closed > 0)
    const oversized = request(event); const over = new Request('http://127.0.0.1', { method: 'POST', headers: oversized.headers, body: Buffer.alloc(1024 * 1024 + 1) }); await assert.rejects(check(over), /Limit exceeded/)
    // A genuinely registered Jobs worker consumes ID-only input and emits only safe output.
    await boss.deleteAllJobs(service.operationJob.name); await boss.deleteAllJobs(service.inboxJob.name)
    const live = await operation('order', order.id)
    const worker = createJobsBoss(config, 'worker'); await worker.start(); await registerWorkers(worker, registry, 1)
    try {
      let completed = false
      for (let i = 0; i < 100; i++) { if ((await service.getOperation(ctx, { operationId: live })).status === 'succeeded') { completed = true; break } await new Promise(resolve => setTimeout(resolve, 100)) }
      assert(completed, 'actual pg-boss worker must complete')
    }
    finally { await worker.stop() }
    const persisted = JSON.stringify([...await db.select().from(medusaProjection), ...await db.select().from(medusaInbox), ...await db.select().from(medusaOperation)])
    for (const privateValue of ['PRIVATE-METADATA', 'PRIVATE-EMAIL', 'PRIVATE-ADDRESS', 'PRIVATE-ERROR', connection.secretApiKey, secret, connection.baseUrl]) assert(!persisted.includes(privateValue))
    for (const row of await sql`select data,output from medusa_fixture_jobs.job`) {
      assert.deepEqual(Object.keys(row.data).sort(), ['operationId'])
      if (row.output) assert.deepEqual(row.output, { status: 'processed' })
    }
    assert(paths.some(path => path.startsWith('/admin/products/prod_a?'))); assert(paths.some(path => path.startsWith('/admin/orders/order_a?')))
    assert(!paths.some(path => /cart|payment|checkout|auth|customer/.test(new URL(path, 'http://127.0.0.1').pathname)))
    await db.transaction(tx => service.retireBindingInTransaction(tx, ctx, { bindingId: a.id }))
    await assert.rejects(service.getProduct(ctx, { bindingId: a.id }), /Resource not found/)
    await assert.rejects(service.requestResourceReconciliation(ctx, { kind: 'product', bindingId: a.id }), /Resource not found/)
    assert.equal((await db.select().from(medusaProjection).where(eq(medusaProjection.bindingId, a.id))).length, 1)
    console.info(`[medusa] ${process.versions.bun ? 'Bun' : 'Node'} scoped protocol, receipt, rollback, authorization, cancellation, privacy and real Jobs contract passed`)
  }
  finally { await service.stop(); await boss.stop(); await new Promise<void>((resolve) => { fixture.close(() => resolve()); fixture.closeAllConnections() }); await sql.end() }
}
