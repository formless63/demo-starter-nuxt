import { flagDefinition, flagOverride } from '@repo/nuxt-feature-flags/schema'
import { roleAssignment } from '@repo/nuxt-authorization/schema'
import { organization, member, invitation, activeOrganizationId } from '@repo/nuxt-organizations/schema'
import { invoiceNinjaBinding, invoiceNinjaProjection, invoiceNinjaOperation, invoiceNinjaInbox } from '@repo/nuxt-invoice-ninja/schema'
import { stripeBinding, stripeOperationLedger, stripeProjection, stripeInbox } from '@repo/nuxt-stripe/schema'
import { medusaBinding, medusaProjection, medusaOperation, medusaInbox } from '@repo/nuxt-medusa/schema'
import { transfer } from '@repo/nuxt-import-export/schema'
import { sql } from 'drizzle-orm'
import { boolean, customType, index, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'
import { auditEvent } from '@repo/nuxt-audit-log/server'
import { notification } from '@repo/nuxt-notifications/schema'
import { apikey } from '@repo/nuxt-api/server'

export { flagDefinition, flagOverride, roleAssignment, organization, member, invitation, invoiceNinjaBinding, invoiceNinjaProjection, invoiceNinjaOperation, invoiceNinjaInbox, apikey, auditEvent, notification, transfer, stripeBinding, stripeOperationLedger, stripeProjection, stripeInbox, medusaBinding, medusaProjection, medusaOperation, medusaInbox }

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}

export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull(),
  emailVerified: boolean('email_verified').default(false).notNull(),
  image: text('image'),
  ...timestamps,
}, table => [uniqueIndex('user_email_idx').on(table.email)])

export const session = pgTable('session', {
  activeOrganizationId: activeOrganizationId(),
  id: text('id').primaryKey(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  token: text('token').notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  ...timestamps,
}, table => [
  uniqueIndex('session_token_idx').on(table.token),
  index('session_user_idx').on(table.userId),
])

export const account = pgTable('account', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
  scope: text('scope'),
  password: text('password'),
  ...timestamps,
}, table => [
  uniqueIndex('account_provider_identity_idx').on(table.providerId, table.accountId),
  index('account_user_idx').on(table.userId),
])

export const verification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  ...timestamps,
}, table => [index('verification_identifier_idx').on(table.identifier)])

const tsvector = customType<{ data: string }>({ dataType: () => 'tsvector' })

export const project = pgTable('project', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  searchVector: tsvector('search_vector').generatedAlwaysAs(sql`setweight(to_tsvector('simple', coalesce(name, '')), 'A') || setweight(to_tsvector('simple', coalesce(description, '')), 'B')`),
  ownerId: text('owner_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  ...timestamps,
}, table => [index('project_owner_updated_idx').on(table.ownerId, table.updatedAt), index('project_search_vector_gin_idx').using('gin', table.searchVector)])

export const organizationNote = pgTable('organization_note', {
  id: text('id').primaryKey(), organizationId: text('organization_id').notNull(), title: text('title').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, precision: 3 }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, precision: 3 }).notNull().defaultNow(),
}, table => [index('organization_note_scope_created_idx').on(table.organizationId, table.createdAt, table.id)])

export const schema = { organization, member, invitation, organizationNote, roleAssignment, flagDefinition, flagOverride, user, session, account, verification, apikey, project, auditEvent, notification, transfer, invoiceNinjaBinding, invoiceNinjaProjection, invoiceNinjaOperation, invoiceNinjaInbox, stripeBinding, stripeOperationLedger, stripeProjection, stripeInbox, medusaBinding, medusaProjection, medusaOperation, medusaInbox }

export { fileUiFiles } from './file-ui-schema'
