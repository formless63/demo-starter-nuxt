import { sql } from 'drizzle-orm'
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'

export const roleAssignment = pgTable('authorization_assignment', {
  id: uuid('id').primaryKey(), scopeKind: text('scope_kind').notNull(), scopeId: text('scope_id').notNull(),
  userId: text('user_id').notNull(), roleId: text('role_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, precision: 3 }).notNull().defaultNow(),
}, table => [
  uniqueIndex('authorization_assignment_tuple_idx').on(table.scopeKind, table.scopeId, table.userId, table.roleId),
  check('authorization_assignment_scope_check', sql`${table.scopeKind} IN ('user', 'tenant')`),
  index('authorization_assignment_scope_created_idx').on(table.scopeKind, table.scopeId, table.createdAt, table.id),
])
