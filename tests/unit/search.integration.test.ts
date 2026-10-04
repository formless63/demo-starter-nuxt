import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import pg from 'pg'
import { project, user } from '../../server/database/schema'
import { searchProjects } from '../../server/services/projects'

const suite = process.env.DATABASE_URL ? describe : describe.skip
suite('Projects Search reference migration and authorization', () => {
  const client = new pg.Pool({ connectionString: process.env.DATABASE_URL!, max: 1 }).on('error', () => {})
  const db = drizzle(client)
  const owner = crypto.randomUUID()
  const other = crypto.randomUUID()
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: './server/database/migrations' })
    await db.insert(user).values([{ id: owner, name: 'Owner', email: `${owner}@example.test` }, { id: other, name: 'Other', email: `${other}@example.test` }])
    await db.insert(project).values([
      { id: `${owner}-title`, ownerId: owner, name: 'orbit', description: null },
      { id: `${owner}-body`, ownerId: owner, name: 'body only', description: 'orbit' },
      { id: `${other}-secret`, ownerId: other, name: 'orbit secret', description: 'private' },
    ])
  })
  afterAll(async () => {
    await db.delete(user).where(eq(user.id, owner)); await db.delete(user).where(eq(user.id, other)); await client.end()
  })
  it('applies the committed generated-vector and GIN migration', async () => {
    const [column] = (await client.query(`SELECT data_type, is_generated, generation_expression FROM information_schema.columns WHERE table_name='project' AND column_name='search_vector'`)).rows
    expect(column).toMatchObject({ data_type: 'tsvector', is_generated: 'ALWAYS' })
    expect(column!.generation_expression).toContain('simple')
    const indexes = (await client.query(`SELECT indexname, indexdef FROM pg_indexes WHERE tablename='project'`)).rows
    expect(indexes.find(x => x.indexname === 'project_search_vector_gin_idx')?.indexdef).toContain('USING gin (search_vector)')
  })
  it('ranks name above description, isolates owners and pages without exposing vectors', async () => {
    const all = await searchProjects(db, owner, { query: ' orbit ' })
    expect(all.items.map(x => x.id)).toEqual([`${owner}-title`, `${owner}-body`])
    expect(all.items[0]!.rank).toBeGreaterThan(all.items[1]!.rank)
    expect(all.items[0]).not.toHaveProperty('searchVector')
    expect(all.items[0]).not.toHaveProperty('cursorUpdatedAt')
    const first = await searchProjects(db, owner, { query: 'orbit', pageSize: 1 })
    expect(first.nextCursor).toBeTypeOf('string')
    const second = await searchProjects(db, owner, { query: 'orbit', pageSize: 1, cursor: first.nextCursor! })
    expect(second.items[0]!.id).toBe(`${owner}-body`); expect(second.nextCursor).toBeNull()
    expect((await searchProjects(db, other, { query: 'orbit' })).items.map(x => x.id)).toEqual([`${other}-secret`])
    expect((await searchProjects(db, 'missing', { query: 'orbit', cursor: first.nextCursor! })).items).toEqual([])
  })
  it('refreshes the generated vector after domain writes', async () => {
    await db.update(project).set({ name: 'newterm' }).where(eq(project.id, `${owner}-title`))
    expect((await searchProjects(db, owner, { query: 'newterm' })).items.map(x => x.id)).toEqual([`${owner}-title`])
    expect((await searchProjects(db, owner, { query: 'orbit' })).items.map(x => x.id)).toEqual([`${owner}-body`])
  })
  it('rejects invalid requests with safe errors', async () => {
    for (const input of [{ query: ' ' }, { query: 'x' }, { query: 'x'.repeat(257) }, { query: 'orbit', pageSize: 101 }, { query: 'orbit', cursor: 'bad==' }]) {
      await expect(searchProjects(db, owner, input)).rejects.toMatchObject({ code: 'invalid-query', message: 'Invalid search request' })
    }
  })
})
