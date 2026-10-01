import { notification } from '@repo/nuxt-notifications/schema'
import { pgTable, text } from 'drizzle-orm/pg-core'
export { notification }
export const domainRecord = pgTable('domain_record', { id: text('id').primaryKey() })
