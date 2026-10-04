import { queryNotifications } from '@repo/nuxt-notifications/server'
import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
export default defineEventHandler(async () => {
  const client = new pg.Pool({ connectionString: process.env.DATABASE_URL!, max: 1 })
  client.on('error', () => {})
  try { return await queryNotifications(drizzle(client), 'fixture-owner') }
  finally { await client.end() }
})
