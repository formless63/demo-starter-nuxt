import { verifyProductionBoot } from './boot.ts'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import pg from 'pg'
import { witness } from './witness.ts'
const state = JSON.parse(await readFile(new URL('./state.json', import.meta.url), 'utf8')) as { url: string, witness: unknown }
const db = new pg.Pool({ connectionString: state.url, max: 1 })
db.on('error', () => {})
try {
  await verifyProductionBoot(state.url, false)
  assert(JSON.stringify(await witness(db)) === JSON.stringify(state.witness), 'Assignments/indexes/migration history must survive removal/rebuild')
  // Base route policy remains an explicit owner/scope predicate, independent of package code.
  const [record] = (await db.query("SELECT owner_id FROM fixture_record WHERE id LIKE '%-owned' LIMIT 1")).rows
  assert(record)
  const rows = (await db.query("SELECT id FROM fixture_record WHERE owner_id=$1 AND scope_kind='user' AND scope_id=$1", [record.owner_id])).rows
  assert.equal(rows.length, 1)
  assert(String(rows[0]!.id).endsWith('-owned'))
  const [foreign] = (await db.query('SELECT count(*)::integer AS count FROM fixture_record WHERE owner_id <> $1', [record.owner_id])).rows
  assert(foreign && foreign.count > 0)
  console.info('[authorization fixture] retained assignments/indexes/history; remaining owner predicate verified')
}
finally { await db.end() }
