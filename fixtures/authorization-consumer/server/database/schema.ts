import { pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core'
export { roleAssignment } from '@repo/nuxt-authorization/schema'

export const fixtureMembership = pgTable('fixture_membership', { id: text('id').primaryKey(), scopeId: text('scope_id').notNull(), userId: text('user_id').notNull(), role: text('role').notNull() }, table => [uniqueIndex('fixture_membership_tuple_idx').on(table.scopeId, table.userId)])
export const fixtureRecord = pgTable('fixture_record', { id: text('id').primaryKey(), scopeKind: text('scope_kind').notNull(), scopeId: text('scope_id').notNull(), ownerId: text('owner_id').notNull(), value: text('value').notNull() })
export const fixtureAudit = pgTable('fixture_audit', { id: text('id').primaryKey(), assignmentId: text('assignment_id').notNull() })
