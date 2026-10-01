import assert from 'node:assert/strict'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { appendNotification, queryNotifications } from '@repo/nuxt-notifications/server'
import { createJobsBoss, resolveJobsConfig } from '@repo/nuxt-jobs/server'

// Independent witness stays alive through the SAME generic packed removal workflow.
const sourceUrl = process.env.DATABASE_URL
assert(sourceUrl)
const admin = postgres(sourceUrl, { max: 1 })
const name = `notification_removal_${crypto.randomUUID().replaceAll('-', '')}`
await admin.unsafe(`CREATE DATABASE "${name}"`)
const url = new URL(sourceUrl); url.pathname = `/${name}`
const client = postgres(url.toString(), { max: 2 }), db = drizzle(client)
const jobs = createJobsBoss({ ...resolveJobsConfig(), databaseUrl: url.toString(), schema: 'notification_removal_jobs' }, true)
try {
  await migrate(db, { migrationsFolder: 'fixtures/notifications-consumer/server/database/migrations' })
  await jobs.start(); await jobs.stop({ graceful: false })
  const record = await appendNotification(db, { recipientId: 'removal-owner', type: 'fixture.retained', title: 'Retained title', body: 'Retained body', metadata: { retained: true } })
  const history = await client`SELECT id,hash,created_at FROM drizzle.__drizzle_migrations ORDER BY id`
  const lifecycle = Bun.spawn(['bun', 'run', 'packages:test', 'notifications'], { env: { ...process.env, DATABASE_URL: url.toString(), PGBOSS_DATABASE_URL: url.toString() }, stdout: 'inherit', stderr: 'inherit' })
  assert.equal(await lifecycle.exited, 0, 'Generic Notifications install/runtime/removal')
  assert.deepEqual((await queryNotifications(db, 'removal-owner')).items, [record], 'Existing notification data survives package removal')
  assert.deepEqual(await client`SELECT id,hash,created_at FROM drizzle.__drizzle_migrations ORDER BY id`, history, 'Applied migration history retained')
  assert.equal((await client`SELECT count(*)::int AS count FROM pg_namespace WHERE nspname='notification_removal_jobs'`)[0]!.count, 1, 'Existing Jobs schema retained')
  console.info('[notifications removal] Existing rows, applied migration history and Jobs retained through generic package lifecycle')
}
finally { await jobs.stop({ graceful: false }); await client.end(); await admin.unsafe(`DROP DATABASE "${name}"`); await admin.end() }
