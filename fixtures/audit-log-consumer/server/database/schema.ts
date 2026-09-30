import { pgTable, text } from 'drizzle-orm/pg-core'
export { auditEvent } from '@repo/nuxt-audit-log/server'
export const domainRecord = pgTable('domain_record', { id: text('id').primaryKey() })
