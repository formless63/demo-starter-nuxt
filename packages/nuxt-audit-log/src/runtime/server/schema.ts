import { index, jsonb, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'
import type { AuditMetadata } from './validation'

export const auditEvent = pgTable('audit_event', {
  id: uuid('id').primaryKey(),
  createdAt: timestamp('created_at', { withTimezone: true, precision: 3 }).defaultNow().notNull(),
  actorType: varchar('actor_type', { length: 32 }).notNull(),
  actorId: varchar('actor_id', { length: 128 }),
  action: varchar('action', { length: 128 }).notNull(),
  subjectType: varchar('subject_type', { length: 64 }).notNull(),
  subjectId: varchar('subject_id', { length: 128 }),
  outcome: varchar('outcome', { length: 32 }),
  requestId: varchar('request_id', { length: 128 }),
  metadata: jsonb('metadata').$type<AuditMetadata>().default({}).notNull(),
}, table => [
  index('audit_event_created_id_idx').on(table.createdAt.desc(), table.id.desc()),
  index('audit_event_actor_created_id_idx').on(table.actorType, table.actorId, table.createdAt.desc(), table.id.desc()),
  index('audit_event_subject_created_id_idx').on(table.subjectType, table.subjectId, table.createdAt.desc(), table.id.desc()),
])
