import { randomUUID } from 'node:crypto'
import { and, desc, eq, isNull, lt, or, sql } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import { notification } from './schema'
import { boundedString, notificationDate, notificationType, validateMetadata } from './validation'
import { NotificationError } from './errors'

type Writer = Pick<PgDatabase<PgQueryResultHKT>, 'insert'>
type Reader = Pick<PgDatabase<PgQueryResultHKT>, 'select'>
type Updater = Pick<PgDatabase<PgQueryResultHKT>, 'update'>
export interface NotificationInput { recipientId: string, type: string, title: string, body: string, metadata?: unknown }
export interface NotificationQuery { unreadOnly?: boolean, type?: string, pageSize?: number, cursor?: string }
export function notificationId(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)) throw new NotificationError('invalid-input')
  return value
}
function plainBody(value: unknown) {
  if (typeof value !== 'string' || !value.isWellFormed() || Buffer.byteLength(value) > 4096
    || Array.from(value).some(c => { const code = c.charCodeAt(0); return (code < 32 && ![9, 10, 13].includes(code)) || (code >= 127 && code <= 159) })) throw new NotificationError('invalid-input')
  return value
}
export async function appendNotification(txOrDb: Writer, input: NotificationInput) {
  const [row] = await txOrDb.insert(notification).values({
    id: randomUUID(), recipientId: boundedString(input.recipientId, 128), type: notificationType(input.type),
    title: boundedString(input.title, 200), body: plainBody(input.body), metadata: validateMetadata(input.metadata),
  }).returning()
  return row!
}
export async function getNotification(db: Reader, id: string) {
  const [row] = await db.select().from(notification).where(eq(notification.id, notificationId(id))).limit(1)
  return row
}
function decodeCursor(value: string) {
  try {
    boundedString(value, 256)
    if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new NotificationError('invalid-input')
    const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown
    if (!Array.isArray(decoded) || decoded.length !== 3 || decoded[0] !== 1 || typeof decoded[1] !== 'string') throw new NotificationError('invalid-input')
    const id = notificationId(decoded[2]), createdAt = notificationDate(new Date(decoded[1]))
    if (createdAt.toISOString() !== decoded[1] || Buffer.from(JSON.stringify(decoded)).toString('base64url') !== value) throw new NotificationError('invalid-input')
    return { id, createdAt }
  }
  catch { throw new NotificationError('invalid-input') }
}
export async function queryNotifications(db: Reader, recipientId: string, query: NotificationQuery = {}) {
  const size = query.pageSize ?? 25
  if (!Number.isInteger(size) || size < 1 || size > 100 || (query.unreadOnly !== undefined && typeof query.unreadOnly !== 'boolean')) throw new NotificationError('invalid-input')
  const conditions = [eq(notification.recipientId, boundedString(recipientId, 128))]
  if (query.unreadOnly) conditions.push(isNull(notification.readAt))
  if (query.type !== undefined) conditions.push(eq(notification.type, notificationType(query.type)))
  if (query.cursor !== undefined) {
    const cursor = decodeCursor(query.cursor)
    conditions.push(or(lt(notification.createdAt, cursor.createdAt), and(eq(notification.createdAt, cursor.createdAt), lt(notification.id, cursor.id)))!)
  }
  const rows = await db.select().from(notification).where(and(...conditions)).orderBy(desc(notification.createdAt), desc(notification.id)).limit(size + 1)
  const items = rows.slice(0, size), last = items.at(-1)
  return { items, nextCursor: rows.length > size && last ? Buffer.from(JSON.stringify([1, last.createdAt.toISOString(), last.id])).toString('base64url') : null }
}
async function setRead(db: Updater, recipientId: string, id: string, read: boolean) {
  const rows = await db.update(notification).set({ readAt: read ? sql`COALESCE(${notification.readAt}, CURRENT_TIMESTAMP)` : null })
    .where(and(eq(notification.id, notificationId(id)), eq(notification.recipientId, boundedString(recipientId, 128)))).returning({ id: notification.id })
  return rows.length === 1
}
export function markRead(db: Updater, recipientId: string, id: string) { return setRead(db, recipientId, id, true) }
export function markUnread(db: Updater, recipientId: string, id: string) { return setRead(db, recipientId, id, false) }
