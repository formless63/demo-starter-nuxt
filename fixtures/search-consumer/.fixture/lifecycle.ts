import assert from 'node:assert/strict'
import { access, readFile, unlink, writeFile } from 'node:fs/promises'
import postgres from 'postgres'

const statePath = '.fixture/search-database.json'
interface State { databaseName: string, url: string, snapshot?: unknown }
export async function snapshot(client: ReturnType<typeof postgres>) {
  return {
    rows: [...await client`SELECT id, owner_id, title, body, updated_at::text, search_vector::text FROM article ORDER BY id`],
    vector: [...await client`SELECT data_type, is_generated, generation_expression FROM information_schema.columns WHERE table_name='article' AND column_name='search_vector'`],
    gin: [...await client`SELECT indexname, indexdef FROM pg_indexes WHERE tablename='article' AND indexname='article_search_gin_idx'`],
    history: [...await client`SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id`],
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
      const client = postgres(state.url, { max: 1 })
      try { assert.deepEqual(await snapshot(client), state.snapshot) }
      finally { await client.end() }
      console.info('[search fixture] rows/generated vector/GIN/immutable migration hashes survived package removal and final rebuild')
    }
    else {
      assert.match(state.databaseName, /^search_fixture_[a-f0-9]{32}$/)
      const admin = postgres(process.env.DATABASE_URL!, { max: 1 })
      try { await admin.unsafe(`DROP DATABASE "${state.databaseName}"`) }
      finally { await admin.end() }
      await unlink(statePath)
    }
  }
}
