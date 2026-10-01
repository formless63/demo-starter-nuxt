import { expect, test } from '@playwright/test'
import { createHmac } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { project, session, user } from '../../server/database/schema'

test('authenticated Projects search scopes owners, validates input and returns rank keyset pages', async ({ request }) => {
  const client = postgres(process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/nuxt_starter', { max: 1 })
  const db = drizzle(client)
  const owner = crypto.randomUUID()
  const other = crypto.randomUUID()
  const term = `needle${owner.replaceAll('-', '')}`
  try {
    expect((await request.get(`/api/search/projects?q=${term}`)).status()).toBe(401)
    await db.insert(user).values([{ id: owner, name: 'Owner', email: `${owner}@example.test` }, { id: other, name: 'Other', email: `${other}@example.test` }])
    await db.insert(project).values([
      { id: `${owner}-title`, ownerId: owner, name: term },
      { id: `${owner}-body`, ownerId: owner, name: 'Body', description: term },
      { id: `${other}-secret`, ownerId: other, name: term },
    ])
    const token = crypto.randomUUID()
    await db.insert(session).values({ id: crypto.randomUUID(), token, userId: owner, expiresAt: new Date(Date.now() + 60_000) })
    const secret = process.env.NUXT_AUTH_SECRET || 'e2e-secret-that-is-at-least-thirty-two-chars'
    const signature = createHmac('sha256', secret).update(token).digest('base64')
    const name = process.env.PLAYWRIGHT_BASE_URL ? '__Secure-better-auth.session_token' : 'better-auth.session_token'
    const headers = { cookie: `${name}=${encodeURIComponent(`${token}.${signature}`)}` }
    const response = await request.get('/api/search/projects', { headers, params: { q: term, pageSize: 1 } })
    expect(response.status()).toBe(200)
    const first = await response.json()
    expect(first.items.map((x: { id: string }) => x.id)).toEqual([`${owner}-title`])
    expect(first.items[0].rank).toBeGreaterThan(0)
    const next = await request.get('/api/search/projects', { headers, params: { q: term, pageSize: 1, cursor: first.nextCursor } })
    expect(await next.json()).toMatchObject({ items: [{ id: `${owner}-body` }], nextCursor: null })
    for (const params of [{ q: ' ' }, { q: 'x' }, { q: 'x'.repeat(257) }, { q: term, pageSize: '101' }, { q: term, pageSize: '1.5' }, { q: term, cursor: 'invalid==' }]) {
      const invalid = await request.get('/api/search/projects', { headers, params })
      expect(invalid.status()).toBe(400)
      expect(await invalid.text()).toContain('invalid-query')
    }
  }
  finally {
    await db.delete(user).where(eq(user.id, owner)); await db.delete(user).where(eq(user.id, other)); await client.end()
  }
})
