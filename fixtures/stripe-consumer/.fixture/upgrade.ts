import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
const admin = postgres(process.env.DATABASE_URL!, { max: 1 }), name = `stripe_upgrade_${randomUUID().replaceAll('-', '')}`, root = await mkdtemp(join(tmpdir(), 'stripe-upgrade-'))
await admin.unsafe(`create database "${name}"`)
const url = new URL(process.env.DATABASE_URL!); url.pathname = `/${name}`
const sql = postgres(url.toString(), { max: 1 }), db = drizzle(sql)
try {
  const source = '.fixture/upgrade-baseline'
  const baseline = JSON.parse(await readFile(`${source}/meta/_journal.json`, 'utf8')) as { entries: { idx: number, tag: string, when: number }[], version: string, dialect: string }
  await cp(source, root, { recursive: true })
  await writeFile(join(root, 'meta/_journal.json'), JSON.stringify({ ...baseline, entries: baseline.entries.slice(0, 6) }))
  await migrate(db, { migrationsFolder: root })
  await sql`insert into "user"(id,name,email) values('upgrade-owner','Retained','upgrade@example.test')`
  await sql`insert into project(id,name,owner_id) values('upgrade-project','Retained Project','upgrade-owner')`
  const prior = await sql`select hash,created_at from drizzle.__drizzle_migrations order by id`
  await writeFile(join(root, 'meta/_journal.json'), JSON.stringify(baseline))
  await migrate(db, { migrationsFolder: root })
  await sql`insert into transfer(id,requester_id,scope_kind,scope_id,definition,version,direction,status) values('11111111-1111-4111-8111-111111111111','upgrade-owner','user','upgrade-owner','projects','1','export','cancelled')`
  const original = await sql`select hash,created_at from drizzle.__drizzle_migrations order by id`
  assert.deepEqual([...original].slice(0, 6), [...prior])
  for (let index = 0; index < baseline.entries.length; index++) {
    const entry = baseline.entries[index]!, digest = createHash('sha256').update(await readFile(`${source}/${entry.tag}.sql`)).digest('hex')
    assert.equal(original[index]!.hash, digest); assert.equal(Number(original[index]!.created_at), entry.when)
  }
  assert.equal(original[6]!.hash, '766093a48babe3de827640ff1df8849ea1f7b98563316236a300c970f1734efc')
  assert.equal(original[7]!.hash, '42ffa2c13e1b2f9cff83ab6bfc51d65351fabd2987a44a0b89528b864015552b')
  const provider = JSON.parse(await readFile('.fixture/migrations/meta/_journal.json', 'utf8')) as typeof baseline
  for (const entry of provider.entries) await cp(`.fixture/migrations/${entry.tag}.sql`, join(root, `${entry.tag}.sql`))
  await writeFile(join(root, 'meta/_journal.json'), JSON.stringify({ ...baseline, entries: [...baseline.entries, ...provider.entries.map((entry, index) => ({ ...entry, idx: baseline.entries.length + index }))] }))
  await migrate(db, { migrationsFolder: root }); await migrate(db, { migrationsFolder: root })
  const after = await sql`select hash,created_at from drizzle.__drizzle_migrations order by id`
  assert.equal(after.length, baseline.entries.length + provider.entries.length); assert.deepEqual([...after].slice(0, 8), [...original])
  assert.equal((await sql`select count(*)::int n from project where id='upgrade-project'`)[0]!.n, 1)
  assert.equal((await sql`select count(*)::int n from transfer where requester_id='upgrade-owner'`)[0]!.n, 1)
  assert.equal((await sql`select count(*)::int n from pg_tables where tablename like 'stripe_%'`)[0]!.n, 4)
  console.info('Seeded pre-Import and frozen-main upgrades preserve all eight migration bytes/hashes/times and existing data; repeat apply is no-op.')
}
finally { await sql.end(); await admin.unsafe(`drop database "${name}" with (force)`); await admin.end(); await rm(root, { recursive: true, force: true }) }
