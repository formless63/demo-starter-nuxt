import { queryNotifications } from '@repo/nuxt-notifications/server'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
export default defineEventHandler(async () => {
  const client = postgres(process.env.DATABASE_URL!, { max: 1 })
  try { return await queryNotifications(drizzle(client), 'fixture-owner') }
  finally { await client.end() }
})
