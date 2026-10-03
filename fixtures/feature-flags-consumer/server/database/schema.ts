import { pgTable, text } from 'drizzle-orm/pg-core'
export { flagDefinition, flagOverride } from '@repo/nuxt-feature-flags/schema'
export const fixtureAudit = pgTable('fixture_flag_audit', { id:text('id').primaryKey(), flagKey:text('flag_key').notNull() })
