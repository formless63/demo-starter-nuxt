import { sql } from 'drizzle-orm'
import { pgTable, uuid, varchar, timestamp, jsonb, integer, uniqueIndex, index, check, text } from 'drizzle-orm/pg-core'
import type Stripe from 'stripe'
import type { ErrorCode } from './errors'
export type ResourceKind = 'customer' | 'checkout' | 'payment'
export type OperationKind = 'create_checkout' | 'reconcile_checkout' | 'reconcile_payment'
export type OperationStatus = 'queued' | 'dispatching' | 'succeeded' | 'failed' | 'reconciliation_required' | 'cancelled'
export interface FrozenCheckout { parameters: Stripe.Checkout.SessionCreateParams, accountId: string, mode: 'test' | 'live', customerBindingId: string }
const time = (name: string) => timestamp(name, { withTimezone: true, precision: 3 })
export const stripeBinding = pgTable('stripe_binding', {
  id: uuid('id').primaryKey(), scopeKind: varchar('scope_kind', { length: 6 }).$type<'user' | 'tenant'>().notNull(), scopeId: varchar('scope_id', { length: 128 }).notNull(),
  localResourceId: varchar('local_resource_id', { length: 128 }).notNull(), connectionId: varchar('connection_id', { length: 64 }).notNull(),
  resourceKind: varchar('resource_kind', { length: 8 }).$type<ResourceKind>().notNull(), remoteId: varchar('remote_id', { length: 128 }).notNull(),
  createdAt: time('created_at').notNull().defaultNow(), retiredAt: time('retired_at'), revision: integer('revision').notNull().default(0), leaseToken: uuid('lease_token'), leaseUntil: time('lease_until'),
}, table => [
  uniqueIndex('stripe_binding_local_idx').on(table.scopeKind, table.scopeId, table.localResourceId, table.connectionId, table.resourceKind).where(sql`${table.retiredAt} is null`),
  uniqueIndex('stripe_binding_remote_idx').on(table.connectionId, table.resourceKind, table.remoteId),
  check('stripe_binding_scope_check', sql`${table.scopeKind} in ('user','tenant')`), check('stripe_binding_kind_check', sql`${table.resourceKind} in ('customer','checkout','payment')`),
])
export const stripeOperationLedger = pgTable('stripe_operation', {
  id: uuid('id').primaryKey(), actorUserId: varchar('actor_user_id', { length: 128 }).notNull(), scopeKind: varchar('scope_kind', { length: 6 }).$type<'user' | 'tenant'>().notNull(), scopeId: varchar('scope_id', { length: 128 }).notNull(),
  connectionId: varchar('connection_id', { length: 64 }).notNull(), kind: varchar('kind', { length: 24 }).$type<OperationKind>().notNull(),
  bindingId: uuid('binding_id').notNull().references(() => stripeBinding.id), callerKey: varchar('caller_key', { length: 128 }).notNull(), inputDigest: varchar('input_digest', { length: 64 }).notNull(),
  intent: jsonb('intent').$type<FrozenCheckout | null>(), status: varchar('status', { length: 24 }).$type<OperationStatus>().notNull(),
  resultBindingId: uuid('result_binding_id').references(() => stripeBinding.id), errorCode: varchar('error_code', { length: 32 }).$type<ErrorCode>(),
  firstDispatchAt: time('first_dispatch_at'), leaseToken: uuid('lease_token'), leaseUntil: time('lease_until'), revision: integer('revision').notNull().default(0),
  createdAt: time('created_at').notNull().defaultNow(), updatedAt: time('updated_at').notNull().defaultNow(),
}, table => [
  uniqueIndex('stripe_operation_intent_idx').on(table.scopeKind, table.scopeId, table.connectionId, table.kind, table.callerKey),
  check('stripe_operation_status_check', sql`${table.status} in ('queued','dispatching','succeeded','failed','reconciliation_required','cancelled')`),
  check('stripe_operation_kind_check', sql`${table.kind} in ('create_checkout','reconcile_checkout','reconcile_payment')`),
])
export interface CheckoutProjection { status: 'open' | 'complete' | 'expired' | 'unknown', paymentStatus: 'paid' | 'unpaid' | 'no_payment_required' | 'unknown', currency: string | null, amountTotal: number | null, checkoutUrl: string | null, sourceUpdatedAt: string | null }
export interface PaymentProjection { status: 'requires_payment_method' | 'requires_confirmation' | 'requires_action' | 'processing' | 'requires_capture' | 'canceled' | 'succeeded' | 'unknown', currency: string | null, amount: number | null, amountReceived: number | null, sourceUpdatedAt: string | null }
export const stripeProjection = pgTable('stripe_projection', {
  bindingId: uuid('binding_id').primaryKey().references(() => stripeBinding.id), checkout: jsonb('checkout').$type<CheckoutProjection | null>(), payment: jsonb('payment').$type<PaymentProjection | null>(),
  syncedAt: time('synced_at').notNull(), createdAt: time('created_at').notNull().defaultNow(),
}, table => [index('stripe_projection_created_idx').on(table.createdAt.desc(), table.bindingId.desc())])
export const stripeInbox = pgTable('stripe_inbox', {
  id: uuid('id').primaryKey(), connectionId: varchar('connection_id', { length: 64 }).notNull(), accountId: varchar('account_id', { length: 128 }).notNull(), mode: varchar('mode', { length: 4 }).$type<'test' | 'live'>().notNull(),
  eventId: varchar('event_id', { length: 128 }).notNull(), bodySha256: varchar('body_sha256', { length: 64 }).notNull(), eventType: varchar('event_type', { length: 64 }).notNull(),
  bindingId: uuid('binding_id').references(() => stripeBinding.id), remoteHint: text('remote_hint'),
  status: varchar('status', { length: 12 }).$type<'received' | 'processing' | 'processed' | 'ignored' | 'failed'>().notNull(),
  revision: integer('revision').notNull().default(0), leaseToken: uuid('lease_token'), leaseUntil: time('lease_until'), errorCode: varchar('error_code', { length: 32 }).$type<ErrorCode>(),
  receivedAt: time('received_at').notNull().defaultNow(), updatedAt: time('updated_at').notNull().defaultNow(),
}, table => [uniqueIndex('stripe_inbox_event_idx').on(table.accountId, table.mode, table.eventId), check('stripe_inbox_status_check', sql`${table.status} in ('received','processing','processed','ignored','failed')`)])
export type StripeBinding = typeof stripeBinding.$inferSelect
export type StripeOperation = typeof stripeOperationLedger.$inferSelect
