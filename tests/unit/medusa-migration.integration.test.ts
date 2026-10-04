import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import pg from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
const suite = process.env.DATABASE_URL ? describe : describe.skip
suite('Medusa additive migration retention', () => {
  for (const prefix of [6, 8]) it(`preserves seeded baseline history ${prefix} and applies provider migration once`, async () => {
    const admin = new pg.Pool({ connectionString: process.env.DATABASE_URL!, max: 1 }).on('error', () => {}), name = `medusa_upgrade_${crypto.randomUUID().replaceAll('-', '')}`
    await admin.query(`CREATE DATABASE "${name}"`)
    const url = new URL(process.env.DATABASE_URL!); url.pathname = `/${name}`
    const client = new pg.Pool({ connectionString: url.toString(), max: 1 }).on('error', () => {}), db = drizzle(client), folder = await mkdtemp(join(tmpdir(), 'medusa-upgrade-'))
    try {
      const full = './server/database/migrations'
      await cp(full, folder, { recursive: true })
      const journalPath = join(folder, 'meta/_journal.json'), journal = JSON.parse(await readFile(journalPath, 'utf8'))
      const expectedHashes = JSON.parse(await readFile('fixtures/medusa-consumer/.fixture/frozen-migrations.json', 'utf8'))
      for (const entry of journal.entries.slice(0, 8)) expect(createHash('sha256').update(await readFile(join(full, `${entry.tag}.sql`))).digest('hex')).toBe(expectedHashes[entry.tag])
      const fullEntries = [...journal.entries] as { idx: number, when: number, tag: string }[]
      expect(fullEntries.map(entry => entry.idx)).toEqual(fullEntries.map((_, index) => index))
      expect(fullEntries.slice(8).map(entry => entry.tag)).toEqual(['0009_invoice_ninja', '0011_stripe_v1', '0012_stripe_receipt_conflicts', '0013_medusa', '0014_file_ui', '0015_third_justice', '0016_bored_shocker', '0017_mushy_cannonball'])
      const fullHashes = await Promise.all(fullEntries.map(async entry => createHash('sha256').update(await readFile(join(full, `${entry.tag}.sql`))).digest('hex')))
      journal.entries = journal.entries.slice(0, prefix); await writeFile(journalPath, JSON.stringify(journal))
      await migrate(db, { migrationsFolder: folder })
      await client.query(`INSERT INTO "user" (id,name,email) VALUES ('medusa-upgrade-owner','Owner','medusa-upgrade@example.test')`)
      await client.query(`INSERT INTO project (id,owner_id,name,description) VALUES ('medusa-upgrade-project','medusa-upgrade-owner','Retained','Retained history')`)
      const seeded = (await client.query(`SELECT id,name,description,owner_id,created_at::text,updated_at::text FROM project`)).rows
      const history = (await client.query(`SELECT * FROM drizzle.__drizzle_migrations ORDER BY id`)).rows
      await migrate(db, { migrationsFolder: full }); await migrate(db, { migrationsFolder: full })
      expect((await client.query(`SELECT id,name,description,owner_id,created_at::text,updated_at::text FROM project`)).rows).toEqual(seeded)
      const upgraded = (await client.query(`SELECT * FROM drizzle.__drizzle_migrations ORDER BY id`)).rows
      expect(upgraded.slice(0, history.length)).toEqual(history); expect(upgraded).toHaveLength(fullEntries.length)
      expect(upgraded.map(row => row.hash)).toEqual(fullHashes)
      expect(upgraded.map(row => Number(row.created_at))).toEqual(fullEntries.map(entry => entry.when))
      expect((await client.query(`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'medusa_%'`)).rows).toHaveLength(4)
      expect((await client.query(`SELECT conname FROM pg_constraint WHERE conname LIKE 'medusa_%_check'`)).rows).toHaveLength(8)
    }
    finally { await client.end(); await admin.query(`DROP DATABASE "${name}"`); await admin.end(); await rm(folder, { recursive: true, force: true }) }
  })
})
