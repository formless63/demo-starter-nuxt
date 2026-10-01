import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import postgres from 'postgres'
import { fileURLToPath } from 'node:url'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { saveState, snapshot } from './lifecycle'
import { drizzle } from 'drizzle-orm/postgres-js'
import { eq, sql } from 'drizzle-orm'
import { pgTable, text, uuid } from 'drizzle-orm/pg-core'
import { z } from 'zod'
import { createTransferRegistry, createTransferService, defineTransfer } from '@repo/nuxt-import-export/server'
import { transfer } from '@repo/nuxt-import-export/schema'
import { createJobsBoss, defineQueues } from '@repo/nuxt-jobs/server'
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
const survivors: { project: string, config: Awaited<ReturnType<typeof startProvider>>['config'], key: string }[] = []
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
    const [stored] = await db.select().from(transfer).where(eq(transfer.id, exported.id)); await service.purgeTransferArtifacts([exported.id]); await backend.storage.headObject(stored!.artifactKey!); await service.purgeTransferArtifacts([exported.id], { execute: true }); await assert.rejects(backend.storage.headObject(stored!.artifactKey!), { code: 'not-found' }); assert.equal((await service.getTransfer(owner, { transferId: exported.id })).status, 'succeeded')
    const hardCrash = await stage('name,description\ncrash,text\n'); await service.startImport(owner, { transferId: hardCrash.id, idempotencyKey: randomUUID() }); const [crashReceipt] = await db.select().from(transfer).where(eq(transfer.id, hardCrash.id)); assert.equal((await service.reconcileTransfer(hardCrash.id)).status, 'pending'); await boss.cancel(service.runJob.name, crashReceipt!.jobId!); assert.equal((await service.reconcileTransfer(hardCrash.id)).status, 'cancelled')
    const page = await service.listTransfers(owner, { limit: 2 }); assert.equal(page.items.length, 2); assert(page.nextCursor); assert.equal((await service.listTransfers(other, { cursor: page.nextCursor! })).items.length, 0); await assert.rejects(service.listTransfers(owner, { cursor: page.nextCursor! + '=' }), { code: 'invalid-input' })
    const nodeTransfer = await service.requestExport(owner, { definition: 'projects', idempotencyKey: randomUUID() })
    const built = Bun.spawn(['bun', 'build', '.fixture/node-worker.ts', '--target=node', '--outfile=.fixture/node-worker.mjs'], { stdout: 'pipe', stderr: 'pipe' })
    assert.equal(await built.exited, 0, 'Node fixture bundle builds')
    const node = Bun.spawn(['node', '.fixture/node-worker.mjs'], { env: { ...process.env, DATABASE_URL: url.href, TRANSFER_FIXTURE_ID: nodeTransfer.id, STORAGE_BUCKET: backend.config.bucket, STORAGE_REGION: backend.config.region, STORAGE_ENDPOINT: backend.config.endpoint, STORAGE_ACCESS_KEY_ID: backend.config.accessKeyId, STORAGE_SECRET_ACCESS_KEY: backend.config.secretAccessKey }, stdout: 'pipe', stderr: 'pipe' })
    const [nodeOutput, nodeError, nodeExit] = await Promise.all([new Response(node.stdout).text(), new Response(node.stderr).text(), node.exited])
    assert.equal(nodeExit, 0, nodeError); assert(nodeOutput.includes('Node24 native Jobs worker'))
    // No implicit cleanup: source remains through success until explicit selected purge.
    await backend.storage.headObject(source!.sourceKey!)
    console.info(`[import-export] ${provider} real protocol/atomicity/snapshot contract passed`)
    const backendConfig = backend.config
    backend.storage.close(); backend = undefined
    survivors.push({ project, config: backendConfig, key: source!.sourceKey! }); project = undefined
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
