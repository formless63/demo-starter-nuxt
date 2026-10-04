import assert from 'node:assert/strict'
import { readFile, writeFile, unlink, access } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import pg from 'pg'
interface State { databaseName: string, url: string, witness?: string, details?: unknown[] }
const statePath = '.fixture/database.json'
export async function details(client: pg.Pool) {
  const records = []
  for (const table of ['invoice_ninja_binding', 'invoice_ninja_projection', 'invoice_ninja_operation', 'invoice_ninja_inbox']) records.push([...(await client.query(`SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY ${table === 'invoice_ninja_projection' ? 'binding_id' : 'id'}`)).rows])
  records.push([...(await client.query('SELECT id,hash,created_at FROM drizzle.__drizzle_migrations ORDER BY id')).rows])
  records.push([...(await client.query("SELECT indexname,indexdef FROM pg_indexes WHERE tablename LIKE 'invoice_ninja_%' ORDER BY indexname")).rows])
  return records
}
export async function witness(client: pg.Pool) {
  return createHash('sha256').update(JSON.stringify(await details(client))).digest('hex')
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
      const client = new pg.Pool({ connectionString: state.url, max: 1 })
      client.on('error', () => {})
      try { if (state.details) assert.deepEqual(await details(client), state.details); assert.equal(await witness(client), state.witness) } finally { await client.end() }
      console.info('Invoice Ninja rows/indexes/migration history retained after removal/rebuild')
    }
    else {
      const admin = new pg.Pool({ connectionString: process.env.DATABASE_URL!, max: 1 })
      admin.on('error', () => {})
      try { await admin.query(`DROP DATABASE "${state.databaseName}"`) } finally { await admin.end() }
      await unlink(statePath)
    }
  }
}
