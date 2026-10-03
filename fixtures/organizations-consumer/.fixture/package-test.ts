import { verifyProductionBoot } from './boot.ts'
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { witness } from './witness.ts'
import { resolve } from 'node:path'
import postgres from 'postgres'
import { seedProbeRecords } from './probe-database.ts'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'

const url = process.env.DATABASE_URL
assert(url, 'A disposable local PostgreSQL 18 service is required')
const parsed = new URL(url)
assert(['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname))
const admin = postgres(url, { max: 1 })
const name = `organizations_contract_${crypto.randomUUID().replaceAll('-', '')}`
parsed.pathname = `/${name}`
const observer = postgres(parsed.toString(), { max: 1 })
let created = false
let retained = false
try {
  await admin.unsafe(`CREATE DATABASE "${name}"`)
  created = true
  await migrate(drizzle(observer), { migrationsFolder: resolve(import.meta.dirname, '../server/database/migrations') })
  await seedProbeRecords(observer)
  await observer`DROP TRIGGER pause_probe_member ON member`
  for (const runtime of ['bun', 'node']) {
    for (const driver of ['postgres-js', 'pg']) {
      const child = Bun.spawn([runtime, resolve(import.meta.dirname, 'contract.ts')], {
        env: { ...process.env, ORGANIZATIONS_PROBE_DATABASE_URL: parsed.toString(), ORGANIZATIONS_PROBE_DRIVER: driver },
        stdin: 'ignore', stdout: 'inherit', stderr: 'inherit',
      })
      const deadline = setTimeout(() => child.kill('SIGTERM'), 120_000)
    let exit: number
    try { exit = await child.exited } finally { clearTimeout(deadline) }
    assert.equal(exit, 0, 'Organizations native contract failed')
      console.info(`[organizations fixture] ${runtime}/${driver} native dispatch contract passed`)
    }
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
  if (created && !retained) await admin.unsafe(`DROP DATABASE "${name}" WITH (FORCE)`)
  await admin.end()
}
