import { bigint, index, integer, jsonb, pgTable, timestamp, uniqueIndex, uuid, varchar, text, check } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import type { TransferErrorCode, ValidationIssue } from './errors'
export type TransferStatus = 'uploading' | 'staged' | 'pending' | 'succeeded' | 'failed' | 'cancelled'
export const transfer = pgTable('transfer', {
  id: uuid('id').primaryKey(), requesterId: varchar('requester_id', { length: 128 }).notNull(),
  scopeKind: varchar('scope_kind', { length: 6 }).$type<'user' | 'tenant'>().notNull(), scopeId: varchar('scope_id', { length: 128 }).notNull(),
  definition: varchar('definition', { length: 64 }).notNull(), version: varchar('version', { length: 64 }).notNull(),
  direction: varchar('direction', { length: 6 }).$type<'import' | 'export'>().notNull(),
  status: varchar('status', { length: 12 }).$type<TransferStatus>().notNull(),
  idempotencyKey: varchar('idempotency_key', { length: 128 }), fingerprint: varchar('fingerprint', { length: 256 }),
  sourceKey: text('source_key'), sourceHash: varchar('source_hash', { length: 64 }), sourceBytes: bigint('source_bytes', { mode: 'number' }),
  artifactKeys: jsonb('artifact_keys').$type<string[]>().notNull().default([]),
  artifactKey: text('artifact_key'), artifactExpiresAt: timestamp('artifact_expires_at', { withTimezone: true, precision: 3 }),
  jobId: uuid('job_id'), rowCount: integer('row_count'), byteCount: bigint('byte_count', { mode: 'number' }),
  errorCode: varchar('error_code', { length: 32 }).$type<TransferErrorCode>(),
  validationIssues: jsonb('validation_issues').$type<ValidationIssue[]>().notNull().default([]), errorsTruncated: integer('errors_truncated').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true, precision: 3 }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, precision: 3 }).notNull().defaultNow(),
  startedAt: timestamp('started_at', { withTimezone: true, precision: 3 }), completedAt: timestamp('completed_at', { withTimezone: true, precision: 3 }),
  snapshotAt: timestamp('snapshot_at', { withTimezone: true, precision: 3 }),
}, table => [
  uniqueIndex('transfer_request_idempotency_idx').on(table.requesterId, table.scopeKind, table.scopeId, table.direction, table.idempotencyKey),
  index('transfer_visibility_created_idx').on(table.requesterId, table.scopeKind, table.scopeId, table.createdAt.desc(), table.id.desc()),
  check('transfer_scope_check', sql`${table.scopeKind} in ('user', 'tenant')`),
  check('transfer_direction_check', sql`${table.direction} in ('import', 'export')`),
  check('transfer_status_check', sql`${table.status} in ('uploading', 'staged', 'pending', 'succeeded', 'failed', 'cancelled')`),
])
export type TransferRecord = typeof transfer.$inferSelect
