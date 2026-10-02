import assert from 'node:assert/strict'
import { readFile, writeFile, unlink, access } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import postgres from 'postgres'
interface State { databaseName: string, url: string, witness?: string }
const statePath = '.fixture/database.json'
export async function witness(client: ReturnType<typeof postgres>) {
  const records = []
  for (const table of ['invoice_ninja_binding', 'invoice_ninja_projection', 'invoice_ninja_operation', 'invoice_ninja_inbox']) records.push([...await client.unsafe(`SELECT * FROM ${table} ORDER BY 1`)])
  records.push([...await client`SELECT id,hash,created_at FROM drizzle.__drizzle_migrations ORDER BY id`])
  records.push([...await client`SELECT indexname,indexdef FROM pg_indexes WHERE tablename LIKE 'invoice_ninja_%' ORDER BY indexname`])
  return createHash('sha256').update(JSON.stringify(records)).digest('hex')
}
export function saveState(state: State) { return writeFile(statePath, JSON.stringify(state)) }
const command = process.argv[2]
if (command === 'verify' || command === 'cleanup') {
  let state: State | undefined
  try { state = JSON.parse(await readFile(statePath, 'utf8')) as State }
  catch (error) { if (command !== 'cleanup' || !(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error }
  if (state) {
    assert.match(state.databaseName, /^invoice_nuxt_fixture_[a-f0-9]{32}$/)
    if (command === 'verify') {
      await assert.rejects(access('node_modules/@repo/nuxt-invoice-ninja')); await access('.output/server/index.mjs')
      const client = postgres(state.url, { max: 1 })
      try { assert.equal(await witness(client), state.witness) } finally { await client.end() }
      console.info('Invoice Ninja rows/indexes/migration history retained after removal/rebuild')
    }
    else {
      const admin = postgres(process.env.DATABASE_URL!, { max: 1 })
      try { await admin.unsafe(`DROP DATABASE "${state.databaseName}"`) } finally { await admin.end() }
      await unlink(statePath)
    }
  }
}
