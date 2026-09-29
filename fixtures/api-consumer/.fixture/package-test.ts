import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { and, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { apiPlatformAuth } from '@wicaso/nuxt-api/server'
import * as tables from '../server/database/schema'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

async function run(command: string[], environment: Record<string, string>) {
  console.info(`[api fixture] ${command.join(' ')}`)
  const child = Bun.spawn(command, {
    cwd: process.cwd(),
    env: { ...Bun.env, ...environment },
    stdin: 'ignore',
    stdout: 'inherit',
    stderr: 'inherit',
  })
  const exitCode = await child.exited
  if (exitCode !== 0) throw new Error(`${command.join(' ')} exited with ${exitCode}`)
}

async function signedCookie(value: string, secret: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value))
  const encoded = btoa(String.fromCharCode(...new Uint8Array(signature)))
  return encodeURIComponent(`${value}.${encoded}`)
}

async function waitForServer(url: string, server: ReturnType<typeof Bun.spawn>) {
  for (let attempt = 0; attempt < 40; attempt++) {
    if (server.exitCode !== null) throw new Error(`Fixture production server exited with ${server.exitCode}`)
    try {
      const response = await fetch(url)
      if (response.ok) return
    }
    catch {
      // The production server is still starting.
    }
    await Bun.sleep(250)
  }
  throw new Error('Fixture production server did not become ready')
}

async function json(url: string, init?: RequestInit) {
  const response = await fetch(url, init)
  const body = await response.json()
  return { response, body }
}

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is required for the API package runtime test')

const port = 3210
const baseUrl = `http://127.0.0.1:${port}`
const secret = 'fixture-secret-that-is-at-least-thirty-two-characters'
const environment = {
  DATABASE_URL: databaseUrl,
  NUXT_DATABASE_URL: databaseUrl,
  NUXT_AUTH_SECRET: secret,
  NUXT_PUBLIC_APP_BASE_URL: baseUrl,
  NITRO_PORT: String(port),
  NODE_ENV: 'production',
}

await run(['bun', 'run', 'db:migrate'], environment)

const sql = postgres(databaseUrl, { max: 2, idle_timeout: 5 })
const db = drizzle(sql, { schema: tables })
const auth = betterAuth({
  baseURL: baseUrl,
  secret,
  database: drizzleAdapter(db, { provider: 'pg', schema: tables }),
  emailAndPassword: { enabled: false },
  plugins: [apiPlatformAuth()],
  trustedOrigins: [baseUrl],
})

const userId = crypto.randomUUID()
const otherUserId = crypto.randomUUID()
const now = new Date()
await db.insert(tables.user).values([
  { id: userId, name: 'Fixture User', email: `${userId}@example.test`, emailVerified: true },
  { id: otherUserId, name: 'Other User', email: `${otherUserId}@example.test`, emailVerified: true },
])
await db.insert(tables.project).values([
  { id: crypto.randomUUID(), ownerId: userId, name: 'Visible project', description: null },
  { id: crypto.randomUUID(), ownerId: otherUserId, name: 'Hidden project', description: null },
])

const readKey = await auth.api.createApiKey({
  body: { name: 'Read key', userId, permissions: { projects: ['read'] } },
})
const writeKey = await auth.api.createApiKey({
  body: { name: 'Write key', userId, permissions: { projects: ['write'] } },
})
const revokeKey = await auth.api.createApiKey({
  body: { name: 'Revoked key', userId, permissions: { projects: ['read'] } },
})
const expiredKey = await auth.api.createApiKey({
  body: { name: 'Expired key', userId, permissions: { projects: ['read'] } },
})
const limitedKey = await auth.api.createApiKey({
  body: {
    name: 'Limited key',
    userId,
    permissions: { projects: ['read'] },
    rateLimitEnabled: true,
    rateLimitMax: 1,
    rateLimitTimeWindow: 60_000,
  },
})

await auth.api.updateApiKey({ body: { keyId: revokeKey.id, userId, enabled: false } })
await db.update(tables.apikey)
  .set({ expiresAt: new Date(Date.now() - 1_000) })
  .where(and(eq(tables.apikey.id, expiredKey.id), eq(tables.apikey.referenceId, userId)))

const [storedReadKey] = await db.select().from(tables.apikey).where(eq(tables.apikey.id, readKey.id))
assert(storedReadKey, 'Created API key was not stored')
assert(storedReadKey.key !== readKey.key, 'Raw API key was stored in plaintext')
assert(!storedReadKey.key.includes(readKey.key), 'Stored API key contains the raw secret')

const sessionToken = crypto.randomUUID()
await db.insert(tables.session).values({
  id: crypto.randomUUID(),
  token: sessionToken,
  userId,
  expiresAt: new Date(Date.now() + 60_000),
  createdAt: now,
  updatedAt: now,
})

const server = Bun.spawn(['node', '.output/server/index.mjs'], {
  cwd: process.cwd(),
  env: { ...Bun.env, ...environment },
  stdin: 'ignore',
  stdout: 'inherit',
  stderr: 'inherit',
})
let serverExitCode: number | null

try {
  await waitForServer(`${baseUrl}/api/openapi.json`, server)

  const missing = await json(`${baseUrl}/api/v1/projects`)
  assert(missing.response.status === 401 && missing.body.error?.code === 'unauthorized', 'Missing key must return the standard 401 envelope')

  const invalid = await json(`${baseUrl}/api/v1/projects`, { headers: { 'x-api-key': 'invalid' } })
  assert(invalid.response.status === 401 && invalid.body.error?.code === 'unauthorized', 'Invalid key must return 401')

  const visible = await json(`${baseUrl}/api/v1/projects`, { headers: { 'x-api-key': readKey.key } })
  assert(visible.response.status === 200, 'Read key could not list projects')
  assert(Array.isArray(visible.body) && visible.body.length === 1 && visible.body[0].name === 'Visible project', 'Project listing was not owner scoped')

  const forbidden = await json(`${baseUrl}/api/v1/projects`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': readKey.key },
    body: JSON.stringify({ name: 'Denied project' }),
  })
  assert(forbidden.response.status === 403 && forbidden.body.error?.code === 'forbidden', 'Insufficient permission must return 403')

  const malformed = await json(`${baseUrl}/api/v1/projects`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': writeKey.key },
    body: JSON.stringify({ name: '' }),
  })
  assert(malformed.response.status === 422 && malformed.body.error?.code === 'validation_failed', 'Malformed body must return 422')

  const created = await json(`${baseUrl}/api/v1/projects`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': writeKey.key },
    body: JSON.stringify({ name: 'Created through API', description: 'fixture' }),
  })
  assert(created.response.status === 201 && created.body.name === 'Created through API', 'Write key could not create a project')

  const revoked = await json(`${baseUrl}/api/v1/projects`, { headers: { 'x-api-key': revokeKey.key } })
  assert(revoked.response.status === 401, 'Revoked key must return 401')

  const expired = await json(`${baseUrl}/api/v1/projects`, { headers: { 'x-api-key': expiredKey.key } })
  assert(expired.response.status === 401, 'Expired key must return 401')

  const limitedFirst = await json(`${baseUrl}/api/v1/projects`, { headers: { 'x-api-key': limitedKey.key } })
  const limitedSecond = await json(`${baseUrl}/api/v1/projects`, { headers: { 'x-api-key': limitedKey.key } })
  assert(limitedFirst.response.status === 200 && limitedSecond.response.status === 429, 'Per-key rate limit must return 429')

  const [usedReadKey] = await db.select().from(tables.apikey).where(eq(tables.apikey.id, readKey.id))
  assert(usedReadKey?.lastRequest, 'Successful verification did not persist last use')

  const apiKeySession = await json(`${baseUrl}/api/auth/get-session`, { headers: { 'x-api-key': readKey.key } })
  assert(apiKeySession.response.status === 200 && apiKeySession.body === null, 'API key must not become a browser session')

  const cookie = await signedCookie(sessionToken, secret)
  const browserSession = await json(`${baseUrl}/api/auth/get-session`, {
    headers: { cookie: `better-auth.session_token=${cookie}` },
  })
  assert(browserSession.response.status === 200 && browserSession.body?.user?.id === userId, 'Existing Better Auth session behavior changed')

  const openApi = await json(`${baseUrl}/api/openapi.json`)
  assert(openApi.response.status === 200 && openApi.body.openapi === '3.1.1', 'OpenAPI endpoint must emit 3.1.1')
  const paths = Object.keys(openApi.body.paths ?? {})
  assert(paths.length === 1 && paths[0] === '/api/v1/projects', 'OpenAPI exposed unregistered internal routes')
  const pathOperations = openApi.body.paths['/api/v1/projects'] as Record<string, { operationId?: string }>
  const operations = Object.values(pathOperations).map(operation => operation.operationId)
  assert(new Set(operations).size === operations.length, 'OpenAPI operation IDs are not unique')
  assert(openApi.body.paths['/api/v1/projects'].get['x-required-permissions'].projects[0] === 'read', 'OpenAPI omitted read permission metadata')
  assert(openApi.body.paths['/api/v1/projects'].post['x-required-permissions'].projects[0] === 'write', 'OpenAPI omitted write permission metadata')

  const docs = await fetch(`${baseUrl}/docs/api`)
  assert(docs.ok, 'Scalar API reference did not render')

  console.info('[api fixture] migrations, auth, permissions, contracts, docs, sessions, and owner isolation passed')
}
finally {
  if (server.exitCode === null) server.kill('SIGTERM')
  serverExitCode = await server.exited
  await sql.end()
}

assert(serverExitCode === 0, `Fixture server exited with ${serverExitCode}`)
