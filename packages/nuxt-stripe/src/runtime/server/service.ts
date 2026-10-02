import { createHash, randomUUID } from 'node:crypto'
import { and, desc, eq, isNull, lt, or, sql } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import type Stripe from 'stripe'
import { z } from 'zod'
import { defineJob, sendRegisteredJobInTransaction } from '@repo/nuxt-jobs/server'
import type { createJobsBoss, JobContext } from '@repo/nuxt-jobs/server'
import { stripeBinding as bindings, stripeOperationLedger as operations, stripeProjection as projections, stripeInbox as inbox } from './schema'
import type { StripeBinding, StripeOperation, FrozenCheckout, ResourceKind, OperationKind } from './schema'
import { StripeCapabilityError, safeError } from './errors'
import { connectionFromEnvironment, validateConnection } from './config'
import type { StripeConnection } from './config'
import { trustedContext, validate, uuid, opaque, connectionId, checkoutInput, reconcileInput, listInput, decodeCursor, encodeCursor } from './validation'
import type { TrustedContext } from './validation'
import { deadline, stripeOperation } from './transport'
import { verifyStripeWebhook } from './webhook'
import { checkoutProjection, paymentProjection } from './projection'

type Database = Pick<PgDatabase<PgQueryResultHKT>, 'select' | 'insert' | 'update' | 'transaction'>
export type StripeTransaction = Parameters<Parameters<Database['transaction']>[0]>[0]
export interface StripeServiceOptions {
  database(): Database
  boss(): Promise<ReturnType<typeof createJobsBoss>>
  env?: NodeJS.ProcessEnv
  resolveConnection?(id: string, signal?: AbortSignal): Promise<StripeConnection>
  authorizeScope?(actorUserId: string, scope: TrustedContext['scope']): Promise<boolean>
  authorizeBoundResource?(context: TrustedContext, binding: StripeBinding): Promise<boolean>
  /** Callback workers have no human actor. Missing policy denies reconciliation. */
  authorizeReconciliation?(binding: StripeBinding, signal: AbortSignal): Promise<boolean>
  resolveOffer?(context: TrustedContext, offerId: string): Promise<{ priceId: string, currency: string }>
  approvedRedirects?(context: TrustedContext): Promise<{ successUrl: string, cancelUrl: string }>
}
function view(row: StripeOperation) {
  return { id: row.id, kind: row.kind, status: row.status, bindingId: row.resultBindingId ?? row.bindingId, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), error: row.errorCode ? new StripeCapabilityError(row.errorCode).public(row.kind !== 'create_checkout') : null }
}
function visibility(context: TrustedContext) { return and(eq(bindings.scopeKind, context.scope.kind), eq(bindings.scopeId, context.scope.id)) }
function contextFor(row: StripeOperation): TrustedContext { return { actorUserId: row.actorUserId, scope: { kind: row.scopeKind, id: row.scopeId } } }
const policy = { retryLimit: 5, retryDelay: 30, retryBackoff: true, retryDelayMax: 900, deleteAfterSeconds: 86400 }
const leaseMs = 45000
const replayMs = 23 * 60 * 60 * 1000
export function createStripeService(options: StripeServiceOptions) {
  const database = options.database
  async function authorize(context: TrustedContext, binding?: StripeBinding) {
    trustedContext(context)
    if (!options.authorizeScope || !await options.authorizeScope(context.actorUserId, context.scope)) throw new StripeCapabilityError('forbidden')
    if (binding && (!options.authorizeBoundResource || !await options.authorizeBoundResource(context, binding))) throw new StripeCapabilityError('forbidden')
  }
  async function connection(id: string, signal?: AbortSignal) {
    validate(connectionId, id)
    const resolved = options.resolveConnection ? await options.resolveConnection(id, signal) : id === 'default' ? connectionFromEnvironment(options.env) : null
    if (!resolved || resolved.id !== id) throw new StripeCapabilityError('unconfigured')
    return validateConnection(resolved, options.env?.NODE_ENV)
  }
  async function owned(context: TrustedContext, id: string, kind?: ResourceKind, tx: Pick<StripeTransaction, 'select'> = database()) {
    await authorize(context)
    const [binding] = await tx.select().from(bindings).where(and(eq(bindings.id, validate(uuid, id)), visibility(context), isNull(bindings.retiredAt), kind ? eq(bindings.resourceKind, kind) : undefined)).limit(1)
    if (!binding) throw new StripeCapabilityError('not_found')
    await authorize(context, binding)
    return binding
  }
  async function timeouts(tx: StripeTransaction, milliseconds = 5000) {
    await tx.execute(sql`select set_config('transaction_timeout', ${`${milliseconds}ms`}, true), set_config('statement_timeout', ${`${Math.max(1, milliseconds - 500)}ms`}, true), set_config('lock_timeout', '1000ms', true)`)
  }
  const runJob = defineJob({ name: 'stripe.operation', payload: z.object({ operationId: uuid }).strict(), queue: policy, send: { expireInSeconds: 45 }, handler: (payload, job) => runOperation(payload.operationId, job) })
  const inboxJob = defineJob({ name: 'stripe.receipt', payload: z.object({ inboxId: uuid }).strict(), queue: policy, send: { expireInSeconds: 45 }, handler: (payload, job) => runReceipt(payload.inboxId, job) })
  async function enqueue(tx: StripeTransaction, kind: 'operation' | 'receipt', id: string) {
    const boss = await options.boss()
    if (kind === 'operation') return sendRegisteredJobInTransaction(boss, { [runJob.name]: runJob }, tx as unknown as Parameters<typeof sendRegisteredJobInTransaction>[2], runJob.name, { operationId: id }, options.env?.DATABASE_URL ?? process.env.DATABASE_URL)
    return sendRegisteredJobInTransaction(boss, { [inboxJob.name]: inboxJob }, tx as unknown as Parameters<typeof sendRegisteredJobInTransaction>[2], inboxJob.name, { inboxId: id }, options.env?.DATABASE_URL ?? process.env.DATABASE_URL)
  }
  /** Trusted server-only creation. Never expose binding creation in browser/callback routes. */
  async function bindInTransaction(tx: StripeTransaction, context: TrustedContext, input: { localResourceId: string, connectionId: string, resourceKind: ResourceKind, remoteId: string }) {
    await authorize(context)
    validate(opaque, input.localResourceId); validate(opaque, input.remoteId); validate(connectionId, input.connectionId)
    if (!['customer', 'checkout', 'payment'].includes(input.resourceKind)) throw new StripeCapabilityError('invalid_input')
    const [binding] = await tx.insert(bindings).values({ id: randomUUID(), scopeKind: context.scope.kind, scopeId: context.scope.id, ...input }).returning()
    return binding!
  }
  async function insertOperation(tx: StripeTransaction, context: TrustedContext, binding: StripeBinding, kind: OperationKind, callerKey: string, digest: string, intent: FrozenCheckout | null) {
    const id = randomUUID()
    const [inserted] = await tx.insert(operations).values({ id, actorUserId: context.actorUserId, scopeKind: context.scope.kind, scopeId: context.scope.id, connectionId: binding.connectionId, bindingId: binding.id, kind, callerKey, inputDigest: digest, intent, status: 'queued' }).onConflictDoNothing().returning()
    if (inserted) { await enqueue(tx, 'operation', inserted.id); return { operationId: inserted.id, status: 'queued' as const } }
    const [existing] = await tx.select().from(operations).where(and(eq(operations.scopeKind, context.scope.kind), eq(operations.scopeId, context.scope.id), eq(operations.connectionId, binding.connectionId), eq(operations.kind, kind), eq(operations.callerKey, callerKey))).limit(1)
    if (!existing || existing.inputDigest !== digest) throw new StripeCapabilityError('conflict')
    return view(existing)
  }
  /** Uses caller transaction without commit/rollback/reconnect/retry. Result is durable only after caller commits. */
  async function requestCheckoutInTransaction(tx: StripeTransaction, context: TrustedContext, unknownInput: unknown) {
    const input = validate(checkoutInput, unknownInput), binding = await owned(context, input.customerBindingId, 'customer', tx)
    const digest = createHash('sha256').update(JSON.stringify({ customerBindingId: input.customerBindingId, items: [...input.items].sort((a, b) => a.offerId.localeCompare(b.offerId)) })).digest('hex')
    // Duplicate intent resolves before consulting mutable offer registry/configuration.
    const [existing] = await tx.select().from(operations).where(and(eq(operations.scopeKind, context.scope.kind), eq(operations.scopeId, context.scope.id), eq(operations.connectionId, binding.connectionId), eq(operations.kind, 'create_checkout'), eq(operations.callerKey, input.idempotencyKey))).limit(1)
    if (existing) { if (existing.inputDigest !== digest) throw new StripeCapabilityError('conflict'); return view(existing) }
    const configured = await connection(binding.connectionId, context.signal)
    if (!options.resolveOffer || !options.approvedRedirects) throw new StripeCapabilityError('unconfigured')
    const lines: Stripe.Checkout.SessionCreateParams.LineItem[] = []
    let currency: string | undefined
    for (const item of [...input.items].sort((a, b) => a.offerId.localeCompare(b.offerId))) {
      const offer = await options.resolveOffer(context, item.offerId)
      if (!/^price_[A-Za-z0-9]+$/.test(offer.priceId) || !/^[a-z]{3}$/.test(offer.currency) || (currency && currency !== offer.currency)) throw new StripeCapabilityError('unsupported')
      currency = offer.currency; lines.push({ price: offer.priceId, quantity: item.quantity })
    }
    const redirects = await options.approvedRedirects(context)
    for (const value of [redirects.successUrl, redirects.cancelUrl]) {
      let url: URL
      try { url = new URL(value) } catch { throw new StripeCapabilityError('unconfigured') }
      if (url.protocol !== 'https:' || url.username || url.password || url.hash || value.length > 2048) throw new StripeCapabilityError('unconfigured')
    }
    const intent: FrozenCheckout = { customerBindingId: binding.id, accountId: configured.accountId, mode: configured.mode, parameters: { mode: 'payment', customer: binding.remoteId, line_items: lines, success_url: redirects.successUrl, cancel_url: redirects.cancelUrl, automatic_tax: { enabled: false }, allow_promotion_codes: false, billing_address_collection: 'auto' } }
    return insertOperation(tx, context, binding, 'create_checkout', input.idempotencyKey, digest, intent)
  }
  /** Convenience API explicitly owns one database transaction. No network provider request inside it. */
  async function requestCheckout(context: TrustedContext, input: unknown) { return database().transaction(async tx => { await timeouts(tx); return requestCheckoutInTransaction(tx, context, input) }) }
  async function requestPaymentReconciliationInTransaction(tx: StripeTransaction, context: TrustedContext, value: unknown) {
    const input = validate(reconcileInput, value), binding = await owned(context, input.bindingId, input.kind, tx)
    await connection(binding.connectionId, context.signal)
    return insertOperation(tx, context, binding, input.kind === 'checkout' ? 'reconcile_checkout' : 'reconcile_payment', randomUUID(), createHash('sha256').update(binding.id).digest('hex'), null)
  }
  async function requestPaymentReconciliation(context: TrustedContext, input: unknown) { return database().transaction(async tx => { await timeouts(tx); return requestPaymentReconciliationInTransaction(tx, context, input) }) }
  async function getOperation(context: TrustedContext, input: { operationId: string }) {
    await authorize(context)
    const [row] = await database().select().from(operations).where(and(eq(operations.id, validate(uuid, input.operationId)), eq(operations.scopeKind, context.scope.kind), eq(operations.scopeId, context.scope.id))).limit(1)
    if (!row) throw new StripeCapabilityError('not_found')
    return view(row)
  }
  async function getCheckout(context: TrustedContext, input: { bindingId: string }) {
    const binding = await owned(context, input.bindingId, 'checkout')
    const [projection] = await database().select().from(projections).where(eq(projections.bindingId, binding.id)).limit(1)
    if (!projection?.checkout) throw new StripeCapabilityError('not_found')
    const value = projection.checkout
    return { bindingId: binding.id, remoteId: binding.remoteId, status: value.status, paymentStatus: value.paymentStatus, currency: value.currency, amountTotal: value.amountTotal, checkoutUrl: value.status === 'open' ? value.checkoutUrl : null, sourceUpdatedAt: value.sourceUpdatedAt, syncedAt: projection.syncedAt.toISOString() }
  }
  async function listPayments(context: TrustedContext, unknownInput: unknown = {}) {
    await authorize(context)
    const input = validate(listInput, unknownInput), cursor = input.cursor ? decodeCursor(input.cursor) : null
    const rows = await database().select().from(bindings).innerJoin(projections, eq(bindings.id, projections.bindingId)).where(and(visibility(context), isNull(bindings.retiredAt), eq(bindings.resourceKind, 'payment'), cursor ? or(lt(projections.createdAt, cursor.createdAt), and(eq(projections.createdAt, cursor.createdAt), lt(bindings.id, cursor.id))) : undefined)).orderBy(desc(projections.createdAt), desc(bindings.id)).limit(input.limit + 1)
    const items = []
    for (const row of rows.slice(0, input.limit)) {
      await authorize(context, row.stripe_binding)
      const p = row.stripe_projection.payment
      if (p) items.push({ bindingId: row.stripe_binding.id, remoteId: row.stripe_binding.remoteId, status: p.status, currency: p.currency, amount: p.amount, amountReceived: p.amountReceived, sourceUpdatedAt: p.sourceUpdatedAt, syncedAt: row.stripe_projection.syncedAt.toISOString() })
    }
    const last = rows[input.limit - 1]
    return { items, nextCursor: rows.length > input.limit && last ? encodeCursor(last.stripe_projection.createdAt, last.stripe_binding.id) : null }
  }
  /** Signature verified before receipt transaction. No raw body, metadata or provider response is retained. */
  async function receiveInTransaction(tx: StripeTransaction, configured: StripeConnection, hint: Awaited<ReturnType<typeof verifyStripeWebhook>>) {
    let binding: StripeBinding | undefined
    if (hint.kind && hint.remoteId) [binding] = await tx.select().from(bindings).where(and(eq(bindings.connectionId, configured.id), eq(bindings.resourceKind, hint.kind), eq(bindings.remoteId, hint.remoteId), isNull(bindings.retiredAt))).limit(1)
    const [row] = await tx.insert(inbox).values({ id: randomUUID(), connectionId: configured.id, accountId: configured.accountId, mode: configured.mode, eventId: hint.eventId, bodySha256: hint.digest, eventType: hint.eventType, bindingId: binding?.id ?? null, remoteHint: binding ? hint.remoteId : null, status: binding ? 'received' : 'ignored' }).onConflictDoNothing().returning()
    if (row && binding) await enqueue(tx, 'receipt', row.id)
    return { accepted: true as const }
  }
  /** Owns receipt transaction; the route must include raw read/verification in its five-second budget. */
  async function receive(id: string, raw: Uint8Array, signature: string, signal?: AbortSignal) {
    const budget = deadline(5000, signal)
    try {
      const configured = await connection(id, budget.signal)
      const hint = await verifyStripeWebhook(raw, signature, configured)
      budget.check()
      const result = await database().transaction(async tx => { await timeouts(tx); budget.check(); const accepted = await receiveInTransaction(tx, configured, hint); budget.check(); return accepted })
      budget.check(); return result
    }
    finally { budget.close() }
  }
  async function cancelOperation(context: TrustedContext, input: { operationId: string }) {
    await getOperation(context, input)
    await database().update(operations).set({ status: 'cancelled', errorCode: 'cancelled', updatedAt: new Date(), revision: sql`${operations.revision} + 1` }).where(and(eq(operations.id, input.operationId), eq(operations.status, 'queued')))
    return getOperation(context, input)
  }
  async function leaseBinding(tx: StripeTransaction, binding: StripeBinding, token: string) {
    const [claimed] = await tx.update(bindings).set({ leaseToken: token, leaseUntil: new Date(Date.now() + leaseMs), revision: sql`${bindings.revision} + 1` }).where(and(eq(bindings.id, binding.id), isNull(bindings.retiredAt), or(isNull(bindings.leaseUntil), lt(bindings.leaseUntil, new Date())))).returning()
    if (!claimed) throw new StripeCapabilityError('unavailable')
    return claimed
  }
  async function persist(tx: StripeTransaction, binding: StripeBinding, token: string, session?: Stripe.Checkout.Session, payment?: Stripe.PaymentIntent) {
    const [active] = await tx.select().from(bindings).where(and(eq(bindings.id, binding.id), eq(bindings.leaseToken, token), isNull(bindings.retiredAt))).for('update')
    if (!active) throw new StripeCapabilityError('conflict')
    const values = { bindingId: binding.id, syncedAt: new Date(), ...(session ? { checkout: checkoutProjection(session) } : { payment: paymentProjection(payment!) }) }
    await tx.insert(projections).values(values).onConflictDoUpdate({ target: projections.bindingId, set: values })
    await tx.update(bindings).set({ leaseToken: null, leaseUntil: null }).where(and(eq(bindings.id, binding.id), eq(bindings.leaseToken, token)))
  }
  async function retrieve(configured: StripeConnection, binding: StripeBinding, signal: AbortSignal) {
    const result = binding.resourceKind === 'checkout' ? { session: await stripeOperation(configured, client => client.checkout.sessions.retrieve(binding.remoteId), { signal, environment: options.env?.NODE_ENV }) } : { payment: await stripeOperation(configured, client => client.paymentIntents.retrieve(binding.remoteId), { signal, environment: options.env?.NODE_ENV }) }
    const resource = result.session ?? result.payment!
    if (resource.id !== binding.remoteId || resource.livemode !== (configured.mode === 'live')) throw new StripeCapabilityError('unsupported')
    return result
  }
  async function checkoutPayment(configured: StripeConnection, session: Stripe.Checkout.Session, signal: AbortSignal) {
    if (!session.payment_intent) return undefined
    const id = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent.id
    validate(opaque, id)
    const payment = await stripeOperation(configured, client => client.paymentIntents.retrieve(id), { signal, environment: options.env?.NODE_ENV })
    if (payment.id !== id || payment.livemode !== (configured.mode === 'live')) throw new StripeCapabilityError('unsupported')
    return payment
  }
  async function persistChildPayment(tx: StripeTransaction, parent: StripeBinding, payment: Stripe.PaymentIntent) {
    const [existing] = await tx.select().from(bindings).where(and(eq(bindings.connectionId, parent.connectionId), eq(bindings.resourceKind, 'payment'), eq(bindings.remoteId, payment.id))).limit(1)
    if (existing && (existing.scopeKind !== parent.scopeKind || existing.scopeId !== parent.scopeId || existing.retiredAt)) throw new StripeCapabilityError('conflict')
    const child = existing ?? (await tx.insert(bindings).values({ id: randomUUID(), scopeKind: parent.scopeKind, scopeId: parent.scopeId, localResourceId: parent.localResourceId, connectionId: parent.connectionId, resourceKind: 'payment', remoteId: payment.id }).returning())[0]!
    // Do not overwrite another in-flight reconciliation; a later explicit GET repairs it.
    if (child.leaseUntil && child.leaseUntil > new Date()) throw new StripeCapabilityError('unavailable')
    const values = { bindingId: child.id, payment: paymentProjection(payment), syncedAt: new Date() }
    await tx.insert(projections).values(values).onConflictDoUpdate({ target: projections.bindingId, set: values })
  }
  async function runOperation(id: string, job: JobContext) {
    const budget = deadline(45000, job.signal), token = randomUUID()
    let attempt: StripeOperation | undefined, pending: StripeOperation | undefined, binding: StripeBinding | undefined
    try {
      await database().transaction(async tx => {
        await timeouts(tx)
        const [row] = await tx.select().from(operations).where(eq(operations.id, id)).for('update')
        if (!row || row.status !== 'queued') return
        pending = row
        const context = { ...contextFor(row), signal: budget.signal }
        binding = await owned(context, row.bindingId, row.kind === 'create_checkout' ? 'customer' : row.kind === 'reconcile_checkout' ? 'checkout' : 'payment', tx)
        if (row.kind === 'create_checkout' && row.firstDispatchAt && Date.now() >= row.firstDispatchAt.getTime() + replayMs) { await tx.update(operations).set({ status: 'reconciliation_required', errorCode: 'conflict', updatedAt: new Date() }).where(eq(operations.id, id)); return }
        await leaseBinding(tx, binding, token)
        ;[attempt] = await tx.update(operations).set({ status: 'dispatching', leaseToken: token, leaseUntil: new Date(Date.now() + leaseMs), firstDispatchAt: row.firstDispatchAt ?? new Date(), updatedAt: new Date(), revision: sql`${operations.revision} + 1` }).where(eq(operations.id, id)).returning()
      })
      if (!attempt || !binding) return { status: 'ignored' as const }
      budget.check()
      const configured = await connection(attempt.connectionId, budget.signal), context = { ...contextFor(attempt), signal: budget.signal }
      await owned(context, binding.id, binding.resourceKind)
      let session: Stripe.Checkout.Session | undefined, payment: Stripe.PaymentIntent | undefined
      if (attempt.kind === 'create_checkout') {
        if (!attempt.intent || configured.accountId !== attempt.intent.accountId || configured.mode !== attempt.intent.mode) throw new StripeCapabilityError('conflict')
        session = await stripeOperation(configured, client => client.checkout.sessions.create(attempt!.intent!.parameters, { idempotencyKey: `gs-stripe:${attempt!.id}` }), { signal: budget.signal, environment: options.env?.NODE_ENV })
      }
      else ({ session, payment } = await retrieve(configured, binding, budget.signal))
      if (session && (session.livemode !== (configured.mode === 'live') || (attempt.kind === 'create_checkout' && session.customer !== binding.remoteId))) throw new StripeCapabilityError('unsupported')
      if (session) payment = await checkoutPayment(configured, session, budget.signal)
      budget.check()
      await database().transaction(async tx => {
        await timeouts(tx); budget.check()
        const [current] = await tx.select().from(operations).where(and(eq(operations.id, id), eq(operations.leaseToken, token), eq(operations.status, 'dispatching'))).for('update')
        if (!current) throw new StripeCapabilityError('conflict')
        await owned(context, binding!.id, binding!.resourceKind, tx)
        let target = binding!
        if (attempt!.kind === 'create_checkout') {
          checkoutProjection(session!)
          target = (await tx.insert(bindings).values({ id: randomUUID(), scopeKind: binding!.scopeKind, scopeId: binding!.scopeId, localResourceId: id, connectionId: binding!.connectionId, resourceKind: 'checkout', remoteId: session!.id, leaseToken: token, leaseUntil: new Date(Date.now() + leaseMs) }).returning())[0]!
          await tx.update(bindings).set({ leaseToken: null, leaseUntil: null }).where(and(eq(bindings.id, binding!.id), eq(bindings.leaseToken, token)))
        }
        await persist(tx, target, token, session, session ? undefined : payment)
        if (session && payment) await persistChildPayment(tx, target, payment)
        await tx.update(operations).set({ status: 'succeeded', resultBindingId: target.id, leaseToken: null, leaseUntil: null, errorCode: null, updatedAt: new Date() }).where(and(eq(operations.id, id), eq(operations.leaseToken, token)))
        budget.check()
      })
      return { status: 'processed' as const }
    }
    catch (error) {
      const safe = safeError(error), write = attempt?.kind === 'create_checkout'
      // Stripe's cached errors and ambiguous acceptance never trigger an automatic fresh create.
      const definitive = error instanceof Error && 'statusCode' in error && typeof error.statusCode === 'number' && error.statusCode >= 400 && error.statusCode < 500 && error.statusCode !== 429
      const retry = !write && ['unavailable', 'deadline_exceeded'].includes(safe.code) && job.retryCount < (job.retryLimit ?? 5)
      if (!attempt && pending && !retry) await database().update(operations).set({ status: 'failed', errorCode: safe.code, updatedAt: new Date() }).where(and(eq(operations.id, id), eq(operations.status, 'queued')))
      if (attempt) await database().transaction(async tx => {
        await timeouts(tx)
        await tx.update(operations).set({ status: write ? definitive ? 'failed' : 'reconciliation_required' : retry ? 'queued' : 'failed', errorCode: definitive ? 'invalid_input' : safe.code, leaseToken: null, leaseUntil: null, updatedAt: new Date() }).where(and(eq(operations.id, id), eq(operations.leaseToken, token)))
        if (binding) await tx.update(bindings).set({ leaseToken: null, leaseUntil: null }).where(and(eq(bindings.id, binding.id), eq(bindings.leaseToken, token)))
      })
      if (retry) throw new StripeCapabilityError('unavailable')
      return { status: write && !definitive ? 'reconciliation_required' as const : 'ignored' as const }
    }
    finally { budget.close() }
  }
  async function runReceipt(id: string, job: JobContext) {
    const budget = deadline(45000, job.signal), token = randomUUID()
    let binding: StripeBinding | undefined, claimed = false
    try {
      await database().transaction(async tx => {
        await timeouts(tx)
        const [receipt] = await tx.select().from(inbox).where(eq(inbox.id, id)).for('update')
        if (!receipt || !['received', 'failed'].includes(receipt.status) || !receipt.bindingId) return
        ;[binding] = await tx.select().from(bindings).where(and(eq(bindings.id, receipt.bindingId), eq(bindings.connectionId, receipt.connectionId), isNull(bindings.retiredAt))).limit(1)
        if (!binding || !options.authorizeReconciliation || !await options.authorizeReconciliation(binding, budget.signal)) { await tx.update(inbox).set({ status: 'ignored', updatedAt: new Date() }).where(eq(inbox.id, id)); return }
        await leaseBinding(tx, binding, token)
        await tx.update(inbox).set({ status: 'processing', leaseToken: token, leaseUntil: new Date(Date.now() + leaseMs), revision: sql`${inbox.revision} + 1`, updatedAt: new Date() }).where(eq(inbox.id, id)); claimed = true
      })
      if (!claimed || !binding) return { status: 'ignored' as const }
      budget.check()
      if (!options.authorizeReconciliation || !await options.authorizeReconciliation(binding, budget.signal)) throw new StripeCapabilityError('forbidden')
      const configured = await connection(binding.connectionId, budget.signal), latest = await retrieve(configured, binding, budget.signal)
      const payment = latest.session ? await checkoutPayment(configured, latest.session, budget.signal) : undefined
      budget.check()
      await database().transaction(async tx => {
        await timeouts(tx); budget.check()
        const [receipt] = await tx.select().from(inbox).where(and(eq(inbox.id, id), eq(inbox.leaseToken, token))).for('update')
        const [current] = await tx.select().from(bindings).where(and(eq(bindings.id, binding!.id), isNull(bindings.retiredAt), eq(bindings.connectionId, configured.id))).limit(1)
        if (!receipt || !current || !options.authorizeReconciliation || !await options.authorizeReconciliation(current, budget.signal)) throw new StripeCapabilityError('forbidden')
        await persist(tx, current, token, latest.session, latest.payment)
        if (payment) await persistChildPayment(tx, current, payment)
        await tx.update(inbox).set({ status: 'processed', leaseToken: null, leaseUntil: null, errorCode: null, updatedAt: new Date() }).where(and(eq(inbox.id, id), eq(inbox.leaseToken, token)))
        budget.check()
      })
      return { status: 'processed' as const }
    }
    catch (error) {
      const safe = safeError(error), retry = ['unavailable', 'deadline_exceeded'].includes(safe.code) && job.retryCount < (job.retryLimit ?? 5)
      if (claimed) await database().transaction(async tx => {
        await timeouts(tx)
        await tx.update(inbox).set({ status: retry ? 'received' : 'failed', errorCode: safe.code, leaseToken: null, leaseUntil: null, updatedAt: new Date() }).where(and(eq(inbox.id, id), eq(inbox.leaseToken, token)))
        if (binding) await tx.update(bindings).set({ leaseToken: null, leaseUntil: null }).where(and(eq(bindings.id, binding.id), eq(bindings.leaseToken, token)))
      })
      if (retry) throw new StripeCapabilityError('unavailable')
      return { status: 'ignored' as const }
    }
    finally { budget.close() }
  }
  /** Explicit trusted application replay, never automatic. Frozen intent/key stay unchanged. */
  async function replayCheckout(context: TrustedContext, input: { operationId: string }) {
    const existing = await getOperation(context, input)
    if (existing.kind !== 'create_checkout' || existing.status !== 'reconciliation_required') throw new StripeCapabilityError('conflict')
    return database().transaction(async tx => {
      await timeouts(tx)
      const [row] = await tx.select().from(operations).where(eq(operations.id, input.operationId)).for('update')
      if (!row || row.status !== 'reconciliation_required' || !row.firstDispatchAt || Date.now() >= row.firstDispatchAt.getTime() + replayMs || !row.intent) throw new StripeCapabilityError('conflict')
      await owned(context, row.bindingId, 'customer', tx)
      const configured = await connection(row.connectionId, context.signal)
      if (configured.accountId !== row.intent.accountId || configured.mode !== row.intent.mode) throw new StripeCapabilityError('conflict')
      await tx.update(operations).set({ status: 'queued', errorCode: null, updatedAt: new Date() }).where(eq(operations.id, row.id))
      await enqueue(tx, 'operation', row.id)
      return { operationId: row.id, status: 'queued' as const }
    })
  }
  /** Explicit trusted repair transaction; repeated repair never produces enqueue storms. */
  async function repairReceiptInTransaction(tx: StripeTransaction, id: string) {
    const [row] = await tx.update(inbox).set({ status: 'received', errorCode: null, updatedAt: new Date() }).where(and(eq(inbox.id, validate(uuid, id)), eq(inbox.status, 'failed'))).returning()
    if (row) await enqueue(tx, 'receipt', row.id)
    return Boolean(row)
  }
  /** Explicit bounded operator recovery. No startup scan or provider I/O. */
  async function recoverExpiredAttempts(limit = 100) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new StripeCapabilityError('invalid_input')
    return database().transaction(async tx => {
      await timeouts(tx)
      const expired = await tx.select().from(operations).where(and(eq(operations.status, 'dispatching'), lt(operations.leaseUntil, new Date()))).limit(limit).for('update', { skipLocked: true })
      for (const row of expired) {
        await tx.update(operations).set({ status: row.kind === 'create_checkout' ? 'reconciliation_required' : 'queued', leaseToken: null, leaseUntil: null, updatedAt: new Date(), revision: sql`${operations.revision} + 1` }).where(eq(operations.id, row.id))
        await tx.update(bindings).set({ leaseToken: null, leaseUntil: null }).where(and(eq(bindings.id, row.bindingId), row.leaseToken ? eq(bindings.leaseToken, row.leaseToken) : undefined))
        if (row.kind !== 'create_checkout') await enqueue(tx, 'operation', row.id)
      }
      const receipts = await tx.select().from(inbox).where(and(eq(inbox.status, 'processing'), lt(inbox.leaseUntil, new Date()))).limit(limit).for('update', { skipLocked: true })
      for (const row of receipts) {
        await tx.update(inbox).set({ status: 'received', leaseToken: null, leaseUntil: null, updatedAt: new Date(), revision: sql`${inbox.revision} + 1` }).where(eq(inbox.id, row.id))
        if (row.bindingId) await tx.update(bindings).set({ leaseToken: null, leaseUntil: null }).where(and(eq(bindings.id, row.bindingId), row.leaseToken ? eq(bindings.leaseToken, row.leaseToken) : undefined))
        await enqueue(tx, 'receipt', row.id)
      }
      return { operations: expired.length, receipts: receipts.length }
    })
  }
  return { runJob, inboxJob, bindInTransaction, requestCheckoutInTransaction, requestCheckout, requestPaymentReconciliationInTransaction, requestPaymentReconciliation, getOperation, getCheckout, listPayments, receiveInTransaction, receive, cancelOperation, replayCheckout, repairReceiptInTransaction, recoverExpiredAttempts }
}
