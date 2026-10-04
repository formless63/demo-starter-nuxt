import pg from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import * as schema from '../database/schema'

let client: pg.Pool | undefined

export function useDb() {
  const config = useRuntimeConfig()
  const databaseUrl = config.databaseUrl || process.env.DATABASE_URL
  if (!databaseUrl) throw createError({ statusCode: 500, statusMessage: 'DATABASE_URL is required' })
  if (!client) {
    client = new pg.Pool({ connectionString: databaseUrl, max: 5, idleTimeoutMillis: 5000 })
    client.on('error', () => {})
  }
  return drizzle(client, { schema })
}
