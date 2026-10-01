import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'
import { createJobsBoss, defineJobRegistry, defineQueues, registerWorkers, resolveJobsConfig, sendRegisteredJobInTransaction, sendRegisteredJob } from '@repo/nuxt-jobs/server'
import { runJobsMigration } from '@repo/nuxt-jobs/cli'
import { appendNotification, queryNotifications, markRead, markUnread, getNotification, createNotificationJobs, createNtfyAdapter, NotificationError, validateMetadata } from '@repo/nuxt-notifications/server'
import { domainRecord } from '../server/database/schema'

const databaseUrl = process.env.DATABASE_URL
assert(databaseUrl, 'DATABASE_URL is required')
const admin = postgres(databaseUrl, { max: 1 })
const databaseName = `notifications_fixture_${crypto.randomUUID().replaceAll('-', '')}`
await admin.unsafe(`CREATE DATABASE "${databaseName}"`)
const url = new URL(databaseUrl); url.pathname = `/${databaseName}`
const client = postgres(url.toString(), { max: 5 }), db = drizzle(client)
const previous = { DATABASE_URL: process.env.DATABASE_URL, PGBOSS_DATABASE_URL: process.env.PGBOSS_DATABASE_URL, PGBOSS_SCHEMA: process.env.PGBOSS_SCHEMA }
process.env.DATABASE_URL = url.toString(); process.env.PGBOSS_DATABASE_URL = url.toString(); process.env.PGBOSS_SCHEMA = 'notifications_fixture_jobs'
const input = { recipientId: 'fixture-owner', type: 'fixture.created', title: 'Private title', body: 'Private body ☃', metadata: { reference: 'safe-id' } }
const config = resolveJobsConfig()
const boss = createJobsBoss(config)
const container = `notifications-ntfy-${crypto.randomUUID().slice(0, 8)}`
let ntfyStarted = false
let app: ReturnType<typeof Bun.spawn> | undefined
let appLogs: Promise<string[]> | undefined

try {
  await migrate(db, { migrationsFolder: './server/database/migrations' })
  await migrate(db, { migrationsFolder: './server/database/migrations' })
  const columns = await client`SELECT column_name,data_type,datetime_precision FROM information_schema.columns WHERE table_name='notification'`
  assert(columns.some(c => c.column_name === 'created_at' && c.datetime_precision === 3 && c.data_type === 'timestamp with time zone'))
  assert(columns.some(c => c.column_name === 'read_at' && c.datetime_precision === 3))
  assert(columns.some(c => c.column_name === 'metadata' && c.data_type === 'jsonb'))
  const indexes = await client`SELECT indexname,indexdef FROM pg_indexes WHERE tablename='notification'`
  for (const prefix of ['recipient', 'recipient_read', 'recipient_type']) assert(indexes.some(i => i.indexname === `notification_${prefix}_created_id_idx` && /created_at DESC(?: NULLS LAST)?, id DESC/.test(i.indexdef)))
  await runJobsMigration(); await boss.start()
  const notifications = createNotificationJobs({ load: id => getNotification(db, id) })
  const registry = defineJobRegistry(notifications.delivery)
  await defineQueues(boss, registry)
  const created = await db.transaction(async tx => {
    await tx.insert(domainRecord).values({ id: 'committed' })
    const row = await appendNotification(tx, input)
    await sendRegisteredJobInTransaction(boss, registry, tx, 'notifications.deliver', notifications.prepare(row.id, 'email'))
    return row
  })
  const jobs = await client.unsafe(`SELECT id,data FROM "${config.schema}".job WHERE name='notifications.deliver'`)
  assert.equal(jobs.length, 1)
  assert.deepEqual(jobs[0]!.data, { notificationId: created.id, channel: 'email' })
  assert(!JSON.stringify(jobs).includes(input.title) && !JSON.stringify(jobs).includes(input.recipientId))
  await assert.rejects(db.transaction(async tx => {
    await tx.insert(domainRecord).values({ id: 'rollback' })
    const row = await appendNotification(tx, input)
    await sendRegisteredJobInTransaction(boss, registry, tx, 'notifications.deliver', notifications.prepare(row.id, 'ntfy'))
    throw new Error('rollback')
  }))
  assert.equal((await db.select().from(domainRecord).where(eq(domainRecord.id, 'rollback'))).length, 0)
  assert.equal((await queryNotifications(db, 'fixture-owner')).items.length, 1)
  assert.equal((await client.unsafe(`SELECT id FROM "${config.schema}".job`)).length, 1)
  assert.equal(await markRead(db, 'foreign', created.id), false)
  assert.equal(await markUnread(db, 'foreign', created.id), false)
  assert.equal(await markRead(db, 'foreign', crypto.randomUUID()), false)
  assert.equal(await markRead(db, 'fixture-owner', created.id), true)
  const readAt = (await getNotification(db, created.id))!.readAt!.getTime()
  assert.equal(await markRead(db, 'fixture-owner', created.id), true)
  assert.equal((await getNotification(db, created.id))!.readAt!.getTime(), readAt)
  assert.equal((await queryNotifications(db, 'fixture-owner', { unreadOnly: true })).items.length, 0)
  assert.equal(await markUnread(db, 'fixture-owner', created.id), true)
  assert.equal(await markUnread(db, 'fixture-owner', created.id), true)
  await db.transaction(async tx => { for (let i = 0; i < 30; i++) await appendNotification(tx, { ...input, type: i % 2 ? 'fixture.odd' : 'fixture.even' }) })
  await appendNotification(db, { ...input, recipientId: 'foreign' })
  assert.equal((await queryNotifications(db, 'fixture-owner')).items.length, 25)
  assert.equal((await queryNotifications(db, 'fixture-owner', { type: 'fixture.odd' })).items.length, 15)
  const all = (await queryNotifications(db, 'fixture-owner', { pageSize: 100 })).items
  const ids: string[] = []; let cursor: string | undefined
  do {
    const page = await queryNotifications(db, 'fixture-owner', { pageSize: 3, cursor })
    ids.push(...page.items.map(r => r.id)); cursor = page.nextCursor ?? undefined
  } while (cursor)
  assert.deepEqual(ids, all.map(r => r.id)); assert.equal(new Set(ids).size, 31)
  for (const pageSize of [0, 101, 1.5]) await assert.rejects(queryNotifications(db, 'fixture-owner', { pageSize }))
  for (const cursor of ['!', 'e30', Buffer.from('[2,"2026-01-01T00:00:00.000Z","00000000-0000-0000-0000-000000000000"]').toString('base64url')]) await assert.rejects(queryNotifications(db, 'fixture-owner', { cursor }))
  for (const key of ['password', 'Passwd', 'PWD', 'access_token', 'client.secret', 'authorization', 'cookie', 'api-key', 'credential', 'request', 'session', 'body', 'header', 'headers', '__proto__', 'constructor']) assert.throws(() => validateMetadata({ nested: { [key]: 'private' } }))
  const overrideId = crypto.randomUUID()
  const overridden = await appendNotification(db, { ...input, id: overrideId, createdAt: new Date('1900-01-01'), readAt: new Date() } as typeof input)
  assert.notEqual(overridden.id, overrideId)
  assert.notEqual(overridden.createdAt.getUTCFullYear(), 1900); assert.equal(overridden.readAt, null)
  for (const invalid of [
    { recipientId: '' }, { recipientId: 'x'.repeat(129) }, { title: 'x'.repeat(201) }, { title: 'bad\u0000title' },
    { body: '☃'.repeat(1366) }, { body: 'x'.repeat(4097) }, { body: 'bad\u0000body' }, { type: 'Bad.created' }, { type: 'unqualified' },
  ]) await assert.rejects(appendNotification(db, { ...input, ...invalid }), { code: 'invalid-input' })
  const boundary = await appendNotification(db, { ...input, recipientId: 'x'.repeat(128), title: 'x'.repeat(200), body: 'x'.repeat(4096) })
  assert.equal(Buffer.byteLength(boundary.body), 4096)
  // Real stable local ntfy. No request ever goes to public ntfy.sh.
  execFileSync('docker', ['run', '-d', '--name', container, '-p', '127.0.0.1::80', 'binwiederhier/ntfy:v2.28.0', 'serve', '--listen-http', ':80', '--cache-file', '/tmp/cache.db', '--cache-duration', '1h'], { stdio: 'pipe' })
  ntfyStarted = true
  const binding = execFileSync('docker', ['port', container, '80/tcp'], { encoding: 'utf8' }).trim()
  const ntfyBase = `http://${binding}`
  let ready = false
  for (let i = 0; i < 100; i++) { try { if ((await fetch(`${ntfyBase}/v1/health`)).ok) { ready = true; break } } catch { /* wait */ } await Bun.sleep(100) }
  assert(ready, 'Actual ntfy server ready')
  const topic = `fixture_${crypto.randomUUID().replaceAll('-', '')}`
  const adapter = createNtfyAdapter(async id => id === 'fixture-owner' ? topic : undefined, { env: { NTFY_BASE_URL: ntfyBase } })
  assert.deepEqual(await adapter(created, new AbortController().signal), { outcome: 'delivered' })
  const received = await (await fetch(`${ntfyBase}/${topic}/json?poll=1`)).text()
  const message = received.trim().split('\n').map(line => JSON.parse(line)).find(record => record.event === 'message')
  assert.equal(message.title, input.title); assert.equal(message.message, input.body)
  assert(!received.includes(input.recipientId) && !received.includes('reference'))
  await assert.rejects(adapter({ ...created, recipientId: 'missing' }, new AbortController().signal), { code: 'rejected', retryable: false })
  // Actual pg-boss execution retries safe transient outcomes and settles permanent ones.
  let attempts = 0
  const delivering = createNotificationJobs({ load: id => getNotification(db, id), adapters: { ntfy: async (...args) => { if (++attempts === 1) throw new NotificationError('unavailable', true); return adapter(...args) }, email: async () => ({ outcome: 'rejected' }) } })
  // Verify canonical defaults, then shorten test retry timing only on the local definition.
  assert.deepEqual(delivering.delivery.send, { retryLimit: 5, retryDelay: 30, retryBackoff: true, retryDelayMax: 900, expireInSeconds: 60, retentionSeconds: 86400, deleteAfterSeconds: 86400 })
  delivering.delivery.send = { ...delivering.delivery.send, retryDelay: 1 }
  const executing = defineJobRegistry(delivering.delivery)
  await registerWorkers(boss, executing, 1)
  const id = await sendRegisteredJob(boss, executing, 'notifications.deliver', delivering.prepare(created.id, 'ntfy'))
  let completed = false
  for (let i = 0; i < 300; i++) { const job = await boss.getJobById('notifications.deliver', id); if (job?.state === 'completed') { assert.deepEqual(job.output, { outcome: 'delivered' }); completed = true; break } await Bun.sleep(100) }
  assert(completed && attempts === 2, 'Real retry and current-target reload')
  const permanent = await boss.getJobById('notifications.deliver', jobs[0]!.id)
  assert.equal(permanent?.state, 'completed')
  assert.equal(permanent?.retryCount, 0, 'Permanent Email rejection settles without retries')
  assert.deepEqual(permanent?.output, { outcome: 'rejected', code: 'rejected' })
  // Optional adapters and even DB configuration are unnecessary for normal boot.
  const port = 31000 + Math.floor(Math.random() * 10000)
  app = Bun.spawn(['node', '.output/server/index.mjs'], { env: { ...process.env, DATABASE_URL: '', NTFY_BASE_URL: '', NTFY_TOKEN: '', NITRO_HOST: '127.0.0.1', NITRO_PORT: String(port) }, stdout: 'pipe', stderr: 'pipe' })
  appLogs = Promise.all([new Response(app.stdout).text(), new Response(app.stderr).text()])
  ready = false
  for (let i = 0; i < 100; i++) { try { if ((await fetch(`http://127.0.0.1:${port}`)).ok) { ready = true; break } } catch { /* wait */ } await Bun.sleep(100) }
  assert(ready, 'Backendless build/start with no optional adapters')
  console.info('[notifications fixture] migrations, indexes, isolation, read/unread, cursor, atomic Jobs rollback/retry/privacy, ntfy 2.28.0 and backendless boot passed')
}
finally {
  if (app) { app.kill('SIGTERM'); await app.exited }
  const logs = (await appLogs)?.join('') ?? ''
  assert(!logs.includes(input.title) && !logs.includes(input.body))
  if (ntfyStarted) execFileSync('docker', ['rm', '-f', container], { stdio: 'pipe' })
  await boss.stop({ graceful: true, timeout: 5000 })
  await client.end()
  await admin.unsafe(`DROP DATABASE "${databaseName}"`); await admin.end()
  for (const [key, value] of Object.entries(previous)) { if (value === undefined) Reflect.deleteProperty(process.env, key); else process.env[key] = value }
}
