import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import * as schema from '../database/schema'

let client: ReturnType<typeof postgres> | undefined

export function useDb() {
  const config = useRuntimeConfig()
  const databaseUrl = config.databaseUrl || process.env.DATABASE_URL
  if (!databaseUrl) throw createError({ statusCode: 500, statusMessage: 'DATABASE_URL is required' })
  client ??= postgres(databaseUrl, { max: 5, idle_timeout: 5 })
  return drizzle(client, { schema })
}
