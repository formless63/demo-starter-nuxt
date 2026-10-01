import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import postgres from 'postgres'
import { PgBoss } from 'pg-boss'
import { fileURLToPath } from 'node:url'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { digestObject, saveState, snapshot } from './lifecycle'
import type { RetainedProvider } from './lifecycle'
import { drizzle } from 'drizzle-orm/postgres-js'
import { eq, sql } from 'drizzle-orm'
import { pgTable, text, uuid } from 'drizzle-orm/pg-core'
import { z } from 'zod'
import { createTransferRegistry, createTransferService, defineTransfer, safeTransferError } from '@repo/nuxt-import-export/server'
import { transfer } from '@repo/nuxt-import-export/schema'
import { createJobsBoss, defineQueues, registerWorkers } from '@repo/nuxt-jobs/server'
import { compose, startProvider } from './providers'
const domain = pgTable('fixture_project', { id: uuid().primaryKey(), owner: text().notNull(), name: text().notNull(), description: text() })
const originalUrl = process.env.DATABASE_URL
assert(originalUrl, 'Disposable local PostgreSQL URL required')
const admin = postgres(originalUrl, { max: 1 })
const databaseName = `transfer_fixture_${randomUUID().replaceAll('-', '')}`
const url = new URL(originalUrl); url.pathname = `/${databaseName}`
let connection: ReturnType<typeof postgres> | undefined
let boss: ReturnType<typeof createJobsBoss> | undefined
let backend: Awaited<ReturnType<typeof startProvider>> | undefined
let project: string | undefined
const revoked = new Set<string>()
let success = false
const survivors: RetainedProvider[] = []
let failSql = false, calls = 0, snapshotHook: (() => Promise<void>) | undefined
try {
  await admin.unsafe(`CREATE DATABASE "${databaseName}"`)
  process.env.DATABASE_URL = url.href
  connection = postgres(url.href, { max: 6 }); boss = createJobsBoss({ databaseUrl: url.href, schema: 'pgboss', concurrency: 1, useListenNotify: false }, 'migration')
  await boss.start(); await boss.stop()
  boss = createJobsBoss({ databaseUrl: url.href, schema: 'pgboss', concurrency: 1, useListenNotify: false }, 'producer')
  await boss.start()
  const db = drizzle(connection)
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('./migrations', import.meta.url)) })
  await connection.unsafe('CREATE TABLE fixture_project (id uuid primary key, owner text not null, name text not null, description text)')
  const owner = { requesterId: 'opaque:owner', scope: { kind: 'user' as const, id: 'opaque:owner' } }
  const other = { requesterId: 'opaque:other', scope: { kind: 'user' as const, id: 'opaque:other' } }
  const rowSchema = z.object({ name: z.string().trim().min(1).max(120), description: z.string().trim().max(1000).transform(value => value || null) })
  const registry = createTransferRegistry([defineTransfer({
    name: 'projects', version: '1', columns: ['name', 'description'], rowSchema,
    async authorize(context) { return !revoked.has(context.requesterId) },
    async importRows(tx, context, rows) {
      calls++
      for (const row of rows) await tx.insert(domain).values({ id: randomUUID(), owner: context.requesterId, ...row })
      if (failSql) await tx.execute(sql`select 1 / 0`)
    },
    async *exportRows(tx, context) {
      const rows = await tx.select().from(domain).where(eq(domain.owner, context.requesterId)).orderBy(domain.id)
      await snapshotHook?.()
      const second = await tx.select().from(domain).where(eq(domain.owner, context.requesterId)).orderBy(domain.id)
      assert.equal(rows.length, second.length, 'REPEATABLE READ snapshot remains stable')
      for (const row of rows) yield [row.name, row.description]
    },
  })])
  const count = async () => (await db.select().from(domain)).length
  for (const provider of ['rustfs', 'garage'] as const) {
    project = `transfer-test-${provider}-${randomUUID().slice(0, 8)}`
    backend = await startProvider(provider, project, true)
    const service = createTransferService({ database: () => db, boss: async () => boss!, storage: () => backend!.storage, registry })
    await defineQueues(boss, { [service.runJob.name]: service.runJob })
    const run = (id: string, retryCount = 5) => service.runJob.handler({ transferId: id }, { id: randomUUID(), signal: new AbortController().signal, retryCount, retryLimit: 5 })
    const stage = (source: string) => service.stageImport(owner, { definition: 'projects', body: Readable.from((function* () { const data = Buffer.from(source); for (let offset = 0; offset < data.length; offset++) yield data.subarray(offset, offset + 1) })()) })
    const tenantA = { requesterId: owner.requesterId, scope: { kind: 'tenant' as const, id: 'opaque:tenant-a' } }
    const tenantB = { requesterId: owner.requesterId, scope: { kind: 'tenant' as const, id: 'opaque:tenant-b' } }
    const tenantReceipts = await Promise.all([tenantA, tenantB].map(context => service.stageImport(context, { definition: 'projects', body: Readable.from([Buffer.from('name,description\n')]) })))
    const tenantKey = randomUUID()
    for (const [index, context] of [tenantA, tenantB].entries()) {
      assert.equal((await service.getTransfer(context, { transferId: tenantReceipts[index]!.id })).status, 'staged')
      await assert.rejects(service.getTransfer(context, { transferId: tenantReceipts[1 - index]!.id }), { code: 'not-found' })
      await assert.rejects(service.startImport(context, { transferId: tenantReceipts[1 - index]!.id, idempotencyKey: tenantKey }), { code: 'not-found' })
      await assert.rejects(service.cancelTransfer(context, { transferId: tenantReceipts[1 - index]!.id }), { code: 'not-found' })
      await assert.rejects(service.getExportDownload(context, { transferId: tenantReceipts[1 - index]!.id }), { code: 'not-found' })
      const listed = await service.listTransfers(context)
      assert(listed.items.some(item => item.id === tenantReceipts[index]!.id)); assert(!listed.items.some(item => item.id === tenantReceipts[1 - index]!.id))
      assert.equal((await service.startImport(context, { transferId: tenantReceipts[index]!.id, idempotencyKey: tenantKey })).id, tenantReceipts[index]!.id)
      await service.cancelTransfer(context, { transferId: tenantReceipts[index]!.id })
    }
    const successful = await stage('\ufeffname,description\r\ncafé,"line1\n""line2"""\r\n')
    await assert.rejects(service.getTransfer(other, { transferId: successful.id }), { code: 'not-found' })
    await assert.rejects(service.getTransfer({ ...owner, scope: { kind: 'tenant', id: 'different' } }, { transferId: successful.id }), { code: 'not-found' })
    const key = randomUUID(), started = await service.startImport(owner, { transferId: successful.id, idempotencyKey: key })
    assert.equal((await service.startImport(owner, { transferId: successful.id, idempotencyKey: key })).id, started.id)
    const before = await count(), priorCalls = calls
    await Promise.all([run(successful.id), run(successful.id)])
    assert.equal(await count(), before + 1); assert.equal(calls, priorCalls + 1)
    assert.equal((await service.getTransfer(owner, { transferId: successful.id })).status, 'succeeded')
    await assert.rejects(service.cancelTransfer(owner, { transferId: successful.id }), { code: 'conflict' })
    // Crash after committed domain work before ack: stale reexecution is a no-op.
    await run(successful.id); assert.equal(await count(), before + 1)
    const different = await stage('name,description\nnew,content\n')
    await assert.rejects(service.startImport(owner, { transferId: different.id, idempotencyKey: key }), { code: 'conflict' })
    const empty = await stage('name,description\n'); await service.startImport(owner, { transferId: empty.id, idempotencyKey: randomUUID() }); await run(empty.id)
    assert.equal((await service.getTransfer(owner, { transferId: empty.id })).rowCount, 0)
    const invalid = await stage('name,description\n,secret\n'); await service.startImport(owner, { transferId: invalid.id, idempotencyKey: randomUUID() }); const beforeInvalid = await count(); await run(invalid.id)
    const invalidResult = await service.getTransfer(owner, { transferId: invalid.id }); assert.equal(invalidResult.errorCode, 'validation-failed'); assert.equal(await count(), beforeInvalid); assert(!JSON.stringify(invalidResult).includes('secret'))
    const rollback = await stage('name,description\nrollback,content\n'); await service.startImport(owner, { transferId: rollback.id, idempotencyKey: randomUUID() }); failSql = true; const beforeRollback = await count(); await run(rollback.id); failSql = false; assert.equal(await count(), beforeRollback)
    const corrupted = await stage('name,description\noriginal,text\n'); const [source] = await db.select().from(transfer).where(eq(transfer.id, corrupted.id)); await backend.storage.putObject(source!.sourceKey!, 'name,description\nreplaced,text\n'); await service.startImport(owner, { transferId: corrupted.id, idempotencyKey: randomUUID() }); await run(corrupted.id); assert.equal((await service.getTransfer(owner, { transferId: corrupted.id })).errorCode, 'invalid-format')
    const expired = await stage('name,description\nexpired,text\n'); await db.update(transfer).set({ artifactExpiresAt: new Date(0) }).where(eq(transfer.id, expired.id)); await assert.rejects(service.startImport(owner, { transferId: expired.id, idempotencyKey: randomUUID() }), { code: 'expired' })
    const cancelled = await stage('name,description\ncancelled,text\n'); await service.startImport(owner, { transferId: cancelled.id, idempotencyKey: randomUUID() }); await service.cancelTransfer(owner, { transferId: cancelled.id }); await run(cancelled.id); assert.equal((await service.cancelTransfer(owner, { transferId: cancelled.id })).status, 'cancelled')
    const denied = await stage('name,description\ndenied,text\n'); await service.startImport(owner, { transferId: denied.id, idempotencyKey: randomUUID() }); revoked.add(owner.requesterId); await run(denied.id); revoked.clear(); assert.equal((await service.getTransfer(owner, { transferId: denied.id })).errorCode, 'forbidden')
    const exportKey = randomUUID(), exported = await service.requestExport(owner, { definition: 'projects', idempotencyKey: exportKey })
    assert.equal((await service.requestExport(owner, { definition: 'projects', idempotencyKey: exportKey })).id, exported.id)
    await assert.rejects(service.getExportDownload(owner, { transferId: exported.id }), { code: 'conflict' })
    snapshotHook = async () => { await db.insert(domain).values({ id: randomUUID(), owner: owner.requesterId, name: `outside-snapshot-${provider}` }) }
    await run(exported.id); snapshotHook = undefined
    const signed = await service.getExportDownload(owner, { transferId: exported.id }); assert.equal(signed.expiresIn, 600); const body = await (await fetch(signed.url)).text(); assert(body.startsWith('name,description\r\n')); assert(!body.includes(`outside-snapshot-${provider}`))
    revoked.add(owner.requesterId); await assert.rejects(service.getExportDownload(owner, { transferId: exported.id }), { code: 'forbidden' }); revoked.clear()
    await db.update(transfer).set({ artifactExpiresAt: new Date(Date.now() + 29000) }).where(eq(transfer.id, exported.id)); await assert.rejects(service.getExportDownload(owner, { transferId: exported.id }), { code: 'expired' })
    await db.update(transfer).set({ artifactExpiresAt: new Date(Date.now() + 600000) }).where(eq(transfer.id, exported.id))
    const [stored] = await db.select().from(transfer).where(eq(transfer.id, exported.id)); await service.purgeTransferArtifacts([exported.id]); await backend.storage.headObject(stored!.artifactKey!); await service.purgeTransferArtifacts([exported.id], { execute: true }); await assert.rejects(backend.storage.headObject(stored!.artifactKey!), { code: 'not-found' }); assert.equal((await service.getTransfer(owner, { transferId: exported.id })).status, 'succeeded'); await assert.rejects(service.getExportDownload(owner, { transferId: exported.id }), { code: 'expired' })
    const hardCrash = await stage('name,description\ncrash,text\n'); await service.startImport(owner, { transferId: hardCrash.id, idempotencyKey: randomUUID() }); const [crashReceipt] = await db.select().from(transfer).where(eq(transfer.id, hardCrash.id)); assert.equal((await service.reconcileTransfer(hardCrash.id)).status, 'pending'); await boss.cancel(service.runJob.name, crashReceipt!.jobId!); assert.equal((await service.reconcileTransfer(hardCrash.id)).status, 'cancelled')
    const page = await service.listTransfers(owner, { limit: 2 }); assert.equal(page.items.length, 2); assert(page.nextCursor); assert.equal((await service.listTransfers(other, { cursor: page.nextCursor! })).items.length, 0); await assert.rejects(service.listTransfers(owner, { cursor: page.nextCursor! + '=' }), { code: 'invalid-input' })
    // Cancel versus an already locked atomic apply: commit wins, cancellation observes conflict.
    let releaseApply!: () => void, enteredApply!: () => void
    const applied = new Promise<void>(resolve => { enteredApply = resolve })
    const release = new Promise<void>(resolve => { releaseApply = resolve })
    const raceRegistry = createTransferRegistry([defineTransfer({ name: 'race', version: '1', columns: ['name'], rowSchema: z.object({ name: z.string() }), async authorize() { return true },
      async importRows(tx, context, rows) { enteredApply(); await release; await tx.insert(domain).values({ id: randomUUID(), owner: context.requesterId, name: rows[0]!.name }) }, async *exportRows() {} })])
    const race = createTransferService({ database: () => db, boss: async () => boss!, storage: () => backend!.storage, registry: raceRegistry })
    const raceReceipt = await race.stageImport(owner, { definition: 'race', body: Readable.from([Buffer.from('name\ncommit-wins\n')]) }); await race.startImport(owner, { transferId: raceReceipt.id, idempotencyKey: randomUUID() })
    const applying = race.runJob.handler({ transferId: raceReceipt.id }, { id: randomUUID(), signal: new AbortController().signal, retryCount: 5, retryLimit: 5 })
    await applied
    const cancelling = race.cancelTransfer(owner, { transferId: raceReceipt.id }).then(() => 'cancelled', error => (error as { code: string }).code)
    releaseApply(); await applying; assert.equal(await cancelling, 'conflict')
    // No published URL after permission is revoked during an actual uploaded export.
    const originalPut = backend.storage.putObject.bind(backend.storage)
    backend.storage.putObject = async (...args) => { const result = await originalPut(...args); revoked.add(owner.requesterId); return result }
    const beforePublication = await service.requestExport(owner, { definition: 'projects', idempotencyKey: randomUUID() }); await run(beforePublication.id); revoked.clear(); backend.storage.putObject = originalPut
    const [orphan] = await db.select().from(transfer).where(eq(transfer.id, beforePublication.id)); assert.equal(orphan!.status, 'failed'); assert.equal(orphan!.artifactKey, null); assert.equal(orphan!.artifactKeys.length, 1)
    await backend.storage.headObject(orphan!.artifactKeys[0]!); await service.purgeTransferArtifacts([orphan!.id], { execute: true }); await assert.rejects(backend.storage.headObject(orphan!.artifactKeys[0]!), { code: 'not-found' })
    // A failed staging PUT retains its private pointer and never becomes staged.
    backend.storage.putObject = () => Promise.reject(new (class extends Error { code = 'unavailable' })())
    await assert.rejects(stage('name,description\nfailed-upload,text\n'), { code: 'unavailable' }); backend.storage.putObject = originalPut
    const failedUploads = await db.select().from(transfer).where(eq(transfer.status, 'failed')); assert(failedUploads.some(row => row.errorCode === 'unavailable' && row.status === 'failed' && row.sourceKey && row.sourceHash === null))
    // Claim/shutdown abort preserves a pending receipt for native retry/reconciliation.
    const shutdown = await stage('name,description\nshutdown,text\n'); await service.startImport(owner, { transferId: shutdown.id, idempotencyKey: randomUUID() })
    await assert.rejects(service.runJob.handler({ transferId: shutdown.id }, { id: randomUUID(), signal: AbortSignal.abort(), retryCount: 0, retryLimit: 5 }), { code: 'cancelled' })
    assert.equal((await service.getTransfer(owner, { transferId: shutdown.id })).status, 'pending')
    await service.cancelTransfer(owner, { transferId: shutdown.id })
    // Actual PostgreSQL timeouts cancel a long snapshot query within the end-to-end budget.
    const slow = createTransferService({ database: () => db, boss: async () => boss!, storage: () => backend!.storage, env: { DATABASE_URL: url.href, IMPORT_EXPORT_TIMEOUT_SECONDS: '5' }, registry: createTransferRegistry([defineTransfer({ name: 'slow', version: '1', columns: ['name'], rowSchema: z.object({ name: z.string() }), async authorize() { return true }, async importRows() {}, async *exportRows(tx) { await tx.execute(sql`select pg_sleep(6)`); yield ['unpublished'] } })]) })
    const timed = await slow.requestExport(owner, { definition: 'slow', idempotencyKey: randomUUID() }), timeStarted = Date.now()
    await assert.rejects(slow.runJob.handler({ transferId: timed.id }, { id: randomUUID(), signal: new AbortController().signal, retryCount: 5, retryLimit: 5 }), { code: 'timeout' })
    assert(Date.now() - timeStarted < 6500, 'PostgreSQL cancels underlying long-running query')
    assert.equal((await slow.getTransfer(owner, { transferId: timed.id })).errorCode, 'timeout')
    const misconfiguredReceipt = await service.requestExport(owner, { definition: 'projects', idempotencyKey: randomUUID() })
    const misconfigured = createTransferService({ database: () => db, boss: async () => boss!, storage: () => backend!.storage, registry, env: { DATABASE_URL: url.href, IMPORT_EXPORT_TIMEOUT_SECONDS: '1e2' } })
    await misconfigured.runJob.handler({ transferId: misconfiguredReceipt.id }, { id: randomUUID(), signal: new AbortController().signal, retryCount: 0, retryLimit: 5 })
    assert.equal((await service.getTransfer(owner, { transferId: misconfiguredReceipt.id })).errorCode, 'configuration')
    // Resolution/current authorization SQL is bounded before any Storage acquisition.
    let slowAuthorization = false
    const guarded = createTransferService({ database: () => db, boss: async () => boss!, storage: () => backend!.storage, env: { DATABASE_URL: url.href, IMPORT_EXPORT_TIMEOUT_SECONDS: '5' }, registry: createTransferRegistry([defineTransfer({ name: 'guarded', version: '1', columns: ['name'], rowSchema: z.object({ name: z.string() }), async authorize(_context, tx) { if (slowAuthorization && tx) await tx.execute(sql`select pg_sleep(6)`); return true }, async importRows() {}, async *exportRows() { yield ['unpublished'] } })]) })
    const guardedReceipt = await guarded.requestExport(owner, { definition: 'guarded', idempotencyKey: randomUUID() }); slowAuthorization = true
    await assert.rejects(guarded.runJob.handler({ transferId: guardedReceipt.id }, { id: randomUUID(), signal: new AbortController().signal, retryCount: 5, retryLimit: 5 }), { code: 'timeout' })
    slowAuthorization = false
    const [guardedRow] = await db.select().from(transfer).where(eq(transfer.id, guardedReceipt.id)); assert.equal(guardedRow!.errorCode, 'timeout'); assert.equal(guardedRow!.artifactKeys.length, 0)
    // Real 30-second SQL cap with a longer 90-second attempt; no shortened production cap.
    let rollbackFault = true, observedTimeout: string | undefined
    const rollbackDatabase = { select: db.select.bind(db), insert: db.insert.bind(db), update: db.update.bind(db),
      transaction: ((...args: Parameters<typeof db.transaction>) => db.transaction(...args).catch(error => {
        if (rollbackFault && safeTransferError(error).code === 'timeout') { rollbackFault = false; throw Object.assign(new Error('private rollback fault'), { code: '08006' }) }
        throw error
      })) as typeof db.transaction }
    const capped = createTransferService({ database: () => rollbackDatabase, boss: async () => boss!, storage: () => backend!.storage, env: { DATABASE_URL: url.href, IMPORT_EXPORT_TIMEOUT_SECONDS: '90' }, registry: createTransferRegistry([defineTransfer({ name: 'sql-cap', version: '1', columns: ['name'], rowSchema: z.object({ name: z.string() }), async authorize() { return true },
      async importRows(tx, context, rows) {
        const [bounds] = await tx.execute(sql`select extract(epoch from current_setting('statement_timeout')::interval) * 1000 as statement_ms, extract(epoch from current_setting('transaction_timeout')::interval) * 1000 as transaction_ms`) as unknown as { statement_ms: string, transaction_ms: string }[]
        assert.equal(Number(bounds!.statement_ms), 29500); assert.equal(Number(bounds!.transaction_ms), 30000)
        await tx.insert(domain).values({ id: randomUUID(), owner: context.requesterId, name: rows[0]!.name })
        await tx.execute(sql`select pg_sleep(31)`)
      }, async *exportRows() {} })]) })
    const cappedReceipt = await capped.stageImport(owner, { definition: 'sql-cap', body: Readable.from([Buffer.from('name\nSQL rollback fixture\n')]) })
    await capped.startImport(owner, { transferId: cappedReceipt.id, idempotencyKey: randomUUID() })
    const [cappedRow] = await db.select().from(transfer).where(eq(transfer.id, cappedReceipt.id)), cappedNativeId = cappedRow!.jobId!
    await boss.update(service.runJob.name, undefined, { id: cappedNativeId, priority: 700 })
    const beforeCapped = await count(), actualWorker = createJobsBoss({ databaseUrl: url.href, schema: 'pgboss', concurrency: 1, useListenNotify: false }, 'worker')
    try {
      await actualWorker.start()
      await registerWorkers(actualWorker, { [capped.runJob.name]: { ...capped.runJob, work: { minPriority: 700, maxPriority: 700 }, async handler(payload, context) {
        try { await capped.runJob.handler(payload, context) } catch (error) { observedTimeout = safeTransferError(error).code; throw error }
      } } }, 1)
      const retryDeadline = Date.now() + 40000
      while (Date.now() < retryDeadline && (await boss.getJobById(service.runJob.name, cappedNativeId))?.state !== 'retry') await new Promise(resolve => setTimeout(resolve, 200))
      assert.equal((await boss.getJobById(service.runJob.name, cappedNativeId))?.state, 'retry')
    }
    finally { await actualWorker.stop({ graceful: true }) }
    assert.equal(observedTimeout, 'timeout', 'Known SQL timeout survives a cause-replacing rollback connection failure')
    assert.equal(await count(), beforeCapped, 'Nonfinal actual SQL timeout rolls back every domain write')
    assert.equal((await capped.getTransfer(owner, { transferId: cappedReceipt.id })).status, 'pending')
    // Supported native claims/failures accelerate only retry scheduling, not policy or SQL caps.
    for (let retry = 1; retry < 5; retry++) {
      const [claim] = await boss.fetch(service.runJob.name, { includeMetadata: true, minPriority: 700, maxPriority: 700, ignoreStartAfter: true })
      assert.equal(claim!.id, cappedNativeId); assert.equal(claim!.retryCount, retry)
      await boss.fail(service.runJob.name, { id: cappedNativeId, retryCount: retry })
      assert.equal((await capped.getTransfer(owner, { transferId: cappedReceipt.id })).status, 'pending')
    }
    const [finalClaim] = await boss.fetch(service.runJob.name, { includeMetadata: true, minPriority: 700, maxPriority: 700, ignoreStartAfter: true })
    assert.equal(finalClaim!.retryCount, 5); assert.equal(finalClaim!.retryLimit, 5)
    await assert.rejects(capped.runJob.handler({ transferId: cappedReceipt.id }, { id: finalClaim!.id, signal: new AbortController().signal, retryCount: finalClaim!.retryCount, retryLimit: finalClaim!.retryLimit }), { code: 'timeout' })
    await boss.fail(service.runJob.name, { id: cappedNativeId, retryCount: 5 })
    assert.equal(await count(), beforeCapped, 'Exhausted timeout also rolls back every domain write')
    assert.equal((await capped.getTransfer(owner, { transferId: cappedReceipt.id })).errorCode, 'timeout')
    assert.equal((await boss.getJobById(service.runJob.name, cappedNativeId))?.state, 'failed')
    // Exhaust the real six-attempt budget through supported APIs, then kill the final claim.
    // ignoreStartAfter accelerates fixture scheduling without altering production queue policy.
    const crashService = createTransferService({ database: () => db, boss: async () => boss!, storage: () => backend!.storage, registry, env: { DATABASE_URL: url.href, IMPORT_EXPORT_TIMEOUT_SECONDS: '5' } })
    const exhausted = await crashService.requestExport(owner, { definition: 'projects', idempotencyKey: randomUUID() })
    const [exhaustedRow] = await db.select().from(transfer).where(eq(transfer.id, exhausted.id))
    const nativeId = exhaustedRow!.jobId!
    const initialNative = await boss.getJobById(service.runJob.name, nativeId)
    assert.equal(initialNative!.retryLimit, 5); assert.equal(initialNative!.retryDelay, 30); assert.equal(initialNative!.retryBackoff, true); assert.equal(initialNative!.expireInSeconds, 35)
    await boss.update(service.runJob.name, undefined, { id: nativeId, priority: 900 })
    for (let attempt = 0; attempt < 5; attempt++) {
      const [claimed] = await boss.fetch(service.runJob.name, { includeMetadata: true, minPriority: 900, maxPriority: 900, ignoreStartAfter: true })
      assert.equal(claimed!.id, nativeId); assert.equal(claimed!.retryCount, attempt)
      await boss.fail(service.runJob.name, { id: nativeId, retryCount: attempt })
      assert.equal((await service.reconcileTransfer(exhausted.id)).status, 'pending')
    }
    const killed = Bun.spawn(['node', '.fixture/hard-crash.mjs'], { env: { ...process.env, DATABASE_URL: url.href, TRANSFER_FIXTURE_JOB: nativeId }, stdout: 'pipe', stderr: 'pipe' })
    const reader = killed.stdout.getReader(), claimedLine = await reader.read()
    assert(new TextDecoder().decode(claimedLine.value).includes('claimed-final-attempt')); reader.releaseLock()
    killed.kill('SIGKILL'); assert.notEqual(await killed.exited, 0)
    assert.equal((await service.reconcileTransfer(exhausted.id)).status, 'pending', 'Active native claim is not failed based on wall time')
    const finalNative = await boss.getJobById(service.runJob.name, nativeId)
    assert.equal(finalNative!.retryCount, 5); assert.equal(finalNative!.expireInSeconds, 35)
    // Fixture-only native supervisor cadence; retry policy and real expiry remain unchanged.
    const supervisor = new PgBoss({ connectionString: url.href, schema: 'pgboss', migrate: false, supervise: true, schedule: false, monitorIntervalSeconds: 1, superviseIntervalSeconds: 1 })
    try {
      await supervisor.start()
      const crashDeadline = Date.now() + 45000
      while (Date.now() < crashDeadline) { await supervisor.supervise(service.runJob.name); if ((await boss.getJobById(service.runJob.name, nativeId))?.state === 'failed') break; await new Promise(resolve => setTimeout(resolve, 500)) }
      assert.equal((await boss.getJobById(service.runJob.name, nativeId))?.state, 'failed')
    }
    finally { await supervisor.stop() }
    assert.equal((await service.reconcileTransfer(exhausted.id)).errorCode, 'execution-lost')
    const lost = await service.requestExport(owner, { definition: 'projects', idempotencyKey: randomUUID() })
    const [lostRow] = await db.select().from(transfer).where(eq(transfer.id, lost.id)); await boss.deleteJob(service.runJob.name, lostRow!.jobId!)
    assert.equal((await service.reconcileTransfer(lost.id)).errorCode, 'execution-lost')
    const nodeTransfer = await service.requestExport(owner, { definition: 'projects', idempotencyKey: randomUUID() })
    const [nodeQueued] = await db.select().from(transfer).where(eq(transfer.id, nodeTransfer.id))
    await boss.update(service.runJob.name, undefined, { id: nodeQueued!.jobId!, priority: 800 })
    const built = Bun.spawn(['bun', 'build', '.fixture/node-worker.ts', '--target=node', '--outfile=.fixture/node-worker.mjs'], { stdout: 'pipe', stderr: 'pipe' })
    assert.equal(await built.exited, 0, 'Node fixture bundle builds')
    const node = Bun.spawn(['node', '.fixture/node-worker.mjs'], { env: { ...process.env, DATABASE_URL: url.href, TRANSFER_FIXTURE_ID: nodeTransfer.id, STORAGE_BUCKET: backend.config.bucket, STORAGE_REGION: backend.config.region, STORAGE_ENDPOINT: backend.config.endpoint, STORAGE_ACCESS_KEY_ID: backend.config.accessKeyId, STORAGE_SECRET_ACCESS_KEY: backend.config.secretAccessKey }, stdout: 'pipe', stderr: 'pipe' })
    const [nodeOutput, nodeError, nodeExit] = await Promise.all([new Response(node.stdout).text(), new Response(node.stderr).text(), node.exited])
    assert.equal(nodeExit, 0, nodeError); assert(nodeOutput.includes('Node24 native Jobs worker'))
    const [nodeReceipt] = await db.select().from(transfer).where(eq(transfer.id, nodeTransfer.id))
    const nativeNodeJob = await boss.getJobById(service.runJob.name, nodeReceipt!.jobId!)
    assert(nativeNodeJob && nativeNodeJob.retryCount >= 1, 'Native Jobs retry recovers transient S3 failure without replaying success')
    // No implicit cleanup: source remains through success until explicit selected purge.
    await backend.storage.headObject(source!.sourceKey!)
    console.info(`[import-export] ${provider} real protocol/atomicity/snapshot contract passed`)
    const retained: RetainedProvider = { project, config: backend.config, objects: [
      { kind: 'source', ...await digestObject(backend.storage, source!.sourceKey!) },
      { kind: 'output', ...await digestObject(backend.storage, nodeReceipt!.artifactKey!) },
    ], job: { queue: service.runJob.name, id: nodeReceipt!.jobId!, record: JSON.parse(JSON.stringify(nativeNodeJob)) } }
    backend.storage.close(); backend = undefined
    survivors.push(retained); project = undefined
  }
  await saveState({ databaseName, url: url.href, snapshot: JSON.parse(JSON.stringify(await snapshot(connection))), providers: survivors })
  success = true
}
finally {
  snapshotHook = undefined
  backend?.storage.close()
  if (project) await compose(project, ['down', '--volumes', '--remove-orphans'])
  await boss?.stop({ graceful: false }); await connection?.end()
  if (!success) {
    for (const fixture of survivors) await compose(fixture.project, ['down', '--volumes', '--remove-orphans'])
    await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`)
  }
  await admin.end()
  process.env.DATABASE_URL = originalUrl
}
