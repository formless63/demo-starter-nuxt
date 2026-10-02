import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, readFile, writeFile, cp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'
import { createInvoiceNinjaService } from '@repo/nuxt-invoice-ninja/server'
import { invoiceNinjaBinding as bindings, invoiceNinjaOperation as operations, invoiceNinjaInbox as inbox } from '@repo/nuxt-invoice-ninja/schema'
import { createJobsBoss, defineQueues, resolveJobsConfig } from '@repo/nuxt-jobs/server'
import { runJobsMigration, runJobsDoctor } from '@repo/nuxt-jobs/cli'
import { saveState, witness, details } from './lifecycle'
const adminUrl = process.env.DATABASE_URL; assert(adminUrl)
const admin = postgres(adminUrl, { max: 1 }), databaseName = `invoice_nuxt_fixture_${randomUUID().replaceAll('-', '')}`
await admin.unsafe(`CREATE DATABASE "${databaseName}"`)
const url = new URL(adminUrl); url.pathname = `/${databaseName}`
await saveState({ databaseName, url: url.toString() })
const client = postgres(url.toString(), { max: 5 }), db = drizzle(client)
process.env.DATABASE_URL = url.toString(); process.env.PGBOSS_DATABASE_URL = url.toString(); process.env.PGBOSS_SCHEMA = 'invoice_fixture_jobs'
let posts = 0, gets = 0, amount = '25.1234', absent = false, disconnected = true, authorized = true
const secret = 's'.repeat(32)
const server = createServer((req, res) => {
  assert.equal(req.headers['x-api-token'], 'private-api-fixture'); assert.equal(req.headers['x-requested-with'], 'XMLHttpRequest')
  assert.ok(!req.url?.includes('send') && !req.url?.includes('payment') && !req.url?.includes('action'))
  if (req.method === 'POST') {
    posts++; assert.equal(req.url, '/api/v1/invoices'); let body = ''
    req.on('data', b => body += b); req.on('end', () => {
      const input = JSON.parse(body); assert.equal(input.line_items[0].cost, '25.1234'); assert.equal(input.line_items[0].quantity, '1')
      assert.equal(input.client_id, 'client-a'); assert.equal(input.send_email, undefined)
      if (disconnected) { res.destroy(); return }
      res.end('{"data":{"id":"draft-child","client_id":"client-a","status_id":"1","number":"DRAFT-1","amount":25.1234,"balance":25.1234,"updated_at":1790899200,"is_deleted":false,"auto_bill_enabled":false,"contact_email":"private@example.test"}}')
    }); return
  }
  gets++
  if (req.url?.startsWith('/api/v1/clients/')) { res.end(JSON.stringify({ data: { id: req.url.split('/').at(-1), contacts: [{ email: 'private@example.test' }] } })); return }
  assert.equal(req.url, '/api/v1/invoices/invoice-a')
  if (absent) { res.writeHead(404); res.end('{}'); return }
  res.end(`{"data":{"id":"invoice-a","client_id":"client-a","number":"SAFE-1","status_id":"2","amount":${amount},"balance":${amount},"updated_at":1790899200,"is_deleted":false,"contact_email":"private@example.test"}}`)
})
await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
const connection = { baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}`, apiToken: 'private-api-fixture', webhookSecret: secret }
const boss = createJobsBoss(resolveJobsConfig(), 'producer')
const a = { actorUserId: 'owner-a', scope: { kind: 'user' as const, id: 'owner-a' } }, b = { actorUserId: 'owner-b', scope: { kind: 'user' as const, id: 'owner-b' } }
const service = createInvoiceNinjaService({ database: () => db, boss: async () => boss, applicationDatabaseUrl: url.toString(), resolveConnection: async () => connection,
  authorizeScope: async (actor, scope) => authorized && actor === scope.id && scope.kind === 'user', authorizeBoundResource: async () => authorized,
  authorizeReconciliation: async binding => authorized && binding.scopeId === a.scope.id, resolveInvoiceCurrency: async () => 'USD',
  resolveDraftPolicy: async () => ({ currencyId: '1', currency: 'USD', configurationIdentity: 'fixture-only-proof', numericStringEncodingVerified: true, unsentZeroTaxDiscountVerified: true }),
})
const context = () => ({ id: randomUUID(), signal: new AbortController().signal, retryCount: 0, retryLimit: 5 })
async function run(id: string) { return service.operationJob.handler({ operationId: id }, context()) }
// Pause the projection write after its fencing checks. A concurrent recovery or
// binding change must wait for the complete projection/terminal-state commit.
async function assertCommitFence(kind: 'operation' | 'receipt', id: string, bindingId: string, start: () => Promise<unknown>) {
  const control = postgres(url.toString(), { max: 1 })
  const contender = postgres(url.toString(), { max: 1 })
  let worker: Promise<unknown> | undefined
  try {
    await client.unsafe(`CREATE FUNCTION invoice_fixture_pause_projection() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(742129); RETURN NEW; END $$`)
    await client.unsafe(`CREATE TRIGGER invoice_fixture_pause_projection BEFORE INSERT ON invoice_ninja_projection FOR EACH ROW EXECUTE FUNCTION invoice_fixture_pause_projection()`)
    await control`SELECT pg_advisory_lock(742129)`
    worker = start()
    let waiting = false
    for (let attempt = 0; attempt < 100; attempt++) {
      const rows = await client`SELECT pid FROM pg_stat_activity WHERE datname = ${databaseName} AND wait_event = 'advisory'`
      if (rows.length) { waiting = true; break }
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    assert(waiting, 'Worker reached the paused projection write')
    const table = kind === 'operation' ? 'invoice_ninja_operation' : 'invoice_ninja_inbox'
    for (const [target, rowId] of [[table, id], ['invoice_ninja_binding', bindingId]]) {
      await assert.rejects(contender.begin(async tx => {
        await tx`SET LOCAL lock_timeout = '100ms'`
        await tx.unsafe(`UPDATE ${target} SET revision = revision + 1 WHERE id = $1`, [rowId!])
      }), (error: unknown) => error instanceof Error && 'code' in error && error.code === '55P03', `${target} stays locked through projection commit`)
    }
  }
  finally {
    await control`SELECT pg_advisory_unlock(742129)`
    await worker
    await client.unsafe('DROP TRIGGER IF EXISTS invoice_fixture_pause_projection ON invoice_ninja_projection')
    await client.unsafe('DROP FUNCTION IF EXISTS invoice_fixture_pause_projection()')
    await control.end(); await contender.end()
  }
}
try {
  const upgrade = await mkdtemp(join(tmpdir(), 'invoice-upgrade-'))
  try {
    await mkdir(join(upgrade, 'meta'))
    const journal = JSON.parse(await readFile('.fixture/migrations/meta/_journal.json', 'utf8'))
    const prior = { ...journal, entries: journal.entries.slice(0, 6) }
    await writeFile(join(upgrade, 'meta/_journal.json'), JSON.stringify(prior))
    for (const entry of prior.entries) await cp(`.fixture/migrations/${entry.tag}.sql`, join(upgrade, `${entry.tag}.sql`))
    await migrate(db, { migrationsFolder: upgrade })
    await client`INSERT INTO "user" (id,name,email) VALUES ('retained-owner','Retained owner','retained@example.test')`
    await client`INSERT INTO project (id,name,owner_id) VALUES ('retained-project','Retained project','retained-owner')`
    const history = [...await client`SELECT hash,created_at FROM drizzle.__drizzle_migrations ORDER BY id`]
    await migrate(db, { migrationsFolder: '.fixture/migrations' }); await migrate(db, { migrationsFolder: '.fixture/migrations' })
    assert.deepEqual([...await client`SELECT hash,created_at FROM drizzle.__drizzle_migrations ORDER BY id`].slice(0, 6), history)
    assert.equal((await client`SELECT name FROM project WHERE id='retained-project'`)[0]!.name, 'Retained project')
  }
  finally { await rm(upgrade, { recursive: true, force: true }) }
  assert.equal((await client`SELECT * FROM drizzle.__drizzle_migrations`).length, 9)
  await runJobsMigration(); await runJobsDoctor(); await boss.start(); await defineQueues(boss, { op: service.operationJob, receipt: service.receiptJob })
  const ca = await db.transaction(tx => service.createBindingInTransaction(tx, a, { localResourceId: 'client-a', connectionId: 'default', resourceKind: 'client', remoteId: 'client-a' }))
  const cb = await db.transaction(tx => service.createBindingInTransaction(tx, b, { localResourceId: 'client-b', connectionId: 'default', resourceKind: 'client', remoteId: 'client-b' }))
  const ia = await db.transaction(tx => service.createBindingInTransaction(tx, a, { localResourceId: 'invoice-a', connectionId: 'default', resourceKind: 'invoice', remoteId: 'invoice-a' }))
  await assert.rejects(service.requestClientReconciliation(a, { clientBindingId: cb.id }), { code: 'not_found' })
  await assert.rejects(service.getClient(a, { bindingId: ca.id }), { code: 'not_found' }); assert.equal(gets, 0)
  const c = await service.requestClientReconciliation(a, { clientBindingId: ca.id }); assert('operationId' in c); await run(c.operationId)
  assert.deepEqual(Object.keys(await service.getClient(a, { bindingId: ca.id })).sort(), ['bindingId', 'remoteId', 'syncedAt'])
  const refresh = await service.requestInvoiceReconciliation(a, { invoiceBindingId: ia.id }); assert('operationId' in refresh); await run(refresh.operationId)
  await assert.rejects(service.getInvoice(b, { bindingId: ia.id }), { code: 'not_found' })
  const draft = { clientBindingId: ca.id, idempotencyKey: 'ambiguous', invoiceDate: '2026-10-02', numbering: { mode: 'provider' }, lines: [{ description: 'Private financial intent', quantity: '1.000', unitCost: '25.1234' }] }
  await assert.rejects(service.requestDraftInvoice(a, { ...draft, idempotencyKey: 'oversized', lines: Array.from({ length: 100 }, () => ({ description: '😀'.repeat(1000), quantity: '1', unitCost: '25.1234' })) }), { code: 'limit_exceeded' })
  assert.equal(posts, 0, 'Oversized writes reject before ledger dispatch')
  const queued = await service.requestDraftInvoice(a, draft); assert('operationId' in queued)
  const result = await run(queued.operationId); assert.equal(result.status, 'reconciliation_required')
  assert.equal((await service.getOperation(a, { operationId: queued.operationId })).status, 'reconciliation_required')
  await run(queued.operationId); assert.equal(posts, 1)
  const duplicate = await service.requestDraftInvoice(a, draft); assert('id' in duplicate); assert.equal(duplicate.id, queued.operationId)
  await assert.rejects(service.requestDraftInvoice(a, { ...draft, lines: [{ description: 'Changed', quantity: '1', unitCost: '25.1234' }] }), { code: 'conflict' })
  assert.equal((await service.cancelOperation(a, { operationId: queued.operationId })).status, 'reconciliation_required')
  disconnected = false
  const success = await service.requestDraftInvoice(a, { ...draft, idempotencyKey: 'success' }); assert('operationId' in success); await run(success.operationId)
  const completed = await service.getOperation(a, { operationId: success.operationId }); assert.equal(completed.status, 'succeeded'); assert(completed.bindingId)
  assert.equal((await service.getInvoice(a, { bindingId: completed.bindingId })).remoteId, 'draft-child')
  const cancelled = await service.requestClientReconciliation(a, { clientBindingId: ca.id }); assert('operationId' in cancelled)
  await service.cancelOperation(a, { operationId: cancelled.operationId }); const before = gets; await run(cancelled.operationId); assert.equal(gets, before)
  const raw = () => new Response('{"id":"invoice-a","contacts":[{"email":"private@example.test"}]}').body
  await service.receiveWebhook('default', 'invoice-updated', secret, raw()); await service.receiveWebhook('default', 'invoice-updated', secret, raw())
  assert.equal((await db.select().from(inbox)).length, 1)
  const [receipt] = await db.select().from(inbox); amount = '15.1234'; await service.receiptJob.handler({ inboxId: receipt!.id }, context())
  const latest = await service.getInvoice(a, { bindingId: ia.id }); assert('balance' in latest); assert.equal(latest.balance, '15.1234')
  await service.receiveWebhook('default', 'invoice-created', secret, raw()); const newer = (await db.select().from(inbox)).find(r => r.eventKind === 'invoice-created')!
  amount = '0'; await service.receiptJob.handler({ inboxId: newer.id }, context())
  const current = await service.getInvoice(a, { bindingId: ia.id }); assert('balance' in current); assert.equal(current.balance, '0')
  await service.receiveWebhook('default', 'invoice-deleted', secret, raw()); const deletion = (await db.select().from(inbox)).find(r => r.eventKind === 'invoice-deleted')!
  absent = true; await service.receiptJob.handler({ inboxId: deletion.id }, context())
  const tombstone = await service.getInvoice(a, { bindingId: ia.id }); assert('deleted' in tombstone); assert(tombstone.deleted); assert.equal(tombstone.number, 'SAFE-1')
  await service.receiveWebhook('default', 'invoice-sent', secret, new Response('{"id":"unbound","scope":"owner-a"}').body)
  assert.equal((await db.select().from(inbox)).find(r => r.eventKind === 'invoice-sent')!.status, 'ignored')
  const receipts = (await db.select().from(inbox)).length
  const failing = createInvoiceNinjaService({ database: () => db, boss: async () => { throw new Error('fixture enqueue unavailable') }, resolveConnection: async () => connection })
  await assert.rejects(failing.receiveWebhook('default', 'invoice-archived', secret, raw())); assert.equal((await db.select().from(inbox)).length, receipts)
  const revoked = await service.requestClientReconciliation(a, { clientBindingId: ca.id }); assert('operationId' in revoked); authorized = false
  const noFetch = gets; await run(revoked.operationId); assert.equal(gets, noFetch); authorized = true
  const crash = await service.requestDraftInvoice(a, { ...draft, idempotencyKey: 'crash' }); assert('operationId' in crash)
  await db.update(operations).set({ status: 'dispatching', firstDispatchAt: new Date(), leaseUntil: new Date(Date.now() - 1000), attemptToken: randomUUID() }).where(eq(operations.id, crash.operationId))
  await service.recoverExpiredAttempts(); await run(crash.operationId); assert.equal(posts, 2)
  absent = false
  const fenced = await service.requestInvoiceReconciliation(a, { invoiceBindingId: ia.id }); assert('operationId' in fenced)
  await assertCommitFence('operation', fenced.operationId, ia.id, () => run(fenced.operationId))
  assert.equal((await service.getOperation(a, { operationId: fenced.operationId })).status, 'succeeded')
  await service.receiveWebhook('default', 'invoice-updated', secret, new Response('{"id":"invoice-a","fixture":"commit-fence"}').body)
  const fencedReceipt = (await db.select().from(inbox)).find(row => row.status === 'received' && row.eventKind === 'invoice-updated')!
  assert(fencedReceipt)
  await assertCommitFence('receipt', fencedReceipt.id, ia.id, () => service.receiptJob.handler({ inboxId: fencedReceipt.id }, context()))
  assert.equal((await db.select().from(inbox).where(eq(inbox.id, fencedReceipt.id)))[0]!.status, 'processed')
  const jobs = await client.unsafe('SELECT data FROM invoice_fixture_jobs.job')
  for (const job of jobs) assert.ok(Object.keys(job.data).length === 1 && (job.data.operationId || job.data.inboxId))
  const publicData = JSON.stringify({ invoices: await service.listInvoices(a), op: await service.getOperation(a, { operationId: queued.operationId }), output: result })
  for (const forbidden of ['private@example.test', 'Private financial intent', 'private-api-fixture', 'contacts']) assert.ok(!publicData.includes(forbidden))
  await db.transaction(tx => service.retireBindingInTransaction(tx, a, { bindingId: ca.id })); await assert.rejects(service.getClient(a, { bindingId: ca.id }), { code: 'not_found' })
  assert.equal((await db.select().from(bindings)).length, 4)
  await saveState({ databaseName, url: url.toString(), witness: await witness(client), details: await details(client) })
  console.info('Invoice Ninja PostgreSQL ownership/operations/receipts/rollback/crash/privacy passed; mocked provider only')
}
finally { await boss.stop({ graceful: true }); server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); await client.end(); await admin.end() }
