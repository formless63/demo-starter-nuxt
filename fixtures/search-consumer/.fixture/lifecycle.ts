import assert from 'node:assert/strict'
import { access, readFile, unlink, writeFile } from 'node:fs/promises'
import pg from 'pg'

const statePath = '.fixture/search-database.json'
interface State { databaseName: string, url: string, snapshot?: unknown }
export async function snapshot(client: pg.Pool) {
  return {
    rows: [...(await client.query(`SELECT id, owner_id, title, body, updated_at::text, search_vector::text FROM article ORDER BY id`)).rows],
    vector: [...(await client.query(`SELECT data_type, is_generated, generation_expression FROM information_schema.columns WHERE table_name='article' AND column_name='search_vector'`)).rows],
    gin: [...(await client.query(`SELECT indexname, indexdef FROM pg_indexes WHERE tablename='article' AND indexname='article_search_gin_idx'`)).rows],
    history: [...(await client.query(`SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id`)).rows],
  }
}
export async function saveState(state: State) { await writeFile(statePath, JSON.stringify(state)) }

const [command] = Bun.argv.slice(2)
if (command === 'verify' || command === 'cleanup') {
  let state: State | undefined
  try { state = JSON.parse(await readFile(statePath, 'utf8')) as State }
  catch (error) {
    if (command !== 'cleanup' || !(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
  }
  if (state) {
    if (command === 'verify') {
      await assert.rejects(access('node_modules/@repo/nuxt-search'))
      await access('.output/server/index.mjs')
      const client = new pg.Pool({ connectionString: state.url, max: 1 })
      client.on('error', () => {})
      try { assert.deepEqual(await snapshot(client), state.snapshot) }
      finally { await client.end() }
      console.info('[search fixture] rows/generated vector/GIN/immutable migration hashes survived package removal and final rebuild')
    }
    else {
      assert.match(state.databaseName, /^search_fixture_[a-f0-9]{32}$/)
      const admin = new pg.Pool({ connectionString: process.env.DATABASE_URL!, max: 1 })
      admin.on('error', () => {})
      try { await admin.query(`DROP DATABASE "${state.databaseName}"`) }
      finally { await admin.end() }
      await unlink(statePath)
    }
  }
}
