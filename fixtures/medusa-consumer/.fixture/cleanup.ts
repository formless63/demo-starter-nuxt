import assert from 'node:assert/strict'
import { readFile, unlink } from 'node:fs/promises'
import pg from 'pg'
import { statePath } from './lifecycle'
let state: { name: string } | undefined
try { state = JSON.parse(await readFile(statePath, 'utf8')) }
catch (error) { if ((error as { code?: string }).code !== 'ENOENT') throw error }
if (state) {
  assert.match(state.name, /^medusa_fixture_[a-f0-9]{32}$/)
  const admin = new pg.Pool({ connectionString: process.env.DATABASE_URL!, max: 1 }); admin.on('error', () => {})
  try { await admin.query(`DROP DATABASE "${state.name}"`) }
  finally { await admin.end() }
  await unlink(statePath)
}
