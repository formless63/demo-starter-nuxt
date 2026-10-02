import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
const suite = process.env.DATABASE_URL ? describe : describe.skip
suite('Medusa additive migration retention', () => {
  for (const prefix of [6, 8]) it(`preserves seeded baseline history ${prefix} and applies provider migration once`, async () => {
    const admin = postgres(process.env.DATABASE_URL!, { max: 1 }), name = `medusa_upgrade_${crypto.randomUUID().replaceAll('-', '')}`
    await admin.unsafe(`CREATE DATABASE "${name}"`)
    const url = new URL(process.env.DATABASE_URL!); url.pathname = `/${name}`
    const client = postgres(url.toString(), { max: 1 }), db = drizzle(client), folder = await mkdtemp(join(tmpdir(), 'medusa-upgrade-'))
    try {
      const full = './server/database/migrations'
      await cp(full, folder, { recursive: true })
      const journalPath = join(folder, 'meta/_journal.json'), journal = JSON.parse(await readFile(journalPath, 'utf8'))
      const expectedHashes = JSON.parse(await readFile('fixtures/medusa-consumer/.fixture/frozen-migrations.json', 'utf8'))
      for (const entry of journal.entries.slice(0, 8)) expect(createHash('sha256').update(await readFile(join(full, `${entry.tag}.sql`))).digest('hex')).toBe(expectedHashes[entry.tag])
      journal.entries = journal.entries.slice(0, prefix); await writeFile(journalPath, JSON.stringify(journal))
      await migrate(db, { migrationsFolder: folder })
      await client`INSERT INTO "user" (id,name,email) VALUES ('medusa-upgrade-owner','Owner','medusa-upgrade@example.test')`
      await client`INSERT INTO project (id,owner_id,name,description) VALUES ('medusa-upgrade-project','medusa-upgrade-owner','Retained','Retained history')`
      const seeded = [...await client`SELECT id,name,description,owner_id,created_at::text,updated_at::text FROM project`]
      const history = [...await client`SELECT * FROM drizzle.__drizzle_migrations ORDER BY id`]
      await migrate(db, { migrationsFolder: full }); await migrate(db, { migrationsFolder: full })
      expect([...await client`SELECT id,name,description,owner_id,created_at::text,updated_at::text FROM project`]).toEqual(seeded)
      const upgraded = [...await client`SELECT * FROM drizzle.__drizzle_migrations ORDER BY id`]
      expect(upgraded.slice(0, history.length)).toEqual(history); expect(upgraded).toHaveLength(9)
      expect([...await client`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'medusa_%'`]).toHaveLength(4)
      expect([...await client`SELECT conname FROM pg_constraint WHERE conname LIKE 'medusa_%_check'`]).toHaveLength(8)
    }
    finally { await client.end(); await admin.unsafe(`DROP DATABASE "${name}"`); await admin.end(); await rm(folder, { recursive: true, force: true }) }
  })
})
