import { expect, test } from '@playwright/test'
import { createHmac } from 'node:crypto'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { eq, or } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import { apiPlatformAuth } from '@repo/nuxt-api/server'
import { queryAuditEvents } from '@repo/nuxt-audit-log/server'
import * as tables from '../../server/database/schema'

test('Project HTTP mutations audit session and verified machine actors without credentials or PII', async ({ request }) => {
  const client = new pg.Pool({ connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/nuxt_starter', max: 2 }).on('error', () => {})
  const db = drizzle(client, { schema: tables })
  const ownerId = crypto.randomUUID()
  let keyId: string | undefined
  try {
    await db.insert(tables.user).values({ id: ownerId, name: 'Private actor name', email: `${ownerId}@example.test` })
    const auth = betterAuth({
      baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:3000',
      database: drizzleAdapter(db, { provider: 'pg', schema: tables }),
      secret: 'local-test-key-creation-secret-at-least-32-chars',
      plugins: [apiPlatformAuth()],
      emailAndPassword: { enabled: false },
    })
    const credential = await auth.api.createApiKey({ body: { name: 'Audit fixture key', userId: ownerId, permissions: { projects: ['read', 'write'] } } })
    keyId = credential.id
    const machineResponse = await request.post('/api/v1/projects', {
      headers: { 'X-API-Key': credential.key }, data: { name: 'Private machine project', description: 'Private body' },
    })
    expect(machineResponse.status()).toBe(201)
    const machineProject = await machineResponse.json() as { id: string }
    const machineFields = ['id', 'name', 'description', 'createdAt', 'updatedAt'].sort()
    expect(Object.keys(machineProject).sort()).toEqual(machineFields)
    const machineList = await request.get('/api/v1/projects', { headers: { 'X-API-Key': credential.key } })
    expect(machineList.status()).toBe(200)
    for (const row of await machineList.json()) expect(Object.keys(row).sort()).toEqual(machineFields)
    const machineAudit = await queryAuditEvents(db, { subject: { type: 'project', id: machineProject.id } })
    expect(machineAudit.items).toHaveLength(1)
    expect(machineAudit.items[0]).toMatchObject({ actorType: 'machine', actorId: credential.id, action: 'projects.create', metadata: {} })
    const denied = await request.post('/api/v1/projects', { headers: { 'X-API-Key': 'invalid-raw-key' }, data: { name: 'Denied' } })
    expect(denied.status()).toBe(401)
    expect((await queryAuditEvents(db, { actor: { type: 'machine', id: credential.id } })).items).toHaveLength(1)

    const sessionToken = crypto.randomUUID()
    await db.insert(tables.session).values({ id: crypto.randomUUID(), token: sessionToken, userId: ownerId, expiresAt: new Date(Date.now() + 60_000) })
    const secret = process.env.NUXT_AUTH_SECRET || 'e2e-secret-that-is-at-least-thirty-two-chars'
    const signature = createHmac('sha256', secret).update(sessionToken).digest('base64')
    // Root production auth deliberately enforces the secure cookie prefix.
    const cookieName = process.env.PLAYWRIGHT_BASE_URL ? '__Secure-better-auth.session_token' : 'better-auth.session_token'
    const headers = { cookie: `${cookieName}=${encodeURIComponent(`${sessionToken}.${signature}`)}` }
    const createdResponse = await request.post('/api/projects', { headers, data: { name: 'Private session project' } })
    expect(createdResponse.status()).toBe(201)
    const created = await createdResponse.json() as { id: string }
    const humanFields = [...machineFields, 'ownerId'].sort()
    expect(Object.keys(created).sort()).toEqual(humanFields)
    const read = await request.get(`/api/projects/${created.id}`, { headers })
    expect(read.status()).toBe(200)
    expect(Object.keys(await read.json()).sort()).toEqual(humanFields)
    const listed = await request.get('/api/projects', { headers })
    expect(listed.status()).toBe(200)
    for (const row of await listed.json()) expect(Object.keys(row).sort()).toEqual(humanFields)
    const updated = await request.patch(`/api/projects/${created.id}`, { headers, data: { name: 'Private new name' } })
    expect(updated.status()).toBe(200)
    expect(Object.keys(await updated.json()).sort()).toEqual(humanFields)
    expect((await request.delete(`/api/projects/${created.id}`, { headers })).status()).toBe(204)
    const userAudit = await queryAuditEvents(db, { subject: { type: 'project', id: created.id } })
    expect(userAudit.items.map(e => e.action).sort()).toEqual(['projects.create', 'projects.delete', 'projects.update'])
    for (const event of userAudit.items) expect(event).toMatchObject({ actorType: 'user', actorId: ownerId, metadata: {} })
    const history = JSON.stringify([...userAudit.items, ...machineAudit.items])
    for (const privateValue of [credential.key, sessionToken, 'Private', `${ownerId}@example.test`]) expect(history).not.toContain(privateValue)
  }
  finally {
    await db.delete(tables.user).where(eq(tables.user.id, ownerId))
    if (keyId) await db.delete(tables.apikey).where(eq(tables.apikey.id, keyId))
    await db.delete(tables.auditEvent).where(or(eq(tables.auditEvent.actorId, ownerId), keyId ? eq(tables.auditEvent.actorId, keyId) : undefined))
    await client.end()
  }
})
