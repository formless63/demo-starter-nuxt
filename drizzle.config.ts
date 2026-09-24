import { defineConfig } from 'drizzle-kit'
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for database commands')
export default defineConfig({ schema: './server/database/schema.ts', out: './server/database/migrations', dialect: 'postgresql', dbCredentials: { url: process.env.DATABASE_URL } })
