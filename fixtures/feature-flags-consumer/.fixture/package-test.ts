import { verifyProductionBoot } from './boot.ts'
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import pg from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { witness } from './witness.ts'

const url = process.env.DATABASE_URL
assert(url)
const parsed = new URL(url)
assert(['localhost','127.0.0.1','[::1]'].includes(parsed.hostname))
const name = `flags_contract_${crypto.randomUUID().replaceAll('-', '')}`
parsed.pathname = `/${name}`
const admin = new pg.Pool({ connectionString: url, max: 1 })
const observer = new pg.Pool({ connectionString: parsed.toString(), max: 2 })
admin.on('error', () => {})
observer.on('error', () => {})
let created = false
let retained = false
try {
  await admin.query(`CREATE DATABASE "${name}"`)
  created = true
  const [version] = (await observer.query('SHOW server_version_num')).rows
  assert(version && Number(version.server_version_num) >= 180000 && Number(version.server_version_num) < 190000)
  await migrate(drizzle(observer), { migrationsFolder: resolve(import.meta.dirname, '../server/database/migrations') })
  for (const runtime of ['bun','node']) {
    const child = Bun.spawn([runtime, resolve(import.meta.dirname, 'contract.ts')], { env: { ...process.env, FLAGS_PROBE_DATABASE_URL: parsed.toString() }, stdout: 'inherit', stderr: 'inherit' })
    const deadline = setTimeout(() => child.kill('SIGTERM'), 120_000)
    let exit: number
    try { exit = await child.exited } finally { clearTimeout(deadline) }
    assert.equal(exit, 0, 'Feature flags contract failed')
    console.info(`[feature flags fixture] ${runtime}/pg contract passed`)
  }
  await verifyProductionBoot(parsed.toString(), true)
  await writeFile(new URL('./state.json', import.meta.url), JSON.stringify({ name, adminUrl: url, url: parsed.toString(), witness: await witness(observer) }), { mode: 0o600 })
  retained = true
}
finally {
  await observer.end()
  if (created && !retained) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`)
  await admin.end()
}
