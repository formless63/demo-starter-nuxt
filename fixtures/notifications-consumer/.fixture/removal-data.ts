import assert from 'node:assert/strict'
import pg from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { appendNotification, queryNotifications } from '@repo/nuxt-notifications/server'
import { createJobsBoss, resolveJobsConfig } from '@repo/nuxt-jobs/server'

// Independent witness stays alive through the SAME generic packed removal workflow.
const sourceUrl = process.env.DATABASE_URL
assert(sourceUrl)
const admin = new pg.Pool({ connectionString: sourceUrl, max: 1 })
admin.on('error', () => {})
const name = `notification_removal_${crypto.randomUUID().replaceAll('-', '')}`
await admin.query(`CREATE DATABASE "${name}"`)
const url = new URL(sourceUrl); url.pathname = `/${name}`
const client = new pg.Pool({ connectionString: url.toString(), max: 2 }), db = drizzle(client)
client.on('error', () => {})
const jobs = createJobsBoss({ ...resolveJobsConfig(), databaseUrl: url.toString(), schema: 'notification_removal_jobs' }, true)
try {
  await migrate(db, { migrationsFolder: 'fixtures/notifications-consumer/server/database/migrations' })
  await jobs.start(); await jobs.stop({ graceful: false })
  const record = await appendNotification(db, { recipientId: 'removal-owner', type: 'fixture.retained', title: 'Retained title', body: 'Retained body', metadata: { retained: true } })
  const history = (await client.query('SELECT id,hash,created_at FROM drizzle.__drizzle_migrations ORDER BY id')).rows
  const lifecycle = Bun.spawn(['bun', 'run', 'packages:test', 'notifications'], { env: { ...process.env, DATABASE_URL: url.toString(), PGBOSS_DATABASE_URL: url.toString() }, stdout: 'inherit', stderr: 'inherit' })
  assert.equal(await lifecycle.exited, 0, 'Generic Notifications install/runtime/removal')
  assert.deepEqual((await queryNotifications(db, 'removal-owner')).items, [record], 'Existing notification data survives package removal')
  assert.deepEqual((await client.query('SELECT id,hash,created_at FROM drizzle.__drizzle_migrations ORDER BY id')).rows, history, 'Applied migration history retained')
  assert.equal((await client.query("SELECT count(*)::int AS count FROM pg_namespace WHERE nspname='notification_removal_jobs'")).rows[0]!.count, 1, 'Existing Jobs schema retained')
  console.info('[notifications removal] Existing rows, applied migration history and Jobs retained through generic package lifecycle')
}
finally { await jobs.stop({ graceful: false }); await client.end(); await admin.query(`DROP DATABASE "${name}"`); await admin.end() }
