import { sql } from 'drizzle-orm'
import { customType, index, pgTable, text, timestamp } from 'drizzle-orm/pg-core'

// Disposable domain example; the package does not ship a central document model.
const tsvector = customType<{ data: string }>({ dataType: () => 'tsvector' })
export const article = pgTable('article', {
  id: text('id').primaryKey(),
  ownerId: text('owner_id').notNull(),
  title: text('title').notNull(),
  body: text('body'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  vector: tsvector('search_vector').generatedAlwaysAs(sql`setweight(to_tsvector('simple', coalesce(title, '')), 'A') || setweight(to_tsvector('simple', coalesce(body, '')), 'B')`),
}, t => [index('article_search_gin_idx').using('gin', t.vector)])
