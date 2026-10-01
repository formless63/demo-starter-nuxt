import { randomUUID } from 'node:crypto'
import { Buffer } from 'node:buffer'
import { and, desc, eq, gte, lt, or } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import { auditEvent } from './schema'
import { auditAction, auditDate, boundedString, validateMetadata } from './validation'

// Only the required Drizzle operations; both databases and existing transactions fit.
type AuditWriter = Pick<PgDatabase<PgQueryResultHKT>, 'insert'>
type AuditReader = Pick<PgDatabase<PgQueryResultHKT>, 'select'>
export interface AuditActor { type: string, id?: string }
export interface AuditSubject { type: string, id?: string }
export interface AuditEventInput {
  actorType: string
  actorId?: string
  action: string
  subjectType: string
  subjectId?: string
  outcome?: string
  requestId?: string
  metadata?: unknown
}

function optional(value: unknown, max: number) {
  return value === undefined ? undefined : boundedString(value, max)
}

export async function appendAuditEvent(txOrDb: AuditWriter, event: AuditEventInput) {
  const values = {
    id: randomUUID(),
    actorType: boundedString(event.actorType, 32),
    actorId: optional(event.actorId, 128),
    action: auditAction(event.action),
    subjectType: boundedString(event.subjectType, 64),
    subjectId: optional(event.subjectId, 128),
    outcome: optional(event.outcome, 32),
    requestId: optional(event.requestId, 128),
    metadata: validateMetadata(event.metadata),
  }
  const [row] = await txOrDb.insert(auditEvent).values(values).returning()
  return row!
}

export interface AuditQuery {
  actor?: AuditActor
  subject?: AuditSubject
  action?: string
  outcome?: string
  from?: Date
  until?: Date
  pageSize?: number
  cursor?: string
}

function decodeCursor(value: string) {
  try {
    boundedString(value, 256)
    if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error()
    const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown
    if (!Array.isArray(decoded) || decoded.length !== 3 || decoded[0] !== 1
      || typeof decoded[1] !== 'string' || typeof decoded[2] !== 'string'
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(decoded[2])) throw new Error()
    const date = auditDate(new Date(decoded[1]))
    if (date.toISOString() !== decoded[1]
      || Buffer.from(JSON.stringify(decoded)).toString('base64url') !== value) throw new Error()
    return { createdAt: date, id: decoded[2] }
  }
  catch {
    throw new TypeError('Invalid audit cursor')
  }
}

/** Newest first; from inclusive, until exclusive. Cursor is opaque, not authorization. */
export async function queryAuditEvents(db: AuditReader, query: AuditQuery = {}) {
  const size = query.pageSize ?? 50
  if (!Number.isInteger(size) || size < 1 || size > 100) throw new TypeError('Invalid audit page size')
  const from = query.from === undefined ? undefined : auditDate(query.from)
  const until = query.until === undefined ? undefined : auditDate(query.until)
  if (from && until && from >= until) throw new TypeError('Invalid audit time range')
  const conditions = []
  if (query.actor !== undefined) {
    conditions.push(eq(auditEvent.actorType, boundedString(query.actor.type, 32)))
    if (query.actor.id !== undefined) conditions.push(eq(auditEvent.actorId, boundedString(query.actor.id, 128)))
  }
  if (query.subject !== undefined) {
    conditions.push(eq(auditEvent.subjectType, boundedString(query.subject.type, 64)))
    if (query.subject.id !== undefined) conditions.push(eq(auditEvent.subjectId, boundedString(query.subject.id, 128)))
  }
  if (query.action !== undefined) conditions.push(eq(auditEvent.action, auditAction(query.action)))
  if (query.outcome !== undefined) conditions.push(eq(auditEvent.outcome, boundedString(query.outcome, 32)))
  if (from) conditions.push(gte(auditEvent.createdAt, from))
  if (until) conditions.push(lt(auditEvent.createdAt, until))
  if (query.cursor !== undefined) {
    const cursor = decodeCursor(query.cursor)
    conditions.push(or(lt(auditEvent.createdAt, cursor.createdAt), and(eq(auditEvent.createdAt, cursor.createdAt), lt(auditEvent.id, cursor.id)))!)
  }
  const rows = await db.select().from(auditEvent).where(and(...conditions))
    .orderBy(desc(auditEvent.createdAt), desc(auditEvent.id)).limit(size + 1)
  const items = rows.slice(0, size)
  const last = items.at(-1)
  const nextCursor = rows.length > size && last
    ? Buffer.from(JSON.stringify([1, last.createdAt.toISOString(), last.id])).toString('base64url')
    : null
  return { items, nextCursor }
}
