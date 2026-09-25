import { fileURLToPath } from 'node:url'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'

const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for database migrations')
}

const client = postgres(databaseUrl, { max: 1 })

try {
  await migrate(drizzle(client), {
    migrationsFolder: fileURLToPath(new URL('../server/database/migrations', import.meta.url)),
  })
  console.info('Database migrations applied successfully')
}
finally {
  await client.end()
}
