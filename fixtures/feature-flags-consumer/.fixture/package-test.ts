import { verifyProductionBoot } from './boot.ts'
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { witness } from './witness.ts'

const url = process.env.DATABASE_URL
assert(url)
const parsed = new URL(url)
assert(['localhost','127.0.0.1','[::1]'].includes(parsed.hostname))
const name = `flags_contract_${crypto.randomUUID().replaceAll('-', '')}`
parsed.pathname = `/${name}`
const admin = postgres(url, { max: 1 })
const observer = postgres(parsed.toString(), { max: 2 })
let created = false
let retained = false
try {
  await admin.unsafe(`CREATE DATABASE "${name}"`)
  created = true
  const [version] = await observer`SHOW server_version_num`
  assert(version && Number(version.server_version_num) >= 180000 && Number(version.server_version_num) < 190000)
  await migrate(drizzle(observer), { migrationsFolder: resolve(import.meta.dirname, '../server/database/migrations') })
  for (const runtime of ['bun','node']) for (const driver of ['postgres-js','pg']) {
    const child = Bun.spawn([runtime, resolve(import.meta.dirname, 'contract.ts')], { env: { ...process.env, FLAGS_PROBE_DATABASE_URL: parsed.toString(), FLAGS_PROBE_DRIVER: driver }, stdout: 'inherit', stderr: 'inherit' })
    assert.equal(await child.exited, 0, 'Feature flags contract failed')
    console.info(`[feature flags fixture] ${runtime}/${driver} contract passed`)
  }
  await verifyProductionBoot(parsed.toString(), true)
  await writeFile(new URL('./state.json', import.meta.url), JSON.stringify({ name, adminUrl: url, url: parsed.toString(), witness: await witness(observer) }), { mode: 0o600 })
  retained = true
}
finally {
  await observer.end()
  if (created && !retained) await admin.unsafe(`DROP DATABASE "${name}" WITH (FORCE)`)
  await admin.end()
}
