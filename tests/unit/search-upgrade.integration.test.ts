import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { readMigrationFiles } from 'drizzle-orm/migrator'
import postgres from 'postgres'

const suite = process.env.DATABASE_URL ? describe : describe.skip
suite('Search upgrade of existing Projects rows and immutable migration history', () => {
  const admin = postgres(process.env.DATABASE_URL!, { max: 1 })
  const name = `search_upgrade_${crypto.randomUUID().replaceAll('-', '')}`
  let client: ReturnType<typeof postgres>
  let folder: string
  beforeAll(async () => {
    await admin.unsafe(`CREATE DATABASE "${name}"`)
    const url = new URL(process.env.DATABASE_URL!)
    url.pathname = `/${name}`
    client = postgres(url.toString(), { max: 1 })
    folder = await mkdtemp(join(tmpdir(), 'search-upgrade-'))
  })
  afterAll(async () => {
    if (client) await client.end()
    await admin.unsafe(`DROP DATABASE "${name}"`)
    await admin.end()
    if (folder) await rm(folder, { recursive: true, force: true })
  })
  it('backfills generated vectors and GIN without changing rows or prior migration hashes', async () => {
    const migrationsFolder = './server/database/migrations'
    await cp(migrationsFolder, folder, { recursive: true })
    const journalPath = join(folder, 'meta/_journal.json')
    const journal = JSON.parse(await readFile(journalPath, 'utf8'))
    journal.entries = journal.entries.slice(0, -1)
    await writeFile(journalPath, JSON.stringify(journal))
    const db = drizzle(client)
    await migrate(db, { migrationsFolder: folder })
    await client`INSERT INTO "user" (id, name, email) VALUES ('existing-owner', 'Owner', 'owner@example.test')`
    await client`INSERT INTO project (id, owner_id, name, description, updated_at) VALUES ('existing-row', 'existing-owner', 'planet', 'old body', '2026-01-01T00:00:00.000001Z')`
    const rows = [...await client`SELECT id, owner_id, name, description, created_at::text, updated_at::text FROM project`]
    const history = [...await client`SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id`]
    await migrate(db, { migrationsFolder })
    await migrate(db, { migrationsFolder })
    expect([...await client`SELECT id, owner_id, name, description, created_at::text, updated_at::text FROM project`]).toEqual(rows)
    const upgraded = [...await client`SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id`]
    expect(upgraded.slice(0, history.length)).toEqual(history)
    expect(upgraded.map(row => row.hash)).toEqual(readMigrationFiles({ migrationsFolder }).map(migration => migration.hash))
    const [vector] = await client`SELECT search_vector::text AS vector, search_vector @@ websearch_to_tsquery('simple', 'planet') AS matches FROM project WHERE id='existing-row'`
    expect(vector!.matches).toBe(true)
    expect(vector!.vector).toContain("'planet':1A")
    const [gin] = await client`SELECT indexdef FROM pg_indexes WHERE indexname='project_search_vector_gin_idx'`
    expect(gin!.indexdef).toContain('USING gin (search_vector)')
  })
})
