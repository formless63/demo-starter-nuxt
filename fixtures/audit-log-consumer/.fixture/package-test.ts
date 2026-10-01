import assert from 'node:assert/strict'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'
import * as audit from '@repo/nuxt-audit-log/server'
import { domainRecord } from '../server/database/schema'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is required')
// Own a disposable database, independently of root/API migration histories.
const admin = postgres(databaseUrl, { max: 1 })
const databaseName = `audit_fixture_${crypto.randomUUID().replaceAll('-', '')}`
await admin.unsafe(`CREATE DATABASE "${databaseName}"`)
const url = new URL(databaseUrl)
url.pathname = `/${databaseName}`
const client = postgres(url.toString(), { max: 3 })
const db = drizzle(client)
const event = { actorType: 'user', actorId: 'user-1', action: 'record.created', subjectType: 'record', subjectId: 'record-1', outcome: 'success', metadata: { count: 1 } }

try {
  await migrate(db, { migrationsFolder: './server/database/migrations' })
  await migrate(db, { migrationsFolder: './server/database/migrations' })
  const columns = await client`SELECT column_name, data_type, datetime_precision FROM information_schema.columns WHERE table_name = 'audit_event'`
  assert(columns.some(c => c.column_name === 'created_at' && c.data_type === 'timestamp with time zone' && c.datetime_precision === 3))
  assert(columns.some(c => c.column_name === 'metadata' && c.data_type === 'jsonb'))
  const indexes = await client`SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'audit_event'`
  for (const name of ['audit_event_created_id_idx', 'audit_event_actor_created_id_idx', 'audit_event_subject_created_id_idx', 'audit_event_action_created_id_idx']) {
    assert(indexes.some(i => i.indexname === name && /created_at DESC(?: NULLS LAST)?, id DESC/.test(i.indexdef)))
  }
  assert(indexes.some(i => i.indexname === 'audit_event_action_created_id_idx' && /action, created_at DESC(?: NULLS LAST)?, id DESC/.test(i.indexdef)))
  assert.equal(audit.auditLimits.metadataBytes, 8192)
  for (const action of ['project creation', 'Projects.create', 'projects', 'projects..create', '.create', 'projects.create!']) {
    await assert.rejects(audit.appendAuditEvent(db, { ...event, action }))
    await assert.rejects(audit.queryAuditEvents(db, { action }))
  }
  await db.transaction(async (tx) => {
    await tx.insert(domainRecord).values({ id: 'record-1' })
    await audit.appendAuditEvent(tx, event)
  })
  assert.equal((await db.select().from(domainRecord)).length, 1)
  assert.equal((await audit.queryAuditEvents(db)).items.length, 1)
  await assert.rejects(db.transaction(async (tx) => {
    await tx.insert(domainRecord).values({ id: 'rollback' })
    await audit.appendAuditEvent(tx, { ...event, subjectId: 'rollback' })
    throw new Error('rollback')
  }))
  assert.equal((await db.select().from(domainRecord).where(eq(domainRecord.id, 'rollback'))).length, 0)
  assert.equal((await audit.queryAuditEvents(db, { subject: { type: 'record', id: 'rollback' } })).items.length, 0)
  await assert.rejects(db.transaction(async (tx) => {
    await tx.insert(domainRecord).values({ id: 'invalid' })
    await audit.appendAuditEvent(tx, { ...event, metadata: { nested: { access_token: 'never stored' } } })
  }))
  assert.equal((await db.select().from(domainRecord).where(eq(domainRecord.id, 'invalid'))).length, 0)
  // Transaction timestamp creates ties; UUID descending must break them without gaps.
  await db.transaction(async (tx) => {
    for (let i = 0; i < 7; i++) await audit.appendAuditEvent(tx, { ...event, actorId: 'user-2', action: 'record.updated', outcome: 'denied', subjectId: `record-${i}` })
  })
  const all = await audit.queryAuditEvents(db)
  const ids: string[] = []
  let cursor: string | undefined
  do {
    const page = await audit.queryAuditEvents(db, { pageSize: 2, cursor })
    ids.push(...page.items.map(r => r.id))
    cursor = page.nextCursor ?? undefined
  } while (cursor)
  assert.deepEqual(ids, all.items.map(r => r.id))
  assert.equal(new Set(ids).size, 8)
  for (let i = 1; i < all.items.length; i++) {
    const a = all.items[i - 1]!, b = all.items[i]!
    assert(a.createdAt > b.createdAt || (a.createdAt.getTime() === b.createdAt.getTime() && a.id > b.id))
  }
  assert.equal((await audit.queryAuditEvents(db, { actor: { type: 'user', id: 'user-2' } })).items.length, 7)
  assert.equal((await audit.queryAuditEvents(db, { actor: { type: 'system' } })).items.length, 0)
  assert.equal((await audit.queryAuditEvents(db, { subject: { type: 'record', id: 'record-0' }, action: 'record.updated', outcome: 'denied' })).items.length, 1)
  assert.equal((await audit.queryAuditEvents(db, { action: 'record.created', outcome: 'success' })).items.length, 1)
  const earliest = all.items.at(-1)!.createdAt
  assert.equal((await audit.queryAuditEvents(db, { from: earliest })).items.length, 8)
  assert.equal((await audit.queryAuditEvents(db, { until: earliest })).items.length, 0)
  assert.equal((await audit.queryAuditEvents(db, { from: new Date(Date.now() + 60_000) })).items.length, 0)
  for (const pageSize of [0, -1, 101, 1.5]) await assert.rejects(audit.queryAuditEvents(db, { pageSize }))
  for (const value of ['garbage', '!', 'x'.repeat(257), Buffer.from('[1,"invalid","invalid"]').toString('base64url')]) {
    await assert.rejects(audit.queryAuditEvents(db, { cursor: value }))
  }
  await assert.rejects(audit.queryAuditEvents(db, { from: new Date('invalid') }))
  await assert.rejects(audit.queryAuditEvents(db, { from: earliest, until: earliest }))
  await assert.rejects(audit.queryAuditEvents(db, { from: new Date(earliest.getTime() + 1), until: earliest }))
  for (const key of ['password', 'PASSWORD_HASH', 'secret', 'token', 'authorization', 'Cookie', 'apiKey', 'api_key', 'accessToken', 'refresh-token', 'client.secret', 'credential', 'CLIENT_CREDENTIAL', 'client.credential', 'request', 'r_e_q_u_e_s_t', 'session', 'body', 'header', 'headers']) {
    await assert.rejects(audit.appendAuditEvent(db, { ...event, metadata: { nested: [{ [key]: 'sensitive' }] } }))
  }
  let deep: unknown = {}
  for (let i = 0; i < 7; i++) deep = { next: deep }
  const cycle: Record<string, unknown> = {}; cycle.self = cycle
  const accessor = Object.defineProperty({}, 'value', { enumerable: true, get() { throw new Error('must not invoke') } })
  for (const metadata of [deep, cycle, new Error('private'), { date: new Date() }, { custom: new (class { value = 1 })() }, { value: undefined }, { value: BigInt(1) }, { value: NaN }, { value: Infinity }, { value: () => 1 }, { value: Symbol() }, { value: 'x'.repeat(1025) }, { value: Array(101).fill(1) }, { value: Array(3) }, Object.fromEntries(Array.from({ length: 51 }, (_, i) => [String(i), 1])), { ['x'.repeat(65)]: 1 }, Object.fromEntries(Array.from({ length: 20 }, (_, i) => [String(i), 'x'.repeat(1000)])), { values: Array.from({ length: 100 }, () => Array(10).fill(1)) }, accessor]) {
    await assert.rejects(audit.appendAuditEvent(db, { ...event, metadata }))
  }
  for (const [key, length] of Object.entries({ actorType: 32, actorId: 128, action: 128, subjectType: 64, subjectId: 128, outcome: 32, requestId: 128 })) {
    await assert.rejects(audit.appendAuditEvent(db, { ...event, [key]: 'x'.repeat(length + 1) }))
    await assert.rejects(audit.appendAuditEvent(db, { ...event, [key]: '' }))
  }
  assert.equal((await audit.queryAuditEvents(db)).items.length, 8, 'Rejected events must never insert')
  await audit.appendAuditEvent(db, { ...event, metadata: { ok: [null, true, 1, 'safe', { nested: 'id-1' }] } })
  const override = { ...event, createdAt: new Date('1900-01-01T00:00:00.000Z'), id: crypto.randomUUID(), metadata: { ['x'.repeat(64)]: 'x'.repeat(1024) } }
  const owned = await audit.appendAuditEvent(db, override)
  assert.notEqual(owned.id, override.id, 'Caller cannot override the primitive UUID')
  assert(owned.createdAt.getTime() > Date.now() - 60_000, 'Caller cannot backdate the primitive timestamp')
  assert(!Object.keys(audit).some(key => /update|delete|remove/i.test(key)), 'No mutation/removal public API')
  console.info('[audit fixture] migrations, indexes, append/query, filters/cursors, commit/rollback and metadata safety passed')
}
finally {
  await client.end()
  await admin.unsafe(`DROP DATABASE "${databaseName}"`)
  await admin.end()
}
