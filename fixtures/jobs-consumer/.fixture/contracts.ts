import assert from 'node:assert/strict'
import { drizzle } from 'drizzle-orm/node-postgres'
import { sql } from 'drizzle-orm'
import pg from 'pg'
import { z } from 'zod'
import { createJobsBoss, createJobsClient, defineJob, defineJobRegistry, defineQueues, registerWorkers, sendRegisteredJobInTransaction } from '@repo/nuxt-jobs/server'

export async function verifyJobsContracts(databaseUrl: string) {
  const schema = `jobs_contract_${crypto.randomUUID().replaceAll('-', '')}`
  const config = { databaseUrl, schema, concurrency: 4, useListenNotify: false }
  const connection = new pg.Pool({ connectionString: databaseUrl, max: 2 })
  connection.on('error', () => {})
  const db = drizzle(connection)
  const migrator = createJobsBoss(config, 'migration')
  const producer = createJobsBoss(config, 'producer')
  let worker = createJobsBoss(config, 'worker')
  const attempts: { id: string, retryCount: number, retryLimit?: number, signal: AbortSignal }[] = []
  const signals: AbortSignal[] = []
  const registry = defineJobRegistry(
    defineJob({ name: 'contract.retry', payload: z.object({ value: z.string() }), queue: { retryLimit: 0 },
      send: { retryLimit: 2, retryDelay: 0 }, work: { pollingIntervalSeconds: 0.5 },
      handler: (payload, context) => {
        attempts.push(context)
        if (context.retryCount < 2) throw new Error('retry this attempt')
        return payload
      } }),
    defineJob({ name: 'contract.expire', payload: z.object({}), queue: { retryLimit: 1, retryDelay: 0, expireInSeconds: 1 },
      work: { pollingIntervalSeconds: 0.5 }, handler: async (_payload, context) => {
        signals.push(context.signal)
        await new Promise<void>(resolve => context.signal.addEventListener('abort', () => resolve(), { once: true }))
      } }),
    defineJob({ name: 'contract.shutdown', payload: z.object({}), queue: { retryLimit: 1, retryDelay: 0, expireInSeconds: 30 },
      work: { pollingIntervalSeconds: 0.5 }, handler: async (_payload, context) => {
        if (context.retryCount > 0) return { retried: true }
        signals.push(context.signal)
        await new Promise<void>(resolve => context.signal.addEventListener('abort', () => resolve(), { once: true }))
      } }),
  )
  const lazy = createJobsClient(registry, () => config)
  async function until(check: () => Promise<boolean>, message: string) {
    const deadline = Date.now() + 15_000
    while (Date.now() < deadline) {
      if (await check()) return
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    throw new Error(message)
  }
  try {
    await assert.rejects(lazy.use(), 'A runtime client must refuse an unmigrated schema')
    assert.equal((await connection.query('select 1 from pg_namespace where nspname = $1', [schema])).rows.length, 0, 'Refusal creates no schema')
    await migrator.start(); await migrator.stop({ graceful: false })
    await lazy.use(); await lazy.stop(); await lazy.stop()
    await producer.start(); await worker.start(); await defineQueues(producer, registry)
    assert.equal(producer.isMaintaining(), false); assert.equal(producer.isTimekeeping(), false)
    await registerWorkers(worker, registry, 1)

    // Use a real caller-owned Drizzle transaction; unique schema/table belongs to this fixture.
    await connection.query(`create table "${schema}".application_write (id text primary key)`)
    let committed = ''
    await db.transaction(async (transaction) => {
      await transaction.execute(sql`insert into ${sql.identifier(schema)}.application_write values ('committed')`)
      committed = await sendRegisteredJobInTransaction(producer, registry, transaction, 'contract.retry', { value: 'committed' }, databaseUrl)
    })
    assert(await producer.getJobById('contract.retry', committed))
    let rolledBack = ''
    await assert.rejects(db.transaction(async (transaction) => {
      await transaction.execute(sql`insert into ${sql.identifier(schema)}.application_write values ('rollback')`)
      rolledBack = await sendRegisteredJobInTransaction(producer, registry, transaction, 'contract.retry', { value: 'rollback' }, databaseUrl)
      throw new Error('rollback')
    }), /rollback/)
    assert.equal(await producer.getJobById('contract.retry', rolledBack), null)
    assert.deepEqual((await connection.query(`select id from "${schema}".application_write`)).rows.map(row => row.id), ['committed'])
    const otherDatabase = new URL(databaseUrl); otherDatabase.pathname = '/different_database'
    const other = createJobsBoss({ ...config, databaseUrl: otherDatabase.toString() })
    await assert.rejects(db.transaction(async (transaction) => {
      await transaction.execute(sql`insert into ${sql.identifier(schema)}.application_write values ('refused')`)
      await sendRegisteredJobInTransaction(other, registry, transaction, 'contract.retry', { value: 'refused' }, databaseUrl)
    }), /same canonical host, port and database/)
    assert.deepEqual((await connection.query(`select id from "${schema}".application_write`)).rows.map(row => row.id), ['committed'])
    await until(async () => (await producer.getJobById('contract.retry', committed))?.state === 'completed', 'Native retry exhausted unexpectedly')
    assert.deepEqual(attempts.filter(attempt => attempt.id === committed).map(attempt => [attempt.retryCount, attempt.retryLimit]), [[0, 2], [1, 2], [2, 2]])
    const expired = await producer.send('contract.expire', {})
    await until(async () => (await producer.getJobById('contract.expire', expired!))?.state === 'failed', 'Expiry did not exhaust retries')
    assert.equal((await producer.getJobById('contract.expire', expired!))?.retryCount, 1)
    assert(signals.length >= 2 && signals.every(signal => signal.aborted), 'Native expiry signal reaches handlers')

    const shutdown = await producer.send('contract.shutdown', {})
    await until(async () => (await producer.getJobById('contract.shutdown', shutdown!))?.state === 'active', 'Shutdown job was not claimed')
    await worker.stop({ graceful: true, timeout: 100 })
    assert(signals.at(-1)?.aborted, 'Bounded shutdown aborts native handler signal')
    worker = createJobsBoss(config, 'worker'); await worker.start(); await registerWorkers(worker, registry, 1)
    await until(async () => (await producer.getJobById('contract.shutdown', shutdown!))?.state === 'completed', 'Shutdown cancellation must retain native retry policy')
    assert.equal((await producer.getJobById('contract.shutdown', shutdown!))?.retryCount, 1)
    await worker.stop({ graceful: false })

    // Simulate pending migration version and prove startup never repairs it.
    const version = (await connection.query(`select version from "${schema}".version`)).rows[0]!.version
    await connection.query(`update "${schema}".version set version = $1`, [version - 1])
    for (const role of ['producer', 'reader', 'worker'] as const) {
      const stale = createJobsBoss(config, role)
      try { await assert.rejects(stale.start()) }
      finally { await stale.stop({ graceful: false }) }
    }
    assert.equal((await connection.query(`select version from "${schema}".version`)).rows[0]!.version, version - 1)
    await connection.query(`update "${schema}".version set version = $1`, [version])
    await connection.query(`alter table "${schema}".queue drop column retry_limit`)
    assert.equal((await producer.detectSchemaDrift()).ok, false)
    assert.equal((await connection.query("select 1 from information_schema.columns where table_schema = $1 and table_name = 'queue' and column_name = 'retry_limit'", [schema])).rows.length, 0, 'Doctor does not repair schema')
    console.info('[jobs fixture] roles, commit/rollback/refusal, recovery/shutdown, native retries/expiry/cancellation and drift without DDL passed')
  }
  finally {
    await lazy.stop(); await worker.stop({ graceful: false }); await producer.stop({ graceful: false }); await migrator.stop({ graceful: false })
    await connection.query(`drop schema if exists "${schema}" cascade`)
    await connection.end()
  }
}
