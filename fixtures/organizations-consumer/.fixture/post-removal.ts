import { verifyProductionBoot } from './boot.ts'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHmac } from 'node:crypto'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { user, account, verification } from './upstream-schema.ts'
import { witness } from './witness.ts'

const state = JSON.parse(await readFile(new URL('./state.json', import.meta.url), 'utf8')) as { url: string, witness: Awaited<ReturnType<typeof witness>> }
const client = postgres(state.url, { max: 2 })
try {
  await verifyProductionBoot(state.url, false)
  assert(JSON.stringify(await witness(client)) === JSON.stringify(state.witness), 'Capability removal/rebuild must preserve all rows and indexes')
  // Baseline auth schema has no organization composition, but the physical session column survives.
  const session = pgTable('session', {
    id: text('id').primaryKey(), token: text('token').notNull(), userId: text('user_id').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(), ipAddress: text('ip_address'), userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(), updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  })
  const secret = 'disposable-removal-contract-secret-only-123456789'
  const auth = betterAuth({ baseURL: 'http://localhost:3997', secret, emailAndPassword: { enabled: false }, logger: { disabled: true }, database: drizzleAdapter(drizzle(client), { provider: 'pg', schema: { user, session, account, verification } }) })
  const token = 'probe-session-token'
  const signature = createHmac('sha256', secret).update(token).digest('base64')
  const restored = await auth.api.getSession({ headers: new Headers({ cookie: `better-auth.session_token=${encodeURIComponent(`${token}.${signature}`)}` }) })
  assert.equal(restored?.user.id, 'probe-recipient')
  assert(!('activeOrganizationId' in (restored?.session ?? {})))
  console.info('[organizations fixture] removal retained data/indexes and baseline native session behavior')
}
finally { await client.end() }
