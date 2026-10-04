import { verifyProductionBoot } from './boot.ts'
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { witness } from './witness.ts'
import { resolve } from 'node:path'
import pg from 'pg'
import { seedProbeRecords } from './probe-database.ts'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'

const url = process.env.DATABASE_URL
assert(url, 'A disposable local PostgreSQL 18 service is required')
const parsed = new URL(url)
assert(['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname))
const admin = new pg.Pool({ connectionString: url, max: 1 })
admin.on('error', () => {})
const name = `organizations_contract_${crypto.randomUUID().replaceAll('-', '')}`
parsed.pathname = `/${name}`
const observer = new pg.Pool({ connectionString: parsed.toString(), max: 1 })
observer.on('error', () => {})
let created = false
let retained = false
try {
  await admin.query(`CREATE DATABASE "${name}"`)
  created = true
  await migrate(drizzle(observer), { migrationsFolder: resolve(import.meta.dirname, '../server/database/migrations') })
  await seedProbeRecords(observer)
  await observer.query(`DROP TRIGGER pause_probe_member ON member`)
  for (const runtime of ['bun', 'node']) {
    const child = Bun.spawn([runtime, resolve(import.meta.dirname, 'contract.ts')], {
      env: { ...process.env, ORGANIZATIONS_PROBE_DATABASE_URL: parsed.toString() },
      stdin: 'ignore', stdout: 'inherit', stderr: 'inherit',
    })
    const deadline = setTimeout(() => child.kill('SIGTERM'), 120_000)
    let exit: number
    try { exit = await child.exited } finally { clearTimeout(deadline) }
    assert.equal(exit, 0, 'Organizations native contract failed')
    console.info(`[organizations fixture] ${runtime}/pg native dispatch contract passed`)
  }
  // Native process interruption semantics are independently proven, with all protections still supplied by native dispatch.
  const crash = Bun.spawn(['bun', resolve(import.meta.dirname, 'upstream-atomicity.ts')], { env: { ...process.env, DATABASE_URL: url }, stdout: 'inherit', stderr: 'inherit' })
  assert.equal(await crash.exited, 0)
  await verifyProductionBoot(parsed.toString(), true)
  await writeFile(new URL('./state.json', import.meta.url), JSON.stringify({ name, adminUrl: url, url: parsed.toString(), witness: await witness(observer) }), { mode: 0o600 })
  retained = true
}
finally {
  await observer.end()
  if (created && !retained) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`)
  await admin.end()
}
