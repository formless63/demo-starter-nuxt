import { expect, test } from '@playwright/test'
import { createHmac } from 'node:crypto'
import { execFileSync } from 'node:child_process'
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
    expect(response.headers()['cache-control']).toBe('private, no-store')
    const first = await response.json()
    expect(first.items.map((x: { id: string }) => x.id)).toEqual([`${owner}-title`])
    expect(first.items[0].rank).toBeGreaterThan(0)
    const next = await request.get('/api/search/projects', { headers, params: { q: term, pageSize: 1, cursor: first.nextCursor } })
    const second = await next.json()
    expect(second).toMatchObject({ items: [{ id: `${owner}-body`, rank: 0.2857142984867096 }], nextCursor: null })
    for (const row of [...first.items, ...second.items]) {
      expect(row.rank).toBe(Math.fround(row.rank))
      expect(Object.keys(row).sort()).toEqual(['id', 'name', 'description', 'ownerId', 'createdAt', 'updatedAt', 'rank'].sort())
    }
    const otherToken = crypto.randomUUID()
    await db.insert(session).values({ id: crypto.randomUUID(), token: otherToken, userId: other, expiresAt: new Date(Date.now() + 60_000) })
    const otherSignature = createHmac('sha256', secret).update(otherToken).digest('base64')
    const otherHeaders = { cookie: `${name}=${encodeURIComponent(`${otherToken}.${otherSignature}`)}` }
    const forged = Buffer.from(JSON.stringify([1, 1, '9999-12-31T23:59:59.999999Z', `${other}-secret`])).toString('base64url')
    const scoped = await request.get('/api/search/projects', { headers, params: { q: term, cursor: forged } })
    expect((await scoped.json()).items.map((x: { ownerId: string }) => x.ownerId)).toEqual([owner, owner])
    const crossOwner = await request.get('/api/search/projects', { headers: otherHeaders, params: { q: term, cursor: forged } })
    expect((await crossOwner.json()).items.map((x: { id: string }) => x.id)).toEqual([`${other}-secret`])
    const syntax = await request.get('/api/search/projects', { headers, params: { q: "planet'); DROP TABLE project; --" } })
    expect(syntax.status()).toBe(200)
    for (const params of [{ q: ' ' }, { q: 'x' }, { q: 'x'.repeat(257) }, { q: term, pageSize: '101' }, { q: term, pageSize: '1.5' }, { q: term, cursor: 'invalid==' }]) {
      const invalid = await request.get('/api/search/projects', { headers, params })
      expect(invalid.status()).toBe(400)
      expect(await invalid.json()).toEqual({ error: true, code: 'invalid-query' })
    }
    // Explicit opt-in only for the isolated production smoke database.
    if (process.env.DISPOSABLE_DATABASE_TESTS === 'true') {
      const privateQuery = `private-search-${crypto.randomUUID()}`
      await client`ALTER TABLE project RENAME COLUMN search_vector TO search_vector_failure_probe`
      try {
        const failure = await request.get('/api/search/projects', { headers, params: { q: privateQuery } })
        expect(failure.status()).toBe(503)
        expect(failure.headers()['cache-control']).toBe('private, no-store')
        expect(await failure.json()).toEqual({ error: true, code: 'unavailable' })
        if (process.env.PRODUCTION_COMPOSE_PROJECT) {
          const logs = execFileSync('docker', ['compose', '-p', process.env.PRODUCTION_COMPOSE_PROJECT, 'logs', '--no-color', 'app'], { encoding: 'utf8' })
          for (const value of [privateQuery, term, token, otherToken, 'search_vector', 'Failed query:', 'PostgresError']) expect(logs).not.toContain(value)
        }
      }
      finally { await client`ALTER TABLE project RENAME COLUMN search_vector_failure_probe TO search_vector` }
    }
  }
  finally {
    await db.delete(user).where(eq(user.id, owner)); await db.delete(user).where(eq(user.id, other)); await client.end()
  }
})
