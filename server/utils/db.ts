import pg from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import * as schema from '../database/schema'

let client: pg.Pool | undefined

export function useDb() {
  const config = useRuntimeConfig()
  // Keep the conventional Drizzle DATABASE_URL runtime-only; do not bake it
  // into Nuxt's immutable production runtime configuration during the build.
  const databaseUrl = config.databaseUrl || process.env.DATABASE_URL

  if (!databaseUrl) {
    throw createError({ statusCode: 500, statusMessage: 'DATABASE_URL is not configured' })
  }

  // Idle-client errors (for example a restarted database) must not crash the server; the next query reports them.
  client ??= new pg.Pool({ connectionString: databaseUrl, max: 10, idleTimeoutMillis: 20_000, connectionTimeoutMillis: 30_000 }).on('error', () => {})
  return drizzle(client, { schema })
}

// Auth operations use a separately bounded pool; domain/Jobs pools are not reconfigured.
let authClient: pg.Pool | undefined
export function useAuthDb() {
  const config = useRuntimeConfig()
  const databaseUrl = config.databaseUrl || process.env.DATABASE_URL
  if (!databaseUrl) throw createError({ statusCode: 503, statusMessage: 'Database is unavailable' })
  authClient ??= new pg.Pool({ connectionString: databaseUrl, max: 10, idleTimeoutMillis: 20_000, connectionTimeoutMillis: 30_000, statement_timeout: 5000, lock_timeout: 2000 }).on('error', () => {})
  return drizzle(authClient, { schema })
}
