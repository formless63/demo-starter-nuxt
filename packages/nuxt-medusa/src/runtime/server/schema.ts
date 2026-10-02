import { sql } from 'drizzle-orm'
import { pgTable, uuid, varchar, timestamp, integer, jsonb, uniqueIndex, index, check } from 'drizzle-orm/pg-core'
import type { Projection } from './projections'
import type { ErrorCode } from './errors'
export type ResourceKind = 'product' | 'order'
export type OperationKind = 'reconcile_product' | 'reconcile_order' | 'sync_product_page' | 'sync_order_page'
export type OperationStatus = 'queued' | 'dispatching' | 'succeeded' | 'failed' | 'reconciliation_required' | 'cancelled'
export type InboxStatus = 'received' | 'processing' | 'processed' | 'ignored' | 'failed'
const time = (name: string) => timestamp(name, { withTimezone: true, precision: 3 })
export const medusaBinding = pgTable('medusa_binding', {
  id: uuid('id').primaryKey(), scopeKind: varchar('scope_kind', { length: 6 }).$type<'user' | 'tenant'>().notNull(),
  scopeId: varchar('scope_id', { length: 128 }).notNull(), localResourceId: varchar('local_resource_id', { length: 128 }).notNull(),
  connectionId: varchar('connection_id', { length: 64 }).notNull(), resourceKind: varchar('resource_kind', { length: 7 }).$type<ResourceKind>().notNull(),
  remoteId: varchar('remote_id', { length: 128 }).notNull(), createdAt: time('created_at').notNull().defaultNow(), retiredAt: time('retired_at'),
  revision: integer('revision').notNull().default(0), attemptToken: uuid('attempt_token'), leaseExpiresAt: time('lease_expires_at'),
}, t => [
  uniqueIndex('medusa_binding_local_idx').on(t.scopeKind, t.scopeId, t.resourceKind, t.localResourceId),
  uniqueIndex('medusa_binding_remote_idx').on(t.connectionId, t.resourceKind, t.remoteId),
  index('medusa_binding_scope_idx').on(t.scopeKind, t.scopeId, t.resourceKind, t.createdAt.desc(), t.id.desc()),
  check('medusa_binding_scope_check', sql`${t.scopeKind} in ('user','tenant')`),
  check('medusa_binding_kind_check', sql`${t.resourceKind} in ('product','order')`),
])
export const medusaProjection = pgTable('medusa_projection', {
  bindingId: uuid('binding_id').primaryKey().references(() => medusaBinding.id),
  data: jsonb('data').$type<Projection>().notNull(), syncedAt: time('synced_at').notNull(), revision: integer('revision').notNull(),
})
export const medusaOperation = pgTable('medusa_operation', {
  id: uuid('id').primaryKey(), actorUserId: varchar('actor_user_id', { length: 128 }).notNull(),
  scopeKind: varchar('scope_kind', { length: 6 }).$type<'user' | 'tenant'>().notNull(), scopeId: varchar('scope_id', { length: 128 }).notNull(),
  connectionId: varchar('connection_id', { length: 64 }).notNull(), kind: varchar('kind', { length: 20 }).$type<OperationKind>().notNull(),
  status: varchar('status', { length: 24 }).$type<OperationStatus>().notNull(), bindingId: uuid('binding_id').references(() => medusaBinding.id),
  callerKey: varchar('caller_key', { length: 128 }).notNull(), digest: varchar('digest', { length: 64 }).notNull(),
  intent: jsonb('intent').$type<{ kind: ResourceKind, limit?: number, offset?: number }>().notNull(),
  progress: integer('progress').notNull().default(0), nextCursor: varchar('next_cursor', { length: 2048 }),
  revision: integer('revision').notNull().default(0), attemptToken: uuid('attempt_token'), leaseExpiresAt: time('lease_expires_at'),
  firstDispatchAt: time('first_dispatch_at'), errorCode: varchar('error_code', { length: 32 }).$type<ErrorCode>(),
  createdAt: time('created_at').notNull().defaultNow(), updatedAt: time('updated_at').notNull().defaultNow(),
}, t => [
  uniqueIndex('medusa_operation_key_idx').on(t.scopeKind, t.scopeId, t.connectionId, t.kind, t.callerKey),
  index('medusa_operation_scope_idx').on(t.scopeKind, t.scopeId, t.createdAt.desc(), t.id.desc()),
  check('medusa_operation_scope_check', sql`${t.scopeKind} in ('user','tenant')`),
  check('medusa_operation_kind_check', sql`${t.kind} in ('reconcile_product','reconcile_order','sync_product_page','sync_order_page')`),
  check('medusa_operation_status_check', sql`${t.status} in ('queued','dispatching','succeeded','failed','reconciliation_required','cancelled')`),
  check('medusa_operation_progress_check', sql`${t.progress} between 0 and 100`),
])
export const medusaInbox = pgTable('medusa_inbox', {
  id: uuid('id').primaryKey(), connectionId: varchar('connection_id', { length: 64 }).notNull(), eventId: uuid('event_id').notNull(),
  bodySha256: varchar('body_sha256', { length: 64 }).notNull(), eventType: varchar('event_type', { length: 20 }).notNull(),
  remoteHint: varchar('remote_hint', { length: 128 }), bindingId: uuid('binding_id').references(() => medusaBinding.id),
  status: varchar('status', { length: 10 }).$type<InboxStatus>().notNull(),
  revision: integer('revision').notNull().default(0), attemptToken: uuid('attempt_token'), leaseExpiresAt: time('lease_expires_at'),
  errorCode: varchar('error_code', { length: 32 }).$type<ErrorCode>(),
  receivedAt: time('received_at').notNull().defaultNow(), updatedAt: time('updated_at').notNull().defaultNow(),
}, t => [
  uniqueIndex('medusa_inbox_receipt_idx').on(t.connectionId, t.eventId),
  check('medusa_inbox_status_check', sql`${t.status} in ('received','processing','processed','ignored','failed')`),
  check('medusa_inbox_event_check', sql`${t.eventType} in ('product.created','product.updated','product.deleted','order.placed','unknown')`),
])
export type Binding = typeof medusaBinding.$inferSelect
export type Operation = typeof medusaOperation.$inferSelect
export type Inbox = typeof medusaInbox.$inferSelect
