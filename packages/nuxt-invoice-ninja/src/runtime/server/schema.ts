import { sql } from 'drizzle-orm'
import { check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core'
import type { Scope, DraftInput } from './validation'
import type { ErrorCode } from './errors'
export type OperationKind = 'create_draft' | 'reconcile_invoice' | 'reconcile_client'
export type OperationStatus = 'queued' | 'dispatching' | 'succeeded' | 'failed' | 'reconciliation_required' | 'cancelled'
export type InboxStatus = 'received' | 'processing' | 'processed' | 'ignored' | 'failed'
export type InvoiceStatus = 'draft' | 'sent' | 'partial' | 'paid' | 'cancelled' | 'reversed' | 'deleted' | 'unknown'
export interface InvoiceProjection {
  bindingId: string, remoteId: string, number: string | null, status: InvoiceStatus, currency: string | null,
  amount: string | null, balance: string | null, sourceUpdatedAt: string | null, syncedAt: string, deleted: boolean,
}
export interface ClientProjection { bindingId: string, remoteId: string, syncedAt: string }
export interface DraftPolicy { currencyId: string, currency: string, configurationIdentity: string, numericStringEncodingVerified: true, unsentZeroTaxDiscountVerified: true }
export interface FrozenDraft { input: DraftInput, policy: DraftPolicy, remoteClientId: string }
const time = (name: string) => timestamp(name, { withTimezone: true, precision: 3 })
const scope = () => ({ scopeKind: varchar('scope_kind', { length: 6 }).$type<Scope['kind']>().notNull(), scopeId: varchar('scope_id', { length: 128 }).notNull() })
export const invoiceNinjaBinding = pgTable('invoice_ninja_binding', {
  id: uuid('id').primaryKey(), ...scope(), localResourceId: varchar('local_resource_id', { length: 128 }).notNull(),
  connectionId: varchar('connection_id', { length: 64 }).notNull(), resourceKind: varchar('resource_kind', { length: 7 }).$type<'client' | 'invoice'>().notNull(),
  remoteId: varchar('remote_id', { length: 128 }).notNull(), createdAt: time('created_at').defaultNow().notNull(), retiredAt: time('retired_at'),
  revision: integer('revision').default(0).notNull(), leaseToken: uuid('lease_token'), leaseUntil: time('lease_until'),
}, t => [
  uniqueIndex('invoice_ninja_binding_local_idx').on(t.scopeKind, t.scopeId, t.localResourceId, t.resourceKind).where(sql`${t.retiredAt} IS NULL`),
  uniqueIndex('invoice_ninja_binding_remote_idx').on(t.connectionId, t.resourceKind, t.remoteId),
  check('invoice_ninja_binding_scope_check', sql`${t.scopeKind} IN ('user','tenant')`),
  check('invoice_ninja_binding_kind_check', sql`${t.resourceKind} IN ('client','invoice')`),
])
export const invoiceNinjaProjection = pgTable('invoice_ninja_projection', {
  bindingId: uuid('binding_id').primaryKey().references(() => invoiceNinjaBinding.id),
  value: jsonb('value').$type<ClientProjection | InvoiceProjection>().notNull(), syncedAt: time('synced_at').notNull(),
})
export const invoiceNinjaOperation = pgTable('invoice_ninja_operation', {
  id: uuid('id').primaryKey(), ...scope(), actorUserId: varchar('actor_user_id', { length: 128 }).notNull(),
  connectionId: varchar('connection_id', { length: 64 }).notNull(), kind: varchar('kind', { length: 24 }).$type<OperationKind>().notNull(),
  callerKey: varchar('caller_key', { length: 128 }).notNull(), digest: varchar('digest', { length: 64 }).notNull(),
  bindingId: uuid('binding_id').notNull().references(() => invoiceNinjaBinding.id), resultBindingId: uuid('result_binding_id').references(() => invoiceNinjaBinding.id),
  intent: jsonb('intent').$type<FrozenDraft | null>(), status: varchar('status', { length: 24 }).$type<OperationStatus>().default('queued').notNull(),
  knownRemoteId: varchar('known_remote_id', { length: 128 }), errorCode: varchar('error_code', { length: 32 }).$type<ErrorCode>(),
  revision: integer('revision').default(0).notNull(), attemptToken: uuid('attempt_token'), leaseUntil: time('lease_until'), firstDispatchAt: time('first_dispatch_at'),
  createdAt: time('created_at').defaultNow().notNull(), updatedAt: time('updated_at').defaultNow().notNull(),
}, t => [
  uniqueIndex('invoice_ninja_operation_key_idx').on(t.scopeKind, t.scopeId, t.connectionId, t.kind, t.callerKey),
  index('invoice_ninja_operation_lease_idx').on(t.status, t.leaseUntil),
  check('invoice_ninja_operation_kind_check', sql`${t.kind} IN ('create_draft','reconcile_invoice','reconcile_client')`),
  check('invoice_ninja_operation_status_check', sql`${t.status} IN ('queued','dispatching','succeeded','failed','reconciliation_required','cancelled')`),
])
export const invoiceNinjaInbox = pgTable('invoice_ninja_inbox', {
  id: uuid('id').primaryKey(), connectionId: varchar('connection_id', { length: 64 }).notNull(),
  eventKind: varchar('event_kind', { length: 32 }).notNull(), bodySHA256: varchar('body_sha256', { length: 64 }).notNull(),
  remoteHint: varchar('remote_hint', { length: 128 }), bindingId: uuid('binding_id').references(() => invoiceNinjaBinding.id),
  status: varchar('status', { length: 16 }).$type<InboxStatus>().default('received').notNull(), revision: integer('revision').default(0).notNull(),
  attemptToken: uuid('attempt_token'), leaseUntil: time('lease_until'), errorCode: varchar('error_code', { length: 32 }).$type<ErrorCode>(),
  receivedAt: time('received_at').defaultNow().notNull(), updatedAt: time('updated_at').defaultNow().notNull(),
}, t => [uniqueIndex('invoice_ninja_inbox_receipt_idx').on(t.connectionId, t.eventKind, t.bodySHA256),
  check('invoice_ninja_inbox_status_check', sql`${t.status} IN ('received','processing','processed','ignored','failed')`),
])
export type Binding = typeof invoiceNinjaBinding.$inferSelect
export type Operation = typeof invoiceNinjaOperation.$inferSelect
