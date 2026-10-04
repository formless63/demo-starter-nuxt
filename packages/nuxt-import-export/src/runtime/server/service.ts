import { randomUUID } from 'node:crypto'
import { and, desc, eq, lt, or, sql } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import { z } from 'zod'
import { defineJob, sendRegisteredJobInTransaction } from '@repo/nuxt-jobs/server'
import type { createJobsBoss, JobContext } from '@repo/nuxt-jobs/server'
import type { Storage } from '@repo/nuxt-storage/server'
import { transfer } from './schema'
import type { TransferRecord } from './schema'
import { transferConfig, trustedContext, transferId, idempotencyKey } from './config'
import type { TransferContext } from './config'
import { TransferError, safeTransferError } from './errors'
import type { TransferRegistry, TransferTransaction } from './registry'
import { boundedBody, attemptDeadline } from './io'
import { exportCsv, parseCsv } from './csv'
import type { CsvCell } from './csv'

type Database = Pick<PgDatabase<PgQueryResultHKT>, 'select' | 'insert' | 'update' | 'transaction'>
type Boss = ReturnType<typeof createJobsBoss>
export interface TransferServiceOptions {
  database(): Database
  boss(): Promise<Boss>
  storage(): Storage
  registry: TransferRegistry
  env?: NodeJS.ProcessEnv
  /** Runs within the owned final receipt transaction. Failure rolls back that transaction. */
  onCompletion?(tx: TransferTransaction, transfer: TransferRecord): Promise<void>
}
function summary(row: TransferRecord) {
  return {
    id: row.id, direction: row.direction, definition: row.definition, status: row.status,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null, completedAt: row.completedAt?.toISOString() ?? null,
    snapshotAt: row.snapshotAt?.toISOString() ?? null, rowCount: row.rowCount, byteCount: row.byteCount,
    errorCode: row.errorCode, validationIssues: row.validationIssues, errorsTruncated: Boolean(row.errorsTruncated),
  }
}
function visibility(context: TransferContext) {
  return and(eq(transfer.requesterId, context.requesterId), eq(transfer.scopeKind, context.scope.kind), eq(transfer.scopeId, context.scope.id))!
}
function rowContext(row: TransferRecord): TransferContext { return { requesterId: row.requesterId, scope: { kind: row.scopeKind, id: row.scopeId } } }
function terminal(row: TransferRecord) { return ['succeeded', 'failed', 'cancelled'].includes(row.status) }
function cursor(value: string) {
  try {
    if (value.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error()
    const tuple = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown
    if (!Array.isArray(tuple) || tuple.length !== 3 || tuple[0] !== 1 || typeof tuple[1] !== 'string') throw new Error()
    const id = transferId(tuple[2]), createdAt = new Date(tuple[1])
    if (createdAt.toISOString() !== tuple[1] || Buffer.from(JSON.stringify(tuple)).toString('base64url') !== value) throw new Error()
    return { id, createdAt }
  }
  catch { throw new TransferError('invalid-input') }
}
export function createTransferService(options: TransferServiceOptions) {
  const config = () => transferConfig(options.env)
  async function authorize(context: TransferContext, name: string, tx?: TransferTransaction) {
    trustedContext(context)
    const definition = options.registry.get(name)
    if (!await definition.authorize(context, tx)) throw new TransferError('forbidden')
    return definition
  }
  async function owned(context: TransferContext, id: string) {
    trustedContext(context)
    const [row] = await options.database().select().from(transfer).where(and(eq(transfer.id, transferId(id)), visibility(context))).limit(1)
    if (!row) throw new TransferError('not-found')
    await authorize(context, row.definition)
    return row
  }
  async function locked(tx: TransferTransaction, id: string) {
    const [row] = await tx.select().from(transfer).where(eq(transfer.id, transferId(id))).for('update')
    if (!row) throw new TransferError('not-found')
    return row
  }
  async function finish(tx: TransferTransaction, row: TransferRecord, values: Partial<typeof transfer.$inferInsert>) {
    const [updated] = await tx.update(transfer).set({ ...values, updatedAt: new Date(), completedAt: new Date() }).where(eq(transfer.id, row.id)).returning()
    await options.onCompletion?.(tx, updated!)
    return updated!
  }
  async function timeouts(tx: TransferTransaction, deadline: ReturnType<typeof attemptDeadline>) {
    deadline.check()
    const budget = Math.floor(Math.min(30000, deadline.remaining()))
    if (budget < 2) throw new TransferError('timeout')
    await tx.execute(sql`select set_config('transaction_timeout', ${`${budget}ms`}, true), set_config('statement_timeout', ${`${Math.max(1, budget - 500)}ms`}, true), set_config('lock_timeout', ${`${Math.min(5000, budget)}ms`}, true)`)
  }
  // Preserve a known callback timeout if a driver rollback failure replaces its cause.
  // These transactions are owned convenience operations, never caller transactions.
  async function attemptTransaction<T>(deadline: ReturnType<typeof attemptDeadline>, run: (tx: TransferTransaction) => Promise<T>, configuration?: Parameters<Database['transaction']>[1]): Promise<T> {
    let timeout: TransferError | undefined
    deadline.check()
    try {
      return await options.database().transaction(async (tx) => {
        try { return await run(tx) }
        catch (error) { const safe = safeTransferError(error); if (safe.code === 'timeout') timeout = safe; throw error }
      }, configuration)
    }
    catch (error) { throw timeout ?? error }
  }
  // Lazy queue policy: no configuration or dependency checks at module import/build/start.
  const runJob = defineJob({
    name: 'import-export.run', payload: z.object({ transferId: z.uuid() }).strict(),
    queue: { retryLimit: 5, retryDelay: 30, retryBackoff: true, retryDelayMax: 900, deleteAfterSeconds: 86400 },
    handler: (payload, job) => runTransfer(payload.transferId, job),
  })
  async function enqueue(tx: TransferTransaction, row: TransferRecord) {
    const boss = await options.boss()
    const definition = { ...runJob, send: { expireInSeconds: config().timeoutSeconds + 30 } }
    const jobId = await sendRegisteredJobInTransaction(boss, { [runJob.name]: definition }, tx as unknown as Parameters<typeof sendRegisteredJobInTransaction>[2], runJob.name, { transferId: row.id }, options.env?.DATABASE_URL ?? process.env.DATABASE_URL)
    const [updated] = await tx.update(transfer).set({ jobId, status: 'pending', updatedAt: new Date() }).where(eq(transfer.id, row.id)).returning()
    return updated!
  }
  async function stageImport(context: TransferContext, input: { definition: string, body: AsyncIterable<Uint8Array> }) {
    const definition = await authorize(context, input.definition)
    const settings = config(), deadline = attemptDeadline(settings.timeoutSeconds)
    const id = randomUUID()
    let receipt: TransferRecord | undefined
    try {
      deadline.check()
      const storage = options.storage(), sourceKey = storage.createKey('transfers')
      const row = await attemptTransaction(deadline, async (tx) => {
        await timeouts(tx, deadline)
        const [created] = await tx.insert(transfer).values({ id, requesterId: context.requesterId, scopeKind: context.scope.kind, scopeId: context.scope.id, definition: definition.name, version: definition.version, direction: 'import', status: 'uploading', sourceKey }).returning()
        deadline.check()
        return created
      })
      receipt = row!
      const source = await boundedBody(input.body, settings.maxBytes, deadline.signal)
      deadline.check()
      await storage.putObject(sourceKey, source.body, { contentType: 'text/csv', signal: deadline.signal })
      const head = await storage.headObject(sourceKey, { signal: deadline.signal })
      if (head.size !== source.bytes) throw new TransferError('invalid-format')
      deadline.check()
      const updated = await attemptTransaction(deadline, async (tx) => {
        await timeouts(tx, deadline)
        const current = await locked(tx, id)
        if (current.status !== 'uploading') throw new TransferError('cancelled')
        await authorize(context, definition.name, tx)
        deadline.check()
        const [result] = await tx.update(transfer).set({ status: 'staged', sourceHash: source.hash, sourceBytes: source.bytes, byteCount: source.bytes, artifactExpiresAt: new Date(Date.now() + settings.artifactTtlSeconds * 1000), updatedAt: new Date() }).where(eq(transfer.id, id)).returning()
        return result!
      })
      return { ...summary(updated), size: source.bytes, hash: source.hash }
    }
    catch (error) {
      const safe = deadline.isTimeout() ? new TransferError('timeout') : safeTransferError(error)
      if (receipt) await options.database().transaction(async (tx) => {
        await tx.execute(sql`select set_config('transaction_timeout', '5000ms', true), set_config('statement_timeout', '4500ms', true), set_config('lock_timeout', '1000ms', true)`)
        await tx.update(transfer).set({ status: 'failed', errorCode: safe.code, updatedAt: new Date(), completedAt: new Date() }).where(and(eq(transfer.id, id), eq(transfer.status, 'uploading')))
      })
      throw safe
    }
    finally { deadline.close() }
  }
  async function startImport(context: TransferContext, input: { transferId: string, idempotencyKey: string }) {
    const original = await owned(context, input.transferId), key = idempotencyKey(input.idempotencyKey)
    if (original.direction !== 'import') throw new TransferError('conflict')
    return options.database().transaction(async (tx) => {
      await tx.execute(sql`select set_config('transaction_timeout', '30000ms', true), set_config('statement_timeout', '29500ms', true), set_config('lock_timeout', '5000ms', true)`)
      const row = await locked(tx, original.id)
      await authorize(context, row.definition, tx)
      const fingerprint = JSON.stringify([1, row.definition, row.version, row.sourceHash, row.sourceBytes])
      const [existing] = await tx.select().from(transfer).where(and(visibility(context), eq(transfer.direction, 'import'), eq(transfer.idempotencyKey, key))).limit(1)
      if (existing) { if (existing.fingerprint !== fingerprint) throw new TransferError('conflict'); return summary(existing) }
      if (row.status !== 'staged') throw new TransferError('conflict')
      if (!row.artifactExpiresAt || row.artifactExpiresAt.getTime() <= Date.now()) throw new TransferError('expired')
      const [updated] = await tx.update(transfer).set({ idempotencyKey: key, fingerprint }).where(eq(transfer.id, row.id)).returning()
      return summary(await enqueue(tx, updated!))
    }).catch((error: unknown) => { if ((error as { code?: string })?.code === '23505') throw new TransferError('conflict'); throw safeTransferError(error) })
  }
  async function requestExport(context: TransferContext, input: { definition: string, idempotencyKey: string }) {
    const definition = await authorize(context, input.definition), key = idempotencyKey(input.idempotencyKey)
    const fingerprint = JSON.stringify([1, definition.name, definition.version])
    return options.database().transaction(async (tx) => {
      await tx.execute(sql`select set_config('transaction_timeout', '30000ms', true), set_config('statement_timeout', '29500ms', true), set_config('lock_timeout', '5000ms', true)`)
      await authorize(context, definition.name, tx)
      const [inserted] = await tx.insert(transfer).values({ id: randomUUID(), requesterId: context.requesterId, scopeKind: context.scope.kind, scopeId: context.scope.id, definition: definition.name, version: definition.version, direction: 'export', status: 'pending', idempotencyKey: key, fingerprint }).onConflictDoNothing().returning()
      if (!inserted) {
        const [existing] = await tx.select().from(transfer).where(and(visibility(context), eq(transfer.direction, 'export'), eq(transfer.idempotencyKey, key))).limit(1)
        if (!existing || existing.fingerprint !== fingerprint) throw new TransferError('conflict')
        return summary(existing)
      }
      return summary(await enqueue(tx, inserted))
    }).catch((error: unknown) => { throw safeTransferError(error) })
  }
  async function getTransfer(context: TransferContext, input: { transferId: string, refresh?: boolean }) {
    const row = await owned(context, input.transferId)
    if (input.refresh) await reconcileTransfer(row.id)
    return summary(await owned(context, row.id))
  }
  async function listTransfers(context: TransferContext, input: { limit?: number, cursor?: string } = {}) {
    trustedContext(context)
    const limit = input.limit ?? 25
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new TransferError('invalid-input')
    const predicates = [visibility(context)]
    if (input.cursor !== undefined) {
      const after = cursor(input.cursor)
      predicates.push(or(lt(transfer.createdAt, after.createdAt), and(eq(transfer.createdAt, after.createdAt), lt(transfer.id, after.id)))!)
    }
    const rows = await options.database().select().from(transfer).where(and(...predicates)).orderBy(desc(transfer.createdAt), desc(transfer.id)).limit(limit + 1)
    const visible = rows.slice(0, limit)
    for (const row of visible) await authorize(context, row.definition)
    const last = visible.at(-1)
    return { items: visible.map(summary), nextCursor: rows.length > limit && last ? Buffer.from(JSON.stringify([1, last.createdAt.toISOString(), last.id])).toString('base64url') : null }
  }
  async function cancelTransfer(context: TransferContext, input: { transferId: string }) {
    const original = await owned(context, input.transferId)
    const row = await options.database().transaction(async (tx) => {
      await tx.execute(sql`select set_config('transaction_timeout', '30000ms', true), set_config('statement_timeout', '29500ms', true), set_config('lock_timeout', '5000ms', true)`)
      const row = await locked(tx, original.id)
      await authorize(context, row.definition, tx)
      if (row.status === 'cancelled') return row
      if (terminal(row)) throw new TransferError('conflict')
      return finish(tx, row, { status: 'cancelled', errorCode: 'cancelled' })
    })
    if (row.jobId) { try { await (await options.boss()).cancel(runJob.name, row.jobId) } catch { /* Durable receipt is authority. */ } }
    return summary(row)
  }
  async function getExportDownload(context: TransferContext, input: { transferId: string }) {
    const row = await owned(context, input.transferId)
    if (row.direction !== 'export' || row.status !== 'succeeded' || !row.artifactKey) throw new TransferError('conflict')
    const remaining = Math.floor(((row.artifactExpiresAt?.getTime() ?? 0) - Date.now()) / 1000)
    if (remaining < 30) throw new TransferError('expired')
    return options.storage().presignDownload(row.artifactKey, Math.min(600, remaining))
  }
  async function runTransfer(id: string, job: JobContext) {
    const attemptStarted = Date.now()
    let deadline = attemptDeadline(300, job.signal)
    try {
      const settings = config()
      deadline.close()
      deadline = attemptDeadline(Math.max(0.001, settings.timeoutSeconds - (Date.now() - attemptStarted) / 1000), job.signal)
      const original = await attemptTransaction(deadline, async (tx) => {
        await timeouts(tx, deadline)
        const [row] = await tx.select().from(transfer).where(eq(transfer.id, transferId(id))).limit(1)
        if (!row || row.status !== 'pending') return undefined
        const definition = await authorize(rowContext(row), row.definition, tx)
        if (definition.version !== row.version) throw new TransferError('conflict')
        await tx.update(transfer).set({ startedAt: sql`COALESCE(${transfer.startedAt}, CURRENT_TIMESTAMP)`, updatedAt: new Date() }).where(and(eq(transfer.id, id), eq(transfer.status, 'pending')))
        deadline.check()
        return row
      })
      if (!original) return
      const context = rowContext(original), definition = options.registry.get(original.definition)
      deadline.check()
      if (original.direction === 'import') {
        if (!original.sourceKey || !original.artifactExpiresAt || original.artifactExpiresAt.getTime() <= Date.now()) throw new TransferError('expired')
        const object = await options.storage().getObject(original.sourceKey, { signal: deadline.signal })
        const source = await boundedBody(object.body as AsyncIterable<Uint8Array>, settings.maxBytes, deadline.signal)
        if (source.hash !== original.sourceHash || source.bytes !== original.sourceBytes) throw new TransferError('invalid-format')
        const rows = parseCsv(source.body, definition.columns, definition.rowSchema, settings)
        deadline.check()
        await attemptTransaction(deadline, async (tx) => {
          await timeouts(tx, deadline)
          const row = await locked(tx, id)
          if (row.status !== 'pending') return
          await authorize(context, row.definition, tx)
          if (!row.artifactExpiresAt || row.artifactExpiresAt.getTime() <= Date.now()) throw new TransferError('expired')
          deadline.check()
          if (rows.length) await definition.importRows(tx, context, rows, deadline.signal)
          deadline.check()
          await finish(tx, row, { status: 'succeeded', rowCount: rows.length, byteCount: source.bytes })
          deadline.check()
        })
      }
      else {
        const rows: (readonly CsvCell[])[] = []
        let normalized = 0, snapshotAt = new Date()
        await attemptTransaction(deadline, async (tx) => {
          await timeouts(tx, deadline)
          const { rows: [clock] } = await tx.execute(sql`select CURRENT_TIMESTAMP as snapshot_at`) as unknown as { rows: { snapshot_at: Date }[] }
          snapshotAt = new Date(clock!.snapshot_at)
          await authorize(context, original.definition, tx)
          for await (const row of definition.exportRows(tx, context, deadline.signal)) {
            deadline.check()
            if (rows.length >= settings.maxRows) throw new TransferError('limit-exceeded')
            normalized += Buffer.byteLength(JSON.stringify(row))
            if (normalized > settings.maxBytes * 2) throw new TransferError('limit-exceeded')
            rows.push(row)
          }
        }, { isolationLevel: 'repeatable read', accessMode: 'read only' })
        const body = exportCsv(rows, definition.columns, settings)
        deadline.check()
        const storage = options.storage(), artifactKey = storage.createKey('transfers')
        const reserved = await attemptTransaction(deadline, async (tx) => {
          await timeouts(tx, deadline)
          const row = await locked(tx, id)
          if (row.status !== 'pending') return false
          await authorize(context, row.definition, tx)
          await tx.update(transfer).set({ artifactKeys: [...row.artifactKeys, artifactKey], updatedAt: new Date() }).where(eq(transfer.id, id))
          deadline.check()
          return true
        })
        if (!reserved) return
        await storage.putObject(artifactKey, body, { contentType: 'text/csv', signal: deadline.signal })
        const head = await storage.headObject(artifactKey, { signal: deadline.signal })
        if (head.size !== body.byteLength) throw new TransferError('invalid-format')
        await attemptTransaction(deadline, async (tx) => {
          await timeouts(tx, deadline)
          const row = await locked(tx, id)
          if (row.status !== 'pending') return
          await authorize(context, row.definition, tx)
          deadline.check()
          await finish(tx, row, { status: 'succeeded', artifactKey, artifactExpiresAt: new Date(Date.now() + settings.artifactTtlSeconds * 1000), byteCount: body.byteLength, rowCount: rows.length, snapshotAt })
          deadline.check()
        })
      }
    }
    catch (error) {
      const safe = deadline.isTimeout() ? new TransferError('timeout') : safeTransferError(error)
      // Worker shutdown/claim abort is not a terminal user cancellation.
      if (job.signal.aborted && !deadline.isTimeout()) throw safe
      const finalAttempt = job.retryLimit !== undefined && job.retryCount >= job.retryLimit
      if (!safe.retryable || finalAttempt) await options.database().transaction(async (tx) => {
        // Bounded failure housekeeping after the attempt; reconciliation handles a lost catch.
        await tx.execute(sql`select set_config('transaction_timeout', '5000ms', true), set_config('statement_timeout', '4500ms', true), set_config('lock_timeout', '1000ms', true)`)
        const row = await locked(tx, id)
        if (row.status === 'pending') await finish(tx, row, { status: 'failed', errorCode: safe.code, validationIssues: safe.issues, errorsTruncated: Number(safe.errorsTruncated) })
      })
      if (safe.retryable) throw safe
    }
    finally { deadline.close() }
  }
  /** Operator housekeeping; supported pg-boss lookup under the receipt lock. */
  async function reconcileTransfer(id: string) {
    return options.database().transaction(async (tx) => {
      await tx.execute(sql`select set_config('lock_timeout', '5000ms', true), set_config('statement_timeout', '29500ms', true), set_config('transaction_timeout', '30000ms', true)`)
      const row = await locked(tx, id)
      if (row.status !== 'pending') return summary(row)
      const native = row.jobId ? await (await options.boss()).getJobById(runJob.name, row.jobId) : null
      if (!native) return summary(await finish(tx, row, { status: 'failed', errorCode: 'execution-lost' }))
      if (native.state === 'failed' || native.state === 'cancelled') return summary(await finish(tx, row, { status: native.state === 'cancelled' ? 'cancelled' : 'failed', errorCode: native.state === 'cancelled' ? 'cancelled' : 'execution-lost' }))
      return summary(row)
    })
  }
  async function reconcileTransfers(ids: string[]) {
    if (!Array.isArray(ids) || ids.length > 100) throw new TransferError('invalid-input')
    const results = []
    for (const id of ids) results.push(await reconcileTransfer(transferId(id)))
    return results
  }
  async function purgeTransferArtifacts(ids: string[], input: { execute?: boolean } = {}) {
    if (!Array.isArray(ids) || ids.length > 100 || (input.execute !== undefined && typeof input.execute !== 'boolean')) throw new TransferError('invalid-input')
    const results = []
    for (const id of ids) {
      const selected = await options.database().transaction(async (tx) => {
        await tx.execute(sql`select set_config('lock_timeout', '5000ms', true), set_config('transaction_timeout', '30000ms', true)`)
        const row = await locked(tx, transferId(id))
        if (!terminal(row) && row.status !== 'uploading') throw new TransferError('conflict')
        if (row.status === 'uploading' && Date.now() - row.updatedAt.getTime() < config().timeoutSeconds * 1000) throw new TransferError('conflict')
        // Fence abandoned staging and revoke future artifact URLs before deleting outside SQL.
        if (input.execute && row.artifactKey) await tx.update(transfer).set({ artifactExpiresAt: new Date(), updatedAt: new Date() }).where(eq(transfer.id, row.id))
        if (input.execute && row.status === 'uploading') await finish(tx, row, { status: 'failed', errorCode: 'execution-lost' })
        return { id: row.id, keys: [...new Set([row.sourceKey, row.artifactKey, ...row.artifactKeys])].filter((key): key is string => Boolean(key)) }
      })
      if (input.execute) for (const key of selected.keys) await options.storage().deleteObject(key)
      results.push({ id: selected.id, artifactCount: selected.keys.length, executed: input.execute === true })
    }
    return results
  }
  return { stageImport, startImport, requestExport, getTransfer, listTransfers, cancelTransfer, getExportDownload, reconcileTransfer, reconcileTransfers, purgeTransferArtifacts, runJob }
}
export type TransferService = ReturnType<typeof createTransferService>
