import { sql } from 'drizzle-orm'

export default defineEventHandler(async () => {
  await useDb().execute(sql`select 1`)
  return { status: 'ok', timestamp: new Date().toISOString() }
})
