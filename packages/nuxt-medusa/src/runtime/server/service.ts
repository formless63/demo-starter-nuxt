import { createHash, randomUUID } from 'node:crypto'
import { and, desc, eq, isNull, lt, or, sql } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import { z } from 'zod'
import { defineJob, sendRegisteredJobInTransaction } from '@repo/nuxt-jobs/server'
import type { createJobsBoss, JobContext } from '@repo/nuxt-jobs/server'
import { MedusaError, safeError } from './errors'
import { medusaBinding, medusaProjection, medusaOperation, medusaInbox } from './schema'
import type { Binding, Operation, Inbox, ResourceKind } from './schema'
import { context, parse, uuid, connectionId, opaqueId, kind, scopeSchema, bindingRef, operationRef, listInput, reconcileInput, syncInput, localCursor, pageCursor, encodeCursor } from './validation'
import type { TrustedContext } from './validation'
import { deadline, cancellable } from './io'
import type { Deadline } from './io'
import { environmentConnection, validateConnection, adminGet } from './transport'
import type { Connection } from './transport'
import { bridgeSecrets, readBridge } from './bridge'
import { object, projectResource, publicProjection } from './projections'
import type { Projection } from './projections'

type Database = Pick<PgDatabase<PgQueryResultHKT>, 'select' | 'insert' | 'update' | 'transaction'>
export type MedusaTransaction = Parameters<Parameters<Database['transaction']>[0]>[0]
export interface MedusaOptions {
  database(): Database
  boss(): Promise<ReturnType<typeof createJobsBoss>>
  env?: NodeJS.ProcessEnv
  fetch?: typeof fetch
  /** All application policies are trusted server-only functions and deny when absent. */
  authorizeScope?(actorUserId: string, scope: TrustedContext['scope']): Promise<boolean>
  authorizeBoundResource?(ctx: TrustedContext, binding: Binding): Promise<boolean>
  authorizeMedusaResource?(ctx: TrustedContext, binding: Pick<Binding, 'scopeKind' | 'scopeId' | 'localResourceId' | 'connectionId' | 'resourceKind' | 'remoteId'>): Promise<boolean>
  /** Callback seam deliberately has no invented human actor. */
  authorizeReconciliation?(binding: Binding, signal: AbortSignal): Promise<boolean>
  resolveConnection?(id: string, signal?: AbortSignal): Promise<Connection>
  selectConnection?(ctx: TrustedContext): Promise<string>
  registeredConnection?(id: string): boolean
  resolveBridgeSecrets?(id: string): Promise<readonly string[]>
}
function visibility(ctx: TrustedContext, table: typeof medusaBinding | typeof medusaOperation) {
  return and(eq(table.scopeKind, ctx.scope.kind), eq(table.scopeId, ctx.scope.id))!
}
function operationView(row: Operation) {
  return { id: row.id, kind: row.kind, status: row.status, bindingId: row.bindingId, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), error: row.errorCode ? new MedusaError(row.errorCode).public() : null }
}
const bindingInput = z.object({ scope: scopeSchema, localResourceId: opaqueId, connectionId, resourceKind: kind, remoteId: opaqueId }).strict()
const queue = { retryLimit: 5, retryDelay: 30, retryBackoff: true, retryDelayMax: 900, deleteAfterSeconds: 86400 }
export function createMedusaService(options: MedusaOptions) {
  let enabled = true
  const active = new Set<Promise<unknown>>()
  const controllers = new Set<AbortController>()
  const env = () => options.env ?? process.env
  function available() { if (!enabled) throw new MedusaError('unavailable') }
  async function authorize(ctx: TrustedContext) {
    context(ctx)
    if (!await (ctx.signal ? cancellable(Promise.resolve(options.authorizeScope?.(ctx.actorUserId, ctx.scope)), ctx.signal) : options.authorizeScope?.(ctx.actorUserId, ctx.scope))) throw new MedusaError('forbidden')
  }
  async function boundAuthorization(ctx: TrustedContext | undefined, binding: Binding, signal: AbortSignal) {
    if (binding.retiredAt) throw new MedusaError('not_found')
    if (ctx) {
      await authorize(ctx)
      if (binding.scopeKind !== ctx.scope.kind || binding.scopeId !== ctx.scope.id) throw new MedusaError('not_found')
      if (!await options.authorizeBoundResource?.(ctx, binding) || !await options.authorizeMedusaResource?.(ctx, binding)) throw new MedusaError('forbidden')
    }
    else if (!await cancellable(Promise.resolve(options.authorizeReconciliation?.(binding, signal)), signal)) throw new MedusaError('forbidden')
  }
  async function connection(id: string, signal?: AbortSignal) {
    parse(connectionId, id)
    const selected = options.resolveConnection ? await options.resolveConnection(id, signal) : id === 'default' ? environmentConnection(env()) : undefined
    if (!selected || selected.id !== id) throw new MedusaError('unconfigured')
    return validateConnection(selected, env())
  }
  async function owned(ctx: TrustedContext, id: string, resourceKind?: ResourceKind, db: Pick<Database, 'select'> = options.database()) {
    await authorize(ctx)
    const [binding] = await db.select().from(medusaBinding).where(and(eq(medusaBinding.id, parse(uuid, id)), visibility(ctx, medusaBinding), isNull(medusaBinding.retiredAt), resourceKind ? eq(medusaBinding.resourceKind, resourceKind) : undefined)).limit(1)
    if (!binding) throw new MedusaError('not_found')
    await boundAuthorization(ctx, binding, ctx.signal ?? new AbortController().signal)
    return binding
  }
  async function timeouts(tx: MedusaTransaction, budget: Deadline) {
    budget.check()
    const ms = Math.floor(budget.remaining())
    if (ms < 2) throw new MedusaError('deadline_exceeded')
    await tx.execute(sql`select set_config('transaction_timeout', ${`${ms}ms`}, true), set_config('statement_timeout', ${`${Math.max(1, ms - 1)}ms`}, true), set_config('lock_timeout', ${`${Math.min(1000, ms)}ms`}, true)`)
  }
  /** Only these convenience operations own transactions. Caller helpers never settle them. */
  async function transaction<T>(budget: Deadline, run: (tx: MedusaTransaction) => Promise<T>): Promise<T> {
    budget.check()
    let known: MedusaError | undefined
    try {
      return await options.database().transaction(async (tx) => {
        await timeouts(tx, budget)
        try { const result = await run(tx); budget.check(); return result }
        catch (error) { if (error instanceof MedusaError) known = error; throw error }
      })
    }
    catch (error) { budget.check(); throw known ?? safeError(error) }
  }
  const operationJob = defineJob({ name: 'medusa.operation', payload: z.object({ operationId: uuid }).strict(), queue, send: { expireInSeconds: 45 }, handler: (payload, job) => tracked(() => runOperation(payload.operationId, job)) })
  const inboxJob = defineJob({ name: 'medusa.inbox', payload: z.object({ inboxId: uuid }).strict(), queue, send: { expireInSeconds: 45 }, handler: (payload, job) => tracked(() => runInbox(payload.inboxId, job)) })
  const registry = { [operationJob.name]: operationJob, [inboxJob.name]: inboxJob }
  function tracked<T>(run: () => Promise<T>): Promise<T> {
    available()
    const promise = run(); active.add(promise)
    void promise.finally(() => active.delete(promise)).catch(() => {})
    return promise
  }
  async function enqueue(tx: MedusaTransaction, payload: { operationId: string } | { inboxId: string }) {
    available()
    const boss = await options.boss()
    // Public Jobs same-database guard; no helper opens/retries/commits a caller transaction.
    if ('operationId' in payload) await sendRegisteredJobInTransaction(boss, registry, tx as unknown as Parameters<typeof sendRegisteredJobInTransaction>[2], operationJob.name, payload, env().DATABASE_URL)
    else await sendRegisteredJobInTransaction(boss, registry, tx as unknown as Parameters<typeof sendRegisteredJobInTransaction>[2], inboxJob.name, payload, env().DATABASE_URL)
  }
  /** Server extension only. Existing binding identity is immutable; retire instead of remapping. */
  async function createBindingInTransaction(tx: MedusaTransaction, ctx: TrustedContext, input: z.infer<typeof bindingInput>) {
    available(); const value = parse(bindingInput, input); await authorize(ctx)
    if (value.scope.kind !== ctx.scope.kind || value.scope.id !== ctx.scope.id) throw new MedusaError('forbidden')
    await connection(value.connectionId, ctx.signal)
    const values = { id: randomUUID(), scopeKind: value.scope.kind, scopeId: value.scope.id, localResourceId: value.localResourceId, connectionId: value.connectionId, resourceKind: value.resourceKind, remoteId: value.remoteId }
    if (!await options.authorizeMedusaResource?.(ctx, values)) throw new MedusaError('forbidden')
    const [created] = await tx.insert(medusaBinding).values(values).onConflictDoNothing().returning()
    if (!created) throw new MedusaError('conflict')
    return created
  }
  async function retireBindingInTransaction(tx: MedusaTransaction, ctx: TrustedContext, input: { bindingId: string }) {
    const binding = await owned(ctx, parse(bindingRef, input).bindingId, undefined, tx)
    await tx.update(medusaBinding).set({ retiredAt: new Date(), revision: sql`${medusaBinding.revision} + 1`, attemptToken: null, leaseExpiresAt: null }).where(eq(medusaBinding.id, binding.id))
  }
  async function get(ctx: TrustedContext, input: { bindingId: string }, resourceKind: ResourceKind) {
    available(); const binding = await owned(ctx, parse(bindingRef, input).bindingId, resourceKind)
    const [row] = await options.database().select().from(medusaProjection).where(eq(medusaProjection.bindingId, binding.id)).limit(1)
    if (!row) throw new MedusaError('not_found')
    return publicProjection(resourceKind, row.data)
  }
  async function list(ctx: TrustedContext, input: z.infer<typeof listInput>, resourceKind: ResourceKind) {
    available(); await authorize(ctx); const query = parse(listInput, input), cursor = query.cursor === undefined ? undefined : localCursor(query.cursor), limit = query.limit ?? 25
    const rows = await options.database().select({ binding: medusaBinding, projection: medusaProjection }).from(medusaBinding).innerJoin(medusaProjection, eq(medusaProjection.bindingId, medusaBinding.id)).where(and(visibility(ctx, medusaBinding), isNull(medusaBinding.retiredAt), eq(medusaBinding.resourceKind, resourceKind), cursor ? or(lt(medusaBinding.createdAt, cursor.createdAt), and(eq(medusaBinding.createdAt, cursor.createdAt), lt(medusaBinding.id, cursor.id))) : undefined)).orderBy(desc(medusaBinding.createdAt), desc(medusaBinding.id)).limit(limit + 1)
    const items: Projection[] = []
    for (const row of rows.slice(0, limit)) { await boundAuthorization(ctx, row.binding, ctx.signal ?? new AbortController().signal); items.push(publicProjection(resourceKind, row.projection.data)) }
    const last = rows.slice(0, limit).at(-1)
    return { items, nextCursor: rows.length > limit && last ? encodeCursor([1, last.binding.createdAt.toISOString(), last.binding.id]) : null }
  }
  async function getOperation(ctx: TrustedContext, input: { operationId: string }) {
    available(); await authorize(ctx)
    const [row] = await options.database().select().from(medusaOperation).where(and(eq(medusaOperation.id, parse(operationRef, input).operationId), visibility(ctx, medusaOperation))).limit(1)
    if (!row) throw new MedusaError('not_found')
    return operationView(row)
  }
  async function getSyncResult(ctx: TrustedContext, input: { operationId: string }) {
    await getOperation(ctx, input)
    const [row] = await options.database().select().from(medusaOperation).where(and(eq(medusaOperation.id, input.operationId), visibility(ctx, medusaOperation))).limit(1)
    if (!row || !row.kind.startsWith('sync_')) throw new MedusaError('not_found')
    return { processed: row.progress, nextCursor: row.nextCursor }
  }
  async function stage(tx: MedusaTransaction, ctx: TrustedContext, binding: Binding | null, intent: Operation['intent'], selectedConnection: string, callerKey = randomUUID()) {
    available(); await authorize(ctx)
    if (!/^[A-Za-z0-9._:-]{1,128}$/.test(callerKey)) throw new MedusaError('invalid_input')
    const operationKind = binding ? `reconcile_${intent.kind}` as const : `sync_${intent.kind}_page` as const
    const digest = createHash('sha256').update(JSON.stringify([1, binding?.id ?? null, selectedConnection, intent])).digest('hex')
    const [created] = await tx.insert(medusaOperation).values({ id: randomUUID(), actorUserId: ctx.actorUserId, scopeKind: ctx.scope.kind, scopeId: ctx.scope.id, connectionId: selectedConnection, kind: operationKind, status: 'queued', bindingId: binding?.id ?? null, callerKey, digest, intent }).onConflictDoNothing().returning()
    if (!created) {
      const [existing] = await tx.select().from(medusaOperation).where(and(visibility(ctx, medusaOperation), eq(medusaOperation.connectionId, selectedConnection), eq(medusaOperation.kind, operationKind), eq(medusaOperation.callerKey, callerKey))).limit(1)
      if (!existing || existing.digest !== digest) throw new MedusaError('conflict')
      return operationView(existing)
    }
    await enqueue(tx, { operationId: created.id })
    return { operationId: created.id, status: 'queued' as const }
  }
  async function requestResourceReconciliationInTransaction(tx: MedusaTransaction, ctx: TrustedContext, input: z.infer<typeof reconcileInput>, callerKey?: string) {
    const value = parse(reconcileInput, input), binding = await owned(ctx, value.bindingId, value.kind, tx)
    await connection(binding.connectionId, ctx.signal)
    return stage(tx, ctx, binding, { kind: value.kind }, binding.connectionId, callerKey)
  }
  async function requestResourceReconciliation(ctx: TrustedContext, input: z.infer<typeof reconcileInput>) {
    const budget = deadline(15000, [ctx.signal])
    try { return await transaction(budget, tx => requestResourceReconciliationInTransaction(tx, ctx, input)) }
    finally { budget.close() }
  }
  async function requestSyncPageInTransaction(tx: MedusaTransaction, ctx: TrustedContext, input: z.infer<typeof syncInput>, callerKey?: string) {
    const value = parse(syncInput, input); await authorize(ctx)
    const selected = parse(connectionId, await options.selectConnection?.(ctx) ?? 'default')
    await connection(selected, ctx.signal)
    return stage(tx, ctx, null, { kind: value.kind, limit: value.limit ?? 25, offset: pageCursor(value.cursor, value.kind, selected) }, selected, callerKey)
  }
  async function requestSyncPage(ctx: TrustedContext, input: z.infer<typeof syncInput>) {
    const budget = deadline(15000, [ctx.signal])
    try { return await transaction(budget, tx => requestSyncPageInTransaction(tx, ctx, input)) }
    finally { budget.close() }
  }
  async function cancelOperation(ctx: TrustedContext, input: { operationId: string }) {
    available(); const value = parse(operationRef, input); await authorize(ctx)
    const budget = deadline(15000, [ctx.signal])
    try { return await transaction(budget, async (tx) => {
      const [row] = await tx.select().from(medusaOperation).where(and(eq(medusaOperation.id, value.operationId), visibility(ctx, medusaOperation))).for('update')
      if (!row) throw new MedusaError('not_found')
      if (row.status !== 'queued') { if (row.status === 'cancelled') return operationView(row); throw new MedusaError('conflict') }
      const [updated] = await tx.update(medusaOperation).set({ status: 'cancelled', errorCode: 'cancelled', updatedAt: new Date(), revision: row.revision + 1 }).where(eq(medusaOperation.id, row.id)).returning()
      return operationView(updated!)
    }) }
    finally { budget.close() }
  }
  async function receiveInTransaction(tx: MedusaTransaction, registered: string, receipt: Awaited<ReturnType<typeof readBridge>>, budget: Deadline) {
    available(); const conn = parse(connectionId, registered)
    if (!(options.registeredConnection?.(conn) ?? conn === 'default')) throw new MedusaError('invalid_input')
    budget.check()
    const event = receipt.event
    const [binding] = receipt.supported ? await tx.select().from(medusaBinding).where(and(eq(medusaBinding.connectionId, conn), eq(medusaBinding.resourceKind, event.resourceKind), eq(medusaBinding.remoteId, event.resourceId), isNull(medusaBinding.retiredAt))).limit(1) : []
    const [row] = await tx.insert(medusaInbox).values({ id: randomUUID(), connectionId: conn, eventId: event.id, bodySha256: receipt.hash, eventType: receipt.supported ? event.type : 'unknown', remoteHint: receipt.supported ? event.resourceId : null, bindingId: binding?.id ?? null, status: binding ? 'received' : 'ignored' }).onConflictDoNothing().returning()
    if (row && binding) await enqueue(tx, { inboxId: row.id })
    else if (!row) {
      // A conflicting authenticated delivery retains the first identity/hint/body digest.
      // Reconcile that original bound resource once; repeated collisions while queued do not storm.
      const [existing] = await tx.select().from(medusaInbox).where(and(eq(medusaInbox.connectionId, conn), eq(medusaInbox.eventId, event.id))).for('update')
      if (existing && existing.bodySha256 !== receipt.hash && existing.bindingId && ['processed', 'failed'].includes(existing.status)) {
        await tx.update(medusaInbox).set({ status: 'received', revision: existing.revision + 1, updatedAt: new Date(), errorCode: null, attemptToken: null, leaseExpiresAt: null }).where(eq(medusaInbox.id, existing.id))
        await enqueue(tx, { inboxId: existing.id })
      }
    }
    budget.check()
    return { accepted: true as const }
  }
  /** Owns one receipt transaction; raw body authentication and SQL share the 5s deadline. */
  async function receive(request: Request, registered: string) {
    available(); const conn = parse(connectionId, registered)
    if (!(options.registeredConnection?.(conn) ?? conn === 'default')) throw new MedusaError('invalid_input')
    const budget = deadline(5000, [request.signal])
    try {
      const secrets = options.resolveBridgeSecrets ? await cancellable(options.resolveBridgeSecrets(conn), budget.signal) : bridgeSecrets(env())
      if (secrets.length < 1 || secrets.length > 2) throw new MedusaError('unconfigured')
      bridgeSecrets({ MEDUSA_BRIDGE_WEBHOOK_SECRET: secrets[0], MEDUSA_BRIDGE_WEBHOOK_SECRET_PREVIOUS: secrets[1] })
      const receipt = await readBridge(request, secrets, budget)
      return await transaction(budget, tx => receiveInTransaction(tx, conn, receipt, budget))
    }
    finally { budget.close() }
  }
  async function claimBinding(bindingId: string, ctx: TrustedContext | undefined, budget: Deadline) {
    const token = randomUUID()
    return transaction(budget, async (tx) => {
      const [binding] = await tx.select().from(medusaBinding).where(and(eq(medusaBinding.id, bindingId), isNull(medusaBinding.retiredAt))).for('update')
      if (!binding) throw new MedusaError('not_found')
      await boundAuthorization(ctx, binding, budget.signal)
      if (binding.leaseExpiresAt && binding.leaseExpiresAt.getTime() > Date.now()) throw new MedusaError('unavailable')
      const [claimed] = await tx.update(medusaBinding).set({ attemptToken: token, revision: binding.revision + 1, leaseExpiresAt: new Date(Date.now() + 45000) }).where(eq(medusaBinding.id, binding.id)).returning()
      return claimed!
    })
  }
  async function synchronize(bindingId: string, ctx: TrustedContext | undefined, budget: Deadline, finish?: (tx: MedusaTransaction) => Promise<void>) {
    const claimed = await claimBinding(bindingId, ctx, budget)
    try {
      const conn = await cancellable(connection(claimed.connectionId, budget.signal), budget.signal)
      budget.check()
      // A discovery page was fetched before this binding's lease. Its snapshot
      // cannot overwrite a newer independently reconciled projection. Read the
      // authoritative resource only after acquiring the per-binding lease.
      const response = await adminGet(conn, claimed.resourceKind, { remoteId: claimed.remoteId }, { signal: budget.signal, env: env(), fetch: options.fetch })
      budget.check()
      await transaction(budget, async (tx) => {
        const [current] = await tx.select().from(medusaBinding).where(eq(medusaBinding.id, bindingId)).for('update')
        if (!current || current.attemptToken !== claimed.attemptToken || current.revision !== claimed.revision || current.leaseExpiresAt!.getTime() <= Date.now()) throw new MedusaError('conflict')
        await boundAuthorization(ctx, current, budget.signal)
        const [previous] = await tx.select().from(medusaProjection).where(eq(medusaProjection.bindingId, bindingId)).limit(1)
        let data: Projection
        if (response === null) {
          // Authenticated 404 only; preserve safe prior values. No callback-body deletion authority.
          if (!previous) throw new MedusaError('not_found')
          data = { ...publicProjection(current.resourceKind, previous.data), status: 'deleted', deleted: true, syncedAt: new Date().toISOString() }
        }
        else data = projectResource(current.resourceKind, current.id, current.remoteId, object(response)[current.resourceKind])
        await tx.insert(medusaProjection).values({ bindingId, data, syncedAt: new Date(data.syncedAt), revision: current.revision }).onConflictDoUpdate({ target: medusaProjection.bindingId, set: { data, syncedAt: new Date(data.syncedAt), revision: current.revision } })
        await finish?.(tx)
        await tx.update(medusaBinding).set({ attemptToken: null, leaseExpiresAt: null }).where(and(eq(medusaBinding.id, bindingId), eq(medusaBinding.attemptToken, claimed.attemptToken!)))
      })
    }
    catch (error) {
      const cleanup = deadline(1000)
      try { await transaction(cleanup, async tx => { await tx.update(medusaBinding).set({ attemptToken: null, leaseExpiresAt: null }).where(and(eq(medusaBinding.id, bindingId), eq(medusaBinding.attemptToken, claimed.attemptToken!))) }) }
      catch { /* Explicit bounded recovery can reclaim the expired read lease. */ }
      finally { cleanup.close() }
      throw error
    }
  }
  function workerBudget(job: JobContext) {
    const controller = new AbortController(); controllers.add(controller)
    const budget = deadline(45000, [job.signal, controller.signal])
    return { budget, close() { budget.close(); controllers.delete(controller) } }
  }
  async function runOperation(id: string, job: JobContext) {
    const attempt = workerBudget(job), { budget } = attempt
    let claimed: Operation | undefined
    try {
      claimed = await transaction(budget, async (tx) => {
        const [row] = await tx.select().from(medusaOperation).where(eq(medusaOperation.id, id)).for('update')
        if (!row || !['queued', 'dispatching'].includes(row.status)) return undefined
        if (row.status === 'dispatching' && row.leaseExpiresAt && row.leaseExpiresAt.getTime() > Date.now()) throw new MedusaError('unavailable')
        const [updated] = await tx.update(medusaOperation).set({ status: 'dispatching', attemptToken: randomUUID(), leaseExpiresAt: new Date(Date.now() + 45000), revision: row.revision + 1, firstDispatchAt: row.firstDispatchAt ?? new Date(), progress: 0, errorCode: null, updatedAt: new Date() }).where(eq(medusaOperation.id, row.id)).returning()
        return updated!
      })
      if (!claimed) return { status: 'ignored' as const }
      const row = claimed, ctx: TrustedContext = { actorUserId: row.actorUserId, scope: { kind: row.scopeKind, id: row.scopeId }, signal: budget.signal }
      await authorize(ctx)
      const fence = and(eq(medusaOperation.id, row.id), eq(medusaOperation.attemptToken, row.attemptToken!), eq(medusaOperation.revision, row.revision))
      const finish = async (tx: MedusaTransaction) => {
        // Lock the ledger before committing projection so recovery cannot race a late worker.
        const [current] = await tx.select().from(medusaOperation).where(fence).for('update')
        if (!current || current.status !== 'dispatching' || !current.leaseExpiresAt || current.leaseExpiresAt.getTime() <= Date.now()) throw new MedusaError('conflict')
        await authorize(ctx)
        await tx.update(medusaOperation).set({ status: 'succeeded', errorCode: null, updatedAt: new Date(), leaseExpiresAt: null, attemptToken: null }).where(fence)
      }
      if (row.bindingId) await synchronize(row.bindingId, ctx, budget, finish)
      else {
        const conn = await connection(row.connectionId, budget.signal), response = object(await adminGet(conn, row.intent.kind, { limit: row.intent.limit!, offset: row.intent.offset! }, { signal: budget.signal, env: env(), fetch: options.fetch }))
        const entries = response[row.intent.kind === 'product' ? 'products' : 'orders']
        if (!Array.isArray(entries) || entries.length > row.intent.limit!) throw new MedusaError('unsupported')
        // Advisory offset pages are not snapshots. Only already-bound authorized IDs are refreshed.
        for (const entry of entries) {
          budget.check(); await authorize(ctx)
          const remoteId = parse(opaqueId, object(entry).id)
          const [binding] = await options.database().select().from(medusaBinding).where(and(visibility(ctx, medusaBinding), eq(medusaBinding.connectionId, row.connectionId), eq(medusaBinding.resourceKind, row.intent.kind), eq(medusaBinding.remoteId, remoteId), isNull(medusaBinding.retiredAt))).limit(1)
          if (!binding) continue
          await synchronize(binding.id, ctx, budget, async (tx) => {
            const [current] = await tx.select().from(medusaOperation).where(fence).for('update')
            if (!current || current.status !== 'dispatching' || current.leaseExpiresAt!.getTime() <= Date.now()) throw new MedusaError('conflict')
            await tx.update(medusaOperation).set({ progress: sql`${medusaOperation.progress} + 1`, updatedAt: new Date() }).where(fence)
          })
        }
        await transaction(budget, async (tx) => {
          await finish(tx)
          const next = row.intent.offset! + entries.length
          if (!Number.isSafeInteger(next)) throw new MedusaError('unsupported')
          const count = typeof response.count === 'string' && /^[0-9]+$/.test(response.count) ? Number(response.count) : undefined
          const nextCursor = entries.length === row.intent.limit! && (count === undefined || next < count) ? encodeCursor([1, row.intent.kind, row.connectionId, next]) : null
          await tx.update(medusaOperation).set({ nextCursor }).where(eq(medusaOperation.id, row.id))
        })
      }
      return { status: 'processed' as const }
    }
    catch (error) {
      const safe = classify(error, budget), retry = safe.retryable && job.retryCount < (job.retryLimit ?? 5)
      if (claimed) {
        const cleanup = deadline(1000)
        try { await transaction(cleanup, async (tx) => {
          await tx.update(medusaOperation).set({ status: retry ? 'queued' : 'failed', errorCode: safe.code, updatedAt: new Date(), attemptToken: null, leaseExpiresAt: null }).where(and(eq(medusaOperation.id, id), eq(medusaOperation.attemptToken, claimed!.attemptToken!), eq(medusaOperation.revision, claimed!.revision)))
        }) }
        finally { cleanup.close() }
      }
      if (retry) throw safe
      return { status: 'ignored' as const, errorCode: safe.code }
    }
    finally { attempt.close() }
  }
  async function runInbox(id: string, job: JobContext) {
    const attempt = workerBudget(job), { budget } = attempt
    let claimed: Inbox | undefined
    try {
      claimed = await transaction(budget, async (tx) => {
        const [row] = await tx.select().from(medusaInbox).where(eq(medusaInbox.id, id)).for('update')
        if (!row || ['processed', 'ignored'].includes(row.status)) return undefined
        if (row.status === 'processing' && row.leaseExpiresAt && row.leaseExpiresAt.getTime() > Date.now()) throw new MedusaError('unavailable')
        const [updated] = await tx.update(medusaInbox).set({ status: 'processing', attemptToken: randomUUID(), revision: row.revision + 1, leaseExpiresAt: new Date(Date.now() + 45000), updatedAt: new Date() }).where(eq(medusaInbox.id, id)).returning()
        return updated!
      })
      if (!claimed?.bindingId) return { status: 'ignored' as const }
      const row = claimed
      await synchronize(row.bindingId!, undefined, budget, async (tx) => {
        const predicate = and(eq(medusaInbox.id, id), eq(medusaInbox.attemptToken, row.attemptToken!), eq(medusaInbox.revision, row.revision))
        const [current] = await tx.select().from(medusaInbox).where(predicate).for('update')
        if (!current || current.status !== 'processing' || current.leaseExpiresAt!.getTime() <= Date.now()) throw new MedusaError('conflict')
        await tx.update(medusaInbox).set({ status: 'processed', errorCode: null, updatedAt: new Date(), attemptToken: null, leaseExpiresAt: null }).where(predicate)
      })
      return { status: 'processed' as const }
    }
    catch (error) {
      const safe = classify(error, budget), retry = safe.retryable && job.retryCount < (job.retryLimit ?? 5)
      if (claimed) {
        const cleanup = deadline(1000)
        try { await transaction(cleanup, async (tx) => {
          await tx.update(medusaInbox).set({ status: retry ? 'received' : 'failed', errorCode: safe.code, updatedAt: new Date(), attemptToken: null, leaseExpiresAt: null }).where(and(eq(medusaInbox.id, id), eq(medusaInbox.attemptToken, claimed!.attemptToken!), eq(medusaInbox.revision, claimed!.revision)))
        }) }
        finally { cleanup.close() }
      }
      if (retry) throw safe
      return { status: 'ignored' as const, errorCode: safe.code }
    }
    finally { attempt.close() }
  }
  function classify(error: unknown, budget: Deadline) {
    try { budget.check() }
    catch (cancel) { return safeError(cancel) }
    return safeError(error)
  }
  /** Explicit operator recovery only; read leases can be retried without remote writes. */
  async function repair(input: { operationIds?: string[], inboxIds?: string[] }) {
    available()
    const value = parse(z.object({ operationIds: z.array(uuid).max(100).optional(), inboxIds: z.array(uuid).max(100).optional() }).strict(), input)
    if ((value.operationIds?.length ?? 0) + (value.inboxIds?.length ?? 0) > 100) throw new MedusaError('invalid_input')
    const budget = deadline(15000)
    try { return await transaction(budget, async (tx) => {
      let repaired = 0
      for (const id of value.operationIds ?? []) {
        const [row] = await tx.select().from(medusaOperation).where(eq(medusaOperation.id, id)).for('update')
        if (!row || !(row.status === 'failed' || (row.status === 'dispatching' && row.leaseExpiresAt && row.leaseExpiresAt.getTime() <= Date.now()))) continue
        await tx.update(medusaOperation).set({ status: 'queued', attemptToken: null, leaseExpiresAt: null, revision: row.revision + 1, progress: 0, updatedAt: new Date() }).where(eq(medusaOperation.id, id))
        await enqueue(tx, { operationId: id }); repaired++
      }
      for (const id of value.inboxIds ?? []) {
        const [row] = await tx.select().from(medusaInbox).where(eq(medusaInbox.id, id)).for('update')
        if (!row || !(row.status === 'failed' || (row.status === 'processing' && row.leaseExpiresAt && row.leaseExpiresAt.getTime() <= Date.now()))) continue
        await tx.update(medusaInbox).set({ status: 'received', attemptToken: null, leaseExpiresAt: null, revision: row.revision + 1, updatedAt: new Date() }).where(eq(medusaInbox.id, id))
        await enqueue(tx, { inboxId: id }); repaired++
      }
      return { repaired }
    }) }
    finally { budget.close() }
  }
  /** Call before unregistering handlers. Abort transport and drain the bounded attempts. */
  async function stop() { enabled = false; for (const controller of controllers) controller.abort(); await Promise.allSettled([...active]) }
  return {
    createBindingInTransaction, retireBindingInTransaction,
    getProduct: (ctx: TrustedContext, input: { bindingId: string }) => get(ctx, input, 'product'),
    getOrder: (ctx: TrustedContext, input: { bindingId: string }) => get(ctx, input, 'order'),
    listProducts: (ctx: TrustedContext, input: z.infer<typeof listInput> = {}) => list(ctx, input, 'product'),
    listOrders: (ctx: TrustedContext, input: z.infer<typeof listInput> = {}) => list(ctx, input, 'order'),
    requestResourceReconciliation, requestResourceReconciliationInTransaction, requestSyncPage, requestSyncPageInTransaction,
    getOperation, getSyncResult, cancelOperation, receive, receiveInTransaction, operationJob, inboxJob, repair, stop,
  }
}
export type MedusaService = ReturnType<typeof createMedusaService>
