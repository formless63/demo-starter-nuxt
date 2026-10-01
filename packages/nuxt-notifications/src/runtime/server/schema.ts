import { index, jsonb, pgTable, timestamp, uuid, varchar, text } from 'drizzle-orm/pg-core'
import type { NotificationMetadata } from './validation'
export const notification = pgTable('notification', {
  id: uuid('id').primaryKey(),
  recipientId: varchar('recipient_id', { length: 128 }).notNull(),
  type: varchar('type', { length: 128 }).notNull(),
  title: varchar('title', { length: 200 }).notNull(),
  body: text('body').notNull(),
  metadata: jsonb('metadata').$type<NotificationMetadata>().default({}).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, precision: 3 }).defaultNow().notNull(),
  readAt: timestamp('read_at', { withTimezone: true, precision: 3 }),
}, table => [
  index('notification_recipient_created_id_idx').on(table.recipientId, table.createdAt.desc(), table.id.desc()),
  index('notification_recipient_read_created_id_idx').on(table.recipientId, table.readAt, table.createdAt.desc(), table.id.desc()),
  index('notification_recipient_type_created_id_idx').on(table.recipientId, table.type, table.createdAt.desc(), table.id.desc()),
])
export type NotificationRecord = typeof notification.$inferSelect
