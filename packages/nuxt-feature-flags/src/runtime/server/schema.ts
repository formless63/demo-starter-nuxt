import { sql } from 'drizzle-orm'
import { boolean, check, index, integer, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core'
export const flagDefinition = pgTable('feature_flag_definition', {
  key: text('key').primaryKey(), description: text('description').notNull().default(''), enabled: boolean('enabled').notNull().default(false), defaultValue: boolean('default_value').notNull().default(false), rolloutBasisPoints: integer('rollout_basis_points'), revision: integer('revision').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true, precision: 3 }).notNull().defaultNow(), updatedAt: timestamp('updated_at', { withTimezone: true, precision: 3 }).notNull().defaultNow(),
}, table => [check('feature_flag_definition_revision_check', sql`${table.revision} >= 1`), check('feature_flag_definition_rollout_check', sql`${table.rolloutBasisPoints} IS NULL OR ${table.rolloutBasisPoints} BETWEEN 0 AND 10000`), index('feature_flag_definition_created_idx').on(table.createdAt, table.key)])
export const flagOverride = pgTable('feature_flag_override', {
  flagKey: text('flag_key').notNull(), targetKind: text('target_kind').notNull(), targetId: text('target_id').notNull(), value: boolean('value').notNull(), createdAt: timestamp('created_at', { withTimezone: true, precision: 3 }).notNull().defaultNow(),
}, table => [primaryKey({ columns: [table.flagKey, table.targetKind, table.targetId] }), check('feature_flag_override_kind_check', sql`${table.targetKind} IN ('user','tenant')`), index('feature_flag_override_created_idx').on(table.flagKey, table.createdAt, table.targetKind, table.targetId)])
