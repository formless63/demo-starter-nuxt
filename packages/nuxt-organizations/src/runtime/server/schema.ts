import { sql } from 'drizzle-orm'
import { check, index, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'

export const activeOrganizationId = () => text('active_organization_id')
const createdAt = () => timestamp('created_at', { withTimezone: true, precision: 3 }).notNull().defaultNow()
export const organization = pgTable('organization', {
  id: text('id').primaryKey(), name: text('name').notNull(), slug: text('slug').notNull(),
  logo: text('logo'), metadata: text('metadata'), createdAt: createdAt(),
}, table => [uniqueIndex('organization_slug_idx').on(table.slug)])
export const member = pgTable('member', {
  id: text('id').primaryKey(), organizationId: text('organization_id').notNull(),
  userId: text('user_id').notNull(), role: text('role').notNull(), createdAt: createdAt(),
}, table => [
  uniqueIndex('member_organization_user_idx').on(table.organizationId, table.userId),
  uniqueIndex('member_one_owner_idx').on(table.organizationId).where(sql`${table.role} = 'owner'`),
  check('member_single_role_check', sql`${table.role} IN ('owner', 'admin', 'member')`),
  index('member_user_created_idx').on(table.userId, table.createdAt, table.id),
  index('member_organization_created_idx').on(table.organizationId, table.createdAt, table.id),
])
export const invitation = pgTable('invitation', {
  id: text('id').primaryKey(), organizationId: text('organization_id').notNull(), email: text('email').notNull(),
  role: text('role').notNull(), status: text('status').notNull().default('pending'), inviterId: text('inviter_id').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true, precision: 3 }).notNull(), createdAt: createdAt(),
}, table => [index('invitation_organization_status_idx').on(table.organizationId, table.status, table.expiresAt)])
