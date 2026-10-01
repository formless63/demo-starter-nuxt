// Native Better Auth schema for a disposable compatibility probe, not app migrations.
import { sql } from 'drizzle-orm'
import { boolean, check, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'

const createdAt = () => timestamp('created_at', { withTimezone: true, precision: 3 }).notNull().defaultNow()
const updatedAt = () => timestamp('updated_at', { withTimezone: true, precision: 3 }).notNull().defaultNow()
export const user = pgTable('user', {
  id: text('id').primaryKey(), name: text('name').notNull(), email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false), image: text('image'),
  createdAt: createdAt(), updatedAt: updatedAt(),
})
export const session = pgTable('session', {
  id: text('id').primaryKey(), token: text('token').notNull().unique(),
  userId: text('user_id').notNull(), expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  ipAddress: text('ip_address'), userAgent: text('user_agent'), activeOrganizationId: text('active_organization_id'),
  createdAt: createdAt(), updatedAt: updatedAt(),
})
export const account = pgTable('account', {
  id: text('id').primaryKey(), accountId: text('account_id').notNull(), providerId: text('provider_id').notNull(),
  userId: text('user_id').notNull(), accessToken: text('access_token'), refreshToken: text('refresh_token'), idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
  scope: text('scope'), password: text('password'), createdAt: createdAt(), updatedAt: updatedAt(),
})
export const verification = pgTable('verification', {
  id: text('id').primaryKey(), identifier: text('identifier').notNull(), value: text('value').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(), createdAt: createdAt(), updatedAt: updatedAt(),
})
export const organization = pgTable('organization', {
  id: text('id').primaryKey(), name: text('name').notNull(), slug: text('slug').notNull().unique(),
  logo: text('logo'), metadata: text('metadata'), createdAt: createdAt(),
})
export const member = pgTable('member', {
  id: text('id').primaryKey(), organizationId: text('organization_id').notNull(),
  userId: text('user_id').notNull(), role: text('role').notNull(), createdAt: createdAt(),
}, table => [
  uniqueIndex('member_organization_user_idx').on(table.organizationId, table.userId),
  uniqueIndex('member_one_owner_idx').on(table.organizationId).where(sql`${table.role} = 'owner'`),
  check('member_single_role_check', sql`${table.role} IN ('owner', 'admin', 'member')`),
])
export const invitation = pgTable('invitation', {
  id: text('id').primaryKey(), organizationId: text('organization_id').notNull(), email: text('email').notNull(),
  role: text('role').notNull(), status: text('status').notNull(), inviterId: text('inviter_id').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true, precision: 3 }).notNull(), createdAt: createdAt(),
})
