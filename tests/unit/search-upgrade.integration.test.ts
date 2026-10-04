import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { readMigrationFiles } from 'drizzle-orm/migrator'
import pg from 'pg'

const suite = process.env.DATABASE_URL ? describe : describe.skip
suite('Search upgrade of existing Projects rows and immutable migration history', () => {
  const admin = new pg.Pool({ connectionString: process.env.DATABASE_URL!, max: 1 }).on('error', () => {})
  const name = `search_upgrade_${crypto.randomUUID().replaceAll('-', '')}`
  let client: pg.Pool
  let folder: string
  beforeAll(async () => {
    await admin.query(`CREATE DATABASE "${name}"`)
    const url = new URL(process.env.DATABASE_URL!)
    url.pathname = `/${name}`
    client = new pg.Pool({ connectionString: url.toString(), max: 1 }).on('error', () => {})
    folder = await mkdtemp(join(tmpdir(), 'search-upgrade-'))
  })
  afterAll(async () => {
    if (client) await client.end()
    await admin.query(`DROP DATABASE "${name}"`)
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
    await client.query(`INSERT INTO "user" (id, name, email) VALUES ('existing-owner', 'Owner', 'owner@example.test')`)
    await client.query(`INSERT INTO project (id, owner_id, name, description, updated_at) VALUES ('existing-row', 'existing-owner', 'planet', 'old body', '2026-01-01T00:00:00.000001Z')`)
    const rows = (await client.query(`SELECT id, owner_id, name, description, created_at::text, updated_at::text FROM project`)).rows
    const history = (await client.query(`SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id`)).rows
    await migrate(db, { migrationsFolder })
    await migrate(db, { migrationsFolder })
    expect((await client.query(`SELECT id, owner_id, name, description, created_at::text, updated_at::text FROM project`)).rows).toEqual(rows)
    const upgraded = (await client.query(`SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id`)).rows
    expect(upgraded.slice(0, history.length)).toEqual(history)
    expect(upgraded.map(row => row.hash)).toEqual(readMigrationFiles({ migrationsFolder }).map(migration => migration.hash))
    const [vector] = (await client.query(`SELECT search_vector::text AS vector, search_vector @@ websearch_to_tsquery('simple', 'planet') AS matches FROM project WHERE id='existing-row'`)).rows
    expect(vector!.matches).toBe(true)
    expect(vector!.vector).toContain("'planet':1A")
    const [gin] = (await client.query(`SELECT indexdef FROM pg_indexes WHERE indexname='project_search_vector_gin_idx'`)).rows
    expect(gin!.indexdef).toContain('USING gin (search_vector)')
  })
})
