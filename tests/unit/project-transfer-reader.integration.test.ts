import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import pg from 'pg'
import { project, user } from '../../server/database/schema'
import { projectsTransferDefinition } from '../../server/transfers/application'

const suite = process.env.DATABASE_URL ? describe : describe.skip
suite('actual personal Project transfer snapshot reader', () => {
  const client = new pg.Pool({ connectionString: process.env.DATABASE_URL!, max: 2 }).on('error', () => {})
  const db = drizzle(client), owner = crypto.randomUUID(), foreign = crypto.randomUUID()
  const expected = ['before', ...Array.from({ length: 250 }, (_, index) => `tie-${String(index).padStart(3, '0')}`), 'after-a', 'after-b']
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: './server/database/migrations' })
    await db.insert(user).values([owner, foreign].map(id => ({ id, name: 'Disposable reader fixture', email: `${id}@example.test` })))
    const rows = expected.map((name, index) => ({ id: `${owner}-${String(index).padStart(3, '0')}`, ownerId: owner, name, description: null,
      createdAt: sql`${index === 0 ? '2026-01-01T00:00:00.123455Z' : index > 250 ? '2026-01-01T00:00:00.123457Z' : '2026-01-01T00:00:00.123456Z'}::timestamptz` }))
    // Insert out of order so the assertion depends on the reader's SQL ordering.
    await db.insert(project).values(rows.reverse())
    await db.insert(project).values({ id: `${foreign}-foreign`, ownerId: foreign, name: 'foreign', createdAt: sql`'2026-01-01T00:00:00.123456Z'::timestamptz` })
  })
  afterAll(async () => { await db.delete(user).where(eq(user.id, owner)); await db.delete(user).where(eq(user.id, foreign)); await client.end() })
  it('preserves microseconds across page boundaries, resolves ID ties and terminates exactly', async () => {
    const values = await db.transaction(async (tx) => {
      const select = vi.spyOn(tx, 'select'), output: string[] = []
      try {
        for await (const row of projectsTransferDefinition.exportRows(tx, { requesterId: owner, scope: { kind: 'user', id: owner } }, new AbortController().signal)) {
          output.push(row[0] as string)
          if (output.length > expected.length) throw new Error('Project export did not terminate at the complete dataset')
        }
        // One in-transaction policy read plus the three snapshot pages.
        expect(select).toHaveBeenCalledTimes(4)
        return output
      }
      finally { select.mockRestore() }
    }, { isolationLevel: 'repeatable read', accessMode: 'read only' })
    expect(values).toEqual(expected)
    expect(new Set(values).size).toBe(expected.length)
  })
})
