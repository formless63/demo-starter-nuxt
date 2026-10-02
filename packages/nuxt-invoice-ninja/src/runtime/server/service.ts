import { createHash, randomUUID } from 'node:crypto'
import { and, desc, eq, isNull, lt, or, sql } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import { z } from 'zod'
import { defineJob, sendRegisteredJobInTransaction } from '@repo/nuxt-jobs/server'
import type { createJobsBoss, JobContext } from '@repo/nuxt-jobs/server'
import { invoiceNinjaBinding as bindings, invoiceNinjaProjection as projections, invoiceNinjaOperation as operations, invoiceNinjaInbox as inbox } from './schema'
import type { Binding, Operation, OperationKind, DraftPolicy, FrozenDraft, InvoiceProjection } from './schema'
import { InvoiceNinjaError, InvoiceNinjaRejection, safeError } from './errors'
import { parse, opaqueId, scopeSchema, uuid, connectionId, bindingRef, operationRef, draftInput, clientReconcileInput, invoiceReconcileInput, listInput, decodeCursor } from './validation'
import type { TrustedContext, DraftInput } from './validation'
import { awaitWithSignal, checkSignal, operationSignal, providerRequest, resolveEnvironmentConnection, validateConnection, verifyWebhookSecret, readBytes, parseExactJSON } from './transport'
import type { Connection } from './transport'
import { entity, object, projectEntity, serializeProjection } from './projection'
export type InvoiceNinjaDatabase = Pick<PgDatabase<PgQueryResultHKT>, 'select' | 'insert' | 'update' | 'transaction'>
export type InvoiceNinjaTransaction = Parameters<Parameters<InvoiceNinjaDatabase['transaction']>[0]>[0]
type Boss = ReturnType<typeof createJobsBoss>
export interface InvoiceNinjaOptions {
  database(): InvoiceNinjaDatabase
  boss(): Promise<Boss>
  applicationDatabaseUrl?: string
  resolveConnection?(connectionId: string, signal: AbortSignal): Promise<Connection>
  authorizeScope?(actorUserId: string, scope: TrustedContext['scope']): Promise<boolean>
  authorizeBoundResource?(context: TrustedContext, binding: Binding): Promise<boolean>
  /** Callback authority never invents a human actor. Absent policy denies. */
  authorizeReconciliation?(binding: Binding, signal: AbortSignal): Promise<boolean>
  resolveDraftPolicy?(context: TrustedContext, binding: Binding, input: DraftInput, signal: AbortSignal): Promise<DraftPolicy>
  /** Native invoice entity has no currency field. Resolve a vetted current client/company mapping server-side. */
  resolveInvoiceCurrency?(binding: Binding, signal: AbortSignal): Promise<string | null>
  /** Server operator must explicitly verify same company/client and record its decision externally. */
  authorizeDraftResolution?(context: TrustedContext, operation: Operation, decision: DraftResolution): Promise<boolean>
  fetch?: typeof fetch
}
export type DraftResolution = { mode: 'attach-existing', remoteId: string } | { mode: 'confirm-not-created' }
const events = z.enum(['invoice-created', 'invoice-updated', 'invoice-sent', 'invoice-archived', 'invoice-deleted'])
const digest = (s: string | Uint8Array) => createHash('sha256').update(s).digest('hex')
function view(row: Operation) {
  return { id: row.id, kind: row.kind, status: row.status, bindingId: row.resultBindingId ?? row.bindingId,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
    error: row.errorCode ? new InvoiceNinjaError(row.errorCode, row.kind !== 'create_draft' && ['unavailable', 'deadline_exceeded'].includes(row.errorCode)).toJSON() : null }
}
function visibility(scope: TrustedContext['scope']) { return and(eq(bindings.scopeKind, scope.kind), eq(bindings.scopeId, scope.id), isNull(bindings.retiredAt))! }
export function createInvoiceNinjaService(options: InvoiceNinjaOptions) {
  const db = options.database
  async function authorize(context: TrustedContext) {
    parse(opaqueId, context.actorUserId); parse(scopeSchema, context.scope); checkSignal(context.signal)
    if (context.scope.kind === 'user' && context.scope.id !== context.actorUserId) throw new InvoiceNinjaError('forbidden')
    if (!options.authorizeScope || !await awaitWithSignal(context.signal ?? operationSignal(undefined, 15_000), () => options.authorizeScope!(context.actorUserId, context.scope))) throw new InvoiceNinjaError('forbidden')
  }
  async function bound(context: TrustedContext, id: string, kind?: Binding['resourceKind'], database = db()) {
    await authorize(context)
    const [binding] = await database.select().from(bindings).where(and(eq(bindings.id, parse(uuid, id)), visibility(context.scope), kind ? eq(bindings.resourceKind, kind) : undefined)).limit(1)
    if (!binding) throw new InvoiceNinjaError('not_found')
    if (!options.authorizeBoundResource || !await awaitWithSignal(context.signal ?? operationSignal(undefined, 15_000), () => options.authorizeBoundResource!(context, binding))) throw new InvoiceNinjaError('forbidden')
    return binding
  }
  async function connection(id: string, signal: AbortSignal) {
    parse(connectionId, id); checkSignal(signal)
    const c = options.resolveConnection ? await awaitWithSignal(signal, () => options.resolveConnection!(id, signal)) : id === 'default' ? resolveEnvironmentConnection() : undefined
    if (!c) throw new InvoiceNinjaError('unconfigured')
    validateConnection(c); checkSignal(signal); return c
  }
  async function enqueue(tx: InvoiceNinjaTransaction, name: 'invoice-ninja.operation' | 'invoice-ninja.receipt', payload: { operationId: string } | { inboxId: string }) {
    const registry = { 'invoice-ninja.operation': operationJob, 'invoice-ninja.receipt': receiptJob }
    await sendRegisteredJobInTransaction(await options.boss(), registry, tx as unknown as Parameters<typeof sendRegisteredJobInTransaction>[2], name, payload, options.applicationDatabaseUrl)
  }
  /** Trusted server extension. Caller owns transaction; no commit/retry/network. */
  async function createBindingInTransaction(tx: InvoiceNinjaTransaction, context: TrustedContext, input: { localResourceId: string, connectionId: string, resourceKind: 'client' | 'invoice', remoteId: string }) {
    await authorize(context)
    const clean = parse(z.object({ localResourceId: opaqueId, connectionId, resourceKind: z.enum(['client', 'invoice']), remoteId: opaqueId }).strict(), input)
    const [row] = await tx.insert(bindings).values({ id: randomUUID(), scopeKind: context.scope.kind, scopeId: context.scope.id, ...clean }).returning()
    return row!
  }
  async function retireBindingInTransaction(tx: InvoiceNinjaTransaction, context: TrustedContext, input: unknown) {
    const b = await bound(context, parse(bindingRef, input).bindingId, undefined, tx)
    if (b.leaseUntil && b.leaseUntil > new Date()) throw new InvoiceNinjaError('conflict')
    await tx.update(bindings).set({ retiredAt: new Date(), revision: sql`${bindings.revision} + 1` }).where(and(eq(bindings.id, b.id), eq(bindings.revision, b.revision)))
  }
  async function get(context: TrustedContext, input: unknown, kind: Binding['resourceKind']) {
    const b = await bound(context, parse(bindingRef, input).bindingId, kind)
    const [row] = await db().select({ projection: projections.value }).from(projections).innerJoin(bindings, eq(projections.bindingId, bindings.id)).where(and(eq(bindings.id, b.id), visibility(context.scope), eq(bindings.resourceKind, kind))).limit(1)
    const p = row ? { value: row.projection } : undefined
    if (!p) throw new InvoiceNinjaError('not_found')
    return serializeProjection(p.value)
  }
  async function getOperation(context: TrustedContext, input: unknown) {
    await authorize(context)
    const { operationId } = parse(operationRef, input)
    const [row] = await db().select().from(operations).where(and(eq(operations.id, operationId), eq(operations.scopeKind, context.scope.kind), eq(operations.scopeId, context.scope.id))).limit(1)
    if (!row) throw new InvoiceNinjaError('not_found')
    return view(row)
  }
  async function listInvoices(context: TrustedContext, input: unknown = {}) {
    await authorize(context)
    const { limit, cursor } = parse(listInput, input), after = cursor ? decodeCursor(cursor) : null
    const rows = await db().select({ binding: bindings, projection: projections.value }).from(bindings).innerJoin(projections, eq(bindings.id, projections.bindingId))
      .where(and(visibility(context.scope), eq(bindings.resourceKind, 'invoice'), after ? or(lt(bindings.createdAt, after.createdAt), and(eq(bindings.createdAt, after.createdAt), lt(bindings.id, after.id))) : undefined))
      .orderBy(desc(bindings.createdAt), desc(bindings.id)).limit(limit + 1)
    const page = rows.slice(0, limit), items = []
    for (const row of page) {
      if (!options.authorizeBoundResource || !await options.authorizeBoundResource(context, row.binding)) throw new InvoiceNinjaError('forbidden')
      items.push(serializeProjection(row.projection))
    }
    const last = page.at(-1)
    return { items, nextCursor: rows.length > limit && last ? Buffer.from(JSON.stringify([1, last.binding.createdAt.toISOString(), last.binding.id])).toString('base64url') : null }
  }
  async function insertOperation(tx: InvoiceNinjaTransaction, context: TrustedContext, binding: Binding, kind: OperationKind, callerKey: string, inputDigest: string, intent: FrozenDraft | null) {
    const [row] = await tx.insert(operations).values({ id: randomUUID(), scopeKind: context.scope.kind, scopeId: context.scope.id, actorUserId: context.actorUserId,
      connectionId: binding.connectionId, kind, callerKey, digest: inputDigest, bindingId: binding.id, intent }).onConflictDoNothing().returning()
    if (!row) {
      const [prior] = await tx.select().from(operations).where(and(eq(operations.scopeKind, context.scope.kind), eq(operations.scopeId, context.scope.id), eq(operations.connectionId, binding.connectionId), eq(operations.kind, kind), eq(operations.callerKey, callerKey))).limit(1)
      if (!prior || prior.digest !== inputDigest) throw new InvoiceNinjaError('conflict')
      return view(prior)
    }
    await enqueue(tx, 'invoice-ninja.operation', { operationId: row.id })
    return { operationId: row.id, status: 'queued' as const }
  }
  async function reconcile(context: TrustedContext, input: unknown, kind: 'client' | 'invoice') {
    const id = kind === 'client' ? parse(clientReconcileInput, input).clientBindingId : parse(invoiceReconcileInput, input).invoiceBindingId
    const b = await bound(context, id, kind)
    await connection(b.connectionId, operationSignal(context.signal, 15_000))
    return db().transaction(async tx => { const current = await bound(context, id, kind, tx); return insertOperation(tx, context, current, kind === 'client' ? 'reconcile_client' : 'reconcile_invoice', randomUUID(), digest(id), null) })
  }
  /** Convenience API owns exactly one short transaction. No provider I/O inside it. */
  async function requestDraftInvoice(context: TrustedContext, value: unknown) {
    const input = parse(draftInput, value), b = await bound(context, input.clientBindingId, 'client'), inputDigest = digest(JSON.stringify(input))
    const signal = operationSignal(context.signal, 15_000)
    await connection(b.connectionId, signal)
    // Resolve duplicates before consulting mutable policy; original immutable intent stays private.
    const [prior] = await db().select().from(operations).where(and(eq(operations.scopeKind, context.scope.kind), eq(operations.scopeId, context.scope.id), eq(operations.connectionId, b.connectionId), eq(operations.kind, 'create_draft'), eq(operations.callerKey, input.idempotencyKey))).limit(1)
    if (prior) { if (prior.digest !== inputDigest) throw new InvoiceNinjaError('conflict'); return view(prior) }
    if (!options.resolveDraftPolicy) throw new InvoiceNinjaError('unsupported', false)
    const policy = await awaitWithSignal(signal, () => options.resolveDraftPolicy!(context, b, input, signal))
    validatePolicy(policy); checkSignal(signal)
    return db().transaction(async tx => { const current = await bound(context, b.id, 'client', tx); return insertOperation(tx, context, current, 'create_draft', input.idempotencyKey, inputDigest, { input, policy, remoteClientId: b.remoteId }) })
  }
  function validatePolicy(policy: DraftPolicy) {
    if (!policy || policy.numericStringEncodingVerified !== true || policy.unsentZeroTaxDiscountVerified !== true || !/^[A-Z]{3}$/.test(policy.currency)) throw new InvoiceNinjaError('unsupported', false)
    parse(opaqueId, policy.currencyId); parse(opaqueId, policy.configurationIdentity)
  }
  async function cancelOperation(context: TrustedContext, input: unknown) {
    await authorize(context)
    const id = parse(operationRef, input).operationId
    await db().update(operations).set({ status: 'cancelled', errorCode: 'cancelled', updatedAt: new Date(), revision: sql`${operations.revision} + 1` })
      .where(and(eq(operations.id, id), eq(operations.scopeKind, context.scope.kind), eq(operations.scopeId, context.scope.id), eq(operations.status, 'queued')))
    return getOperation(context, { operationId: id })
  }
  /** Exact raw native entity callback. Convenience API owns receipt+enqueue transaction. */
  async function receiveWebhook(id: string, eventKind: string, header: string | undefined, body: ReadableStream<Uint8Array> | null, callerSignal?: AbortSignal) {
    const started = Date.now(), signal = operationSignal(callerSignal, 5000)
    const c = await connection(id, signal)
    verifyWebhookSecret(header, c)
    const bytes = await readBytes(body, 1024 * 1024, signal)
    let data: Record<string, unknown>
    try { data = object(parseExactJSON(bytes)) } catch { throw new InvoiceNinjaError('invalid_input') }
    const event = events.safeParse(eventKind), hint = opaqueId.safeParse(data.id)
    if (event.success && !hint.success) throw new InvoiceNinjaError('invalid_input')
    const hash = digest(bytes)
    try {
      return await db().transaction(async tx => {
        checkSignal(signal)
        await tx.execute(sql`SELECT set_config('statement_timeout', ${`${Math.max(1, 5000 - (Date.now() - started))}ms`}, true), set_config('lock_timeout', ${`${Math.max(1, 5000 - (Date.now() - started))}ms`}, true)`)
        const [b] = hint.success && event.success ? await tx.select().from(bindings).where(and(eq(bindings.connectionId, id), eq(bindings.resourceKind, 'invoice'), eq(bindings.remoteId, hint.data), isNull(bindings.retiredAt))).limit(1) : []
        const [row] = await tx.insert(inbox).values({ id: randomUUID(), connectionId: id, eventKind: event.success ? event.data : 'unsupported', bodySHA256: hash,
          remoteHint: hint.success && event.success ? hint.data : null, bindingId: b?.id ?? null, status: b ? 'received' : 'ignored' }).onConflictDoNothing().returning()
        if (row && b) await enqueue(tx, 'invoice-ninja.receipt', { inboxId: row.id })
        checkSignal(signal); return { accepted: true as const }
      })
    }
    catch (error) { checkSignal(signal); throw safeError(error) }
  }
  async function claimBinding(tx: InvoiceNinjaTransaction, id: string, token: string) {
    const [b] = await tx.update(bindings).set({ leaseToken: token, leaseUntil: new Date(Date.now() + 45_000), revision: sql`${bindings.revision} + 1` })
      .where(and(eq(bindings.id, id), isNull(bindings.retiredAt), or(isNull(bindings.leaseUntil), lt(bindings.leaseUntil, new Date())))).returning()
    if (!b) throw new InvoiceNinjaError('unavailable')
    return b
  }
  async function releaseBinding(tx: InvoiceNinjaTransaction, b: Binding, token: string) {
    await tx.update(bindings).set({ leaseToken: null, leaseUntil: null }).where(and(eq(bindings.id, b.id), eq(bindings.leaseToken, token), eq(bindings.revision, b.revision)))
  }
  async function currentBinding(tx: InvoiceNinjaTransaction, b: Binding, token: string) {
    const [row] = await tx.select().from(bindings).where(and(eq(bindings.id, b.id), eq(bindings.leaseToken, token), eq(bindings.revision, b.revision), isNull(bindings.retiredAt), sql`${bindings.leaseUntil} > CURRENT_TIMESTAMP`)).limit(1)
    if (!row) throw new InvoiceNinjaError('conflict')
    return row
  }
  async function commitProjection(tx: InvoiceNinjaTransaction, b: Binding, value: ReturnType<typeof projectEntity>) {
    await tx.insert(projections).values({ bindingId: b.id, value, syncedAt: new Date(value.syncedAt) }).onConflictDoUpdate({ target: projections.bindingId, set: { value, syncedAt: new Date(value.syncedAt) } })
  }
  async function fetchProjection(b: Binding, signal: AbortSignal) {
    const value = await providerRequest(await connection(b.connectionId, signal), b.resourceKind, b.remoteId, undefined, signal, options.fetch)
    if (value === null) {
      if (b.resourceKind !== 'invoice') throw new InvoiceNinjaError('not_found')
      const [prior] = await db().select().from(projections).where(eq(projections.bindingId, b.id)).limit(1)
      const previous = prior?.value as InvoiceProjection | undefined
      return { bindingId: b.id, remoteId: b.remoteId, number: previous?.number ?? null, status: 'deleted' as const, currency: previous?.currency ?? null,
        amount: previous?.amount ?? null, balance: previous?.balance ?? null, sourceUpdatedAt: previous?.sourceUpdatedAt ?? null, syncedAt: new Date().toISOString(), deleted: true }
    }
    const currency = b.resourceKind === 'invoice' ? (options.resolveInvoiceCurrency ? await awaitWithSignal(signal, () => options.resolveInvoiceCurrency!(b, signal)) : null) : null
    return projectEntity(b, value, currency)
  }
  async function runOperation(id: string, job: JobContext) {
    const signal = operationSignal(job.signal, 45_000), token = randomUUID()
    let row: Operation | undefined, b: Binding | undefined, initialRevision: number | undefined, dispatched = false
    try {
      const [initial] = await db().select().from(operations).where(eq(operations.id, id)).limit(1)
      if (!initial || initial.status !== 'queued') return { status: 'ignored' as const }
      initialRevision = initial.revision
      const context: TrustedContext = { actorUserId: initial.actorUserId, scope: { kind: initial.scopeKind, id: initial.scopeId }, signal }
      await bound(context, initial.bindingId)
      const c = await connection(initial.connectionId, signal)
      if (initial.kind === 'create_draft') {
        if (!initial.intent || !options.resolveDraftPolicy) throw new InvoiceNinjaError('unsupported', false)
        const current = await awaitWithSignal(signal, async () => options.resolveDraftPolicy!(context, await bound(context, initial.bindingId, 'client'), initial.intent!.input, signal))
        validatePolicy(current)
        if (current.currencyId !== initial.intent.policy.currencyId || current.currency !== initial.intent.policy.currency || current.configurationIdentity !== initial.intent.policy.configurationIdentity) throw new InvoiceNinjaError('unsupported', false)
      }
      await db().transaction(async tx => {
        checkSignal(signal)
        const [claimed] = await tx.update(operations).set({ status: 'dispatching', attemptToken: token, firstDispatchAt: sql`COALESCE(${operations.firstDispatchAt}, CURRENT_TIMESTAMP)`, leaseUntil: new Date(Date.now() + 45_000), updatedAt: new Date(), revision: sql`${operations.revision} + 1` })
          .where(and(eq(operations.id, id), eq(operations.status, 'queued'), eq(operations.revision, initial.revision))).returning()
        if (!claimed) return
        b = await claimBinding(tx, initial.bindingId, token); row = claimed
      })
      if (!row || !b) return { status: 'ignored' as const }
      await bound(context, b.id); checkSignal(signal)
      let target = b, projection: ReturnType<typeof projectEntity>
      if (row.kind === 'create_draft') {
        const intent = row.intent!, input = intent.input
        const body = { client_id: intent.remoteClientId, currency_id: intent.policy.currencyId, date: input.invoiceDate, ...(input.dueDate ? { due_date: input.dueDate } : {}),
          ...(input.numbering.mode === 'explicit' ? { number: input.numbering.number } : {}),
          line_items: input.lines.map(line => ({ notes: line.description, quantity: line.quantity, cost: line.unitCost })) }
        dispatched = true
        const response = await providerRequest(c, 'invoice', null, body, signal, options.fetch)
        const remoteId = parse(opaqueId, entity(response).id)
        await db().update(operations).set({ knownRemoteId: remoteId }).where(and(eq(operations.id, row.id), eq(operations.attemptToken, token), eq(operations.status, 'dispatching')))
        if (entity(response).client_id !== intent.remoteClientId || entity(response).status_id !== '1' || entity(response).auto_bill_enabled === true) throw new InvoiceNinjaError('unsupported', false)
        target = { ...b, id: randomUUID(), localResourceId: row.id, resourceKind: 'invoice', remoteId, leaseToken: null, leaseUntil: null, revision: 0, createdAt: new Date() }
        projection = projectEntity(target, response, intent.policy.currency)
      }
      else projection = await fetchProjection(b, signal)
      checkSignal(signal)
      await db().transaction(async tx => {
        const current = await currentBinding(tx, b!, token)
        await bound(context, current.id, undefined, tx); checkSignal(signal)
        const [active] = await tx.select().from(operations).where(and(eq(operations.id, row!.id), eq(operations.attemptToken, token), eq(operations.status, 'dispatching'), eq(operations.revision, row!.revision))).limit(1)
        if (!active) throw new InvoiceNinjaError('conflict')
        if (target.id !== current.id) await tx.insert(bindings).values(target)
        await commitProjection(tx, target, projection)
        await tx.update(operations).set({ status: 'succeeded', resultBindingId: target.id, errorCode: 'currency' in projection && projection.currency === null ? 'unsupported' : null, attemptToken: null, leaseUntil: null, updatedAt: new Date(), revision: sql`${operations.revision} + 1` }).where(and(eq(operations.id, row!.id), eq(operations.attemptToken, token), eq(operations.revision, row!.revision)))
        await releaseBinding(tx, current, token)
      })
      return { status: 'processed' as const }
    }
    catch (error) {
      const ambiguous = row?.kind === 'create_draft' && !(error instanceof InvoiceNinjaRejection)
      const safe = safeError(error, dispatched || ambiguous), retry = !dispatched && !ambiguous && safe.retryable && job.retryCount < (job.retryLimit ?? 5)
      if (row) await db().transaction(async tx => {
        await tx.update(operations).set({ status: ambiguous ? 'reconciliation_required' : retry ? 'queued' : 'failed', errorCode: safe.code,
          attemptToken: null, leaseUntil: null, updatedAt: new Date(), revision: sql`${operations.revision} + 1` }).where(and(eq(operations.id, id), eq(operations.attemptToken, token), eq(operations.revision, row!.revision)))
        if (b) await releaseBinding(tx, b, token)
      })
      else if (initialRevision !== undefined) await db().update(operations).set({ status: retry ? 'queued' : 'failed', errorCode: safe.code, updatedAt: new Date() }).where(and(eq(operations.id, id), eq(operations.status, 'queued'), eq(operations.revision, initialRevision)))
      if (retry) throw new InvoiceNinjaError(safe.code)
      return { status: ambiguous ? 'reconciliation_required' as const : 'ignored' as const, errorCode: safe.code }
    }
  }
  async function runReceipt(id: string, job: JobContext) {
    const signal = operationSignal(job.signal, 45_000), token = randomUUID()
    let b: Binding | undefined, revision: number | undefined, initialRevision: number | undefined
    try {
      const [initial] = await db().select().from(inbox).where(eq(inbox.id, id)).limit(1)
      if (!initial?.bindingId || !['received', 'failed'].includes(initial.status)) return { status: 'ignored' as const }
      initialRevision = initial.revision
      const [candidate] = await db().select().from(bindings).where(and(eq(bindings.id, initial.bindingId), eq(bindings.connectionId, initial.connectionId), eq(bindings.resourceKind, 'invoice'), eq(bindings.remoteId, initial.remoteHint!), isNull(bindings.retiredAt))).limit(1)
      if (!candidate || !options.authorizeReconciliation || !await awaitWithSignal(signal, () => options.authorizeReconciliation!(candidate, signal))) {
        await db().update(inbox).set({ status: 'ignored', updatedAt: new Date(), revision: sql`${inbox.revision} + 1` }).where(and(eq(inbox.id, id), eq(inbox.revision, initial.revision)))
        return { status: 'ignored' as const }
      }
      await db().transaction(async tx => {
        const [claimed] = await tx.update(inbox).set({ status: 'processing', attemptToken: token, leaseUntil: new Date(Date.now() + 45_000), revision: sql`${inbox.revision} + 1`, updatedAt: new Date() }).where(and(eq(inbox.id, id), eq(inbox.revision, initial.revision))).returning()
        if (!claimed) return
        b = await claimBinding(tx, candidate.id, token); revision = claimed.revision
      })
      if (!b) return { status: 'ignored' as const }
      if (!await awaitWithSignal(signal, () => options.authorizeReconciliation!(b!, signal))) throw new InvoiceNinjaError('forbidden')
      const projection = await fetchProjection(b, signal)
      await db().transaction(async tx => {
        const current = await currentBinding(tx, b!, token)
        if (!await awaitWithSignal(signal, () => options.authorizeReconciliation!(current, signal))) throw new InvoiceNinjaError('forbidden')
        checkSignal(signal)
        const [active] = await tx.select().from(inbox).where(and(eq(inbox.id, id), eq(inbox.attemptToken, token), eq(inbox.revision, revision!))).limit(1)
        if (!active) throw new InvoiceNinjaError('conflict')
        await commitProjection(tx, current, projection)
        await tx.update(inbox).set({ status: 'processed', attemptToken: null, leaseUntil: null, errorCode: null, revision: sql`${inbox.revision} + 1`, updatedAt: new Date() }).where(and(eq(inbox.id, id), eq(inbox.attemptToken, token), eq(inbox.revision, revision!)))
        await releaseBinding(tx, current, token)
      })
      return { status: 'processed' as const }
    }
    catch (error) {
      const safe = safeError(error), retry = safe.retryable && job.retryCount < (job.retryLimit ?? 5)
      await db().transaction(async tx => {
        await tx.update(inbox).set({ status: retry ? 'received' : 'failed', attemptToken: null, leaseUntil: null, errorCode: safe.code, revision: sql`${inbox.revision} + 1`, updatedAt: new Date() }).where(and(eq(inbox.id, id), eq(inbox.revision, revision ?? initialRevision ?? -1), revision === undefined ? or(eq(inbox.status, 'received'), eq(inbox.status, 'failed')) : eq(inbox.attemptToken, token)))
        if (b) await releaseBinding(tx, b, token)
      })
      if (retry) throw safe
      return { status: 'ignored' as const, errorCode: safe.code }
    }
  }
  const send = { retryLimit: 5, retryDelay: 30, retryBackoff: true, retryDelayMax: 900, expireInSeconds: 45, retentionSeconds: 86_400, deleteAfterSeconds: 86_400 }
  const operationJob = defineJob({ name: 'invoice-ninja.operation', payload: z.object({ operationId: uuid }).strict(), send, async handler(payload, context) { try { return await runOperation(payload.operationId, context) } catch (error) { throw safeError(error, true) } } })
  const receiptJob = defineJob({ name: 'invoice-ninja.receipt', payload: z.object({ inboxId: uuid }).strict(), send, async handler(payload, context) { try { return await runReceipt(payload.inboxId, context) } catch (error) { throw safeError(error) } } })
  /** Explicit bounded operator recovery; no startup scan or provider call. */
  async function recoverExpiredAttempts(limit = 25) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new InvoiceNinjaError('invalid_input')
    return db().transaction(async tx => {
      const stale = await tx.select().from(operations).where(and(eq(operations.status, 'dispatching'), lt(operations.leaseUntil, new Date()))).limit(limit)
      for (const row of stale) {
        const [changed] = await tx.update(operations).set({ status: row.kind === 'create_draft' ? 'reconciliation_required' : 'queued', attemptToken: null, leaseUntil: null, errorCode: 'unavailable', updatedAt: new Date(), revision: sql`${operations.revision} + 1` }).where(and(eq(operations.id, row.id), eq(operations.revision, row.revision))).returning()
        if (changed?.status === 'queued') await enqueue(tx, 'invoice-ninja.operation', { operationId: row.id })
      }
      const receipts = await tx.select().from(inbox).where(and(eq(inbox.status, 'processing'), lt(inbox.leaseUntil, new Date()))).limit(limit)
      for (const row of receipts) {
        const [changed] = await tx.update(inbox).set({ status: 'received', attemptToken: null, leaseUntil: null, updatedAt: new Date(), revision: sql`${inbox.revision} + 1` }).where(and(eq(inbox.id, row.id), eq(inbox.revision, row.revision))).returning()
        if (changed) await enqueue(tx, 'invoice-ninja.receipt', { inboxId: row.id })
      }
      return { operations: stale.length, receipts: receipts.length }
    })
  }
  /** Trusted server-only resolution. Never replays POST; no browser route. */
  async function resolveAmbiguousDraft(context: TrustedContext, input: unknown, decision: DraftResolution) {
    await authorize(context)
    const id = parse(operationRef, input).operationId
    const clean = parse(z.discriminatedUnion('mode', [z.object({ mode: z.literal('attach-existing'), remoteId: opaqueId }).strict(), z.object({ mode: z.literal('confirm-not-created') }).strict()]), decision)
    const [row] = await db().select().from(operations).where(and(eq(operations.id, id), eq(operations.scopeKind, context.scope.kind), eq(operations.scopeId, context.scope.id), eq(operations.kind, 'create_draft'), eq(operations.status, 'reconciliation_required'))).limit(1)
    if (!row?.intent) throw new InvoiceNinjaError('not_found')
    if (!options.authorizeDraftResolution || !await options.authorizeDraftResolution(context, row, clean)) throw new InvoiceNinjaError('forbidden')
    const current = await bound(context, row.bindingId, 'client'), signal = operationSignal(context.signal, 15_000)
    let target: Binding | undefined, projection: ReturnType<typeof projectEntity> | undefined
    if (clean.mode === 'attach-existing') {
      const value = await providerRequest(await connection(row.connectionId, signal), 'invoice', clean.remoteId, undefined, signal, options.fetch)
      if (value === null) throw new InvoiceNinjaError('not_found')
      if (entity(value).client_id !== row.intent.remoteClientId) throw new InvoiceNinjaError('forbidden')
      target = { ...current, id: randomUUID(), localResourceId: row.id, remoteId: clean.remoteId, resourceKind: 'invoice', createdAt: new Date(), leaseToken: null, leaseUntil: null, revision: 0 }
      projection = projectEntity(target, value, row.intent.policy.currency)
    }
    await db().transaction(async tx => {
      await bound(context, current.id, 'client', tx); checkSignal(signal)
      if (!await options.authorizeDraftResolution!(context, row, clean)) throw new InvoiceNinjaError('forbidden')
      if (target && projection) { await tx.insert(bindings).values(target); await commitProjection(tx, target, projection) }
      const [changed] = await tx.update(operations).set({ status: target ? 'succeeded' : 'failed', resultBindingId: target?.id ?? null,
        errorCode: target ? null : 'conflict', updatedAt: new Date(), revision: sql`${operations.revision} + 1` }).where(and(eq(operations.id, id), eq(operations.revision, row.revision), eq(operations.status, 'reconciliation_required'))).returning()
      if (!changed) throw new InvoiceNinjaError('conflict')
    })
    return getOperation(context, { operationId: id })
  }
  async function repairFailedReceiptInTransaction(tx: InvoiceNinjaTransaction, id: string) {
    const [changed] = await tx.update(inbox).set({ status: 'received', errorCode: null, updatedAt: new Date(), revision: sql`${inbox.revision} + 1` }).where(and(eq(inbox.id, parse(uuid, id)), eq(inbox.status, 'failed'))).returning()
    if (changed) await enqueue(tx, 'invoice-ninja.receipt', { inboxId: changed.id })
    return Boolean(changed)
  }
  return { resolveAmbiguousDraft, repairFailedReceiptInTransaction, createBindingInTransaction, retireBindingInTransaction, getClient: (c: TrustedContext, v: unknown) => get(c, v, 'client'), getInvoice: (c: TrustedContext, v: unknown) => get(c, v, 'invoice'),
    requestClientReconciliation: (c: TrustedContext, v: unknown) => reconcile(c, v, 'client'), requestInvoiceReconciliation: (c: TrustedContext, v: unknown) => reconcile(c, v, 'invoice'),
    requestDraftInvoice, getOperation, listInvoices, cancelOperation, receiveWebhook, recoverExpiredAttempts, operationJob, receiptJob }
}
