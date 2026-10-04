import assert from 'node:assert/strict'
import { access, readFile, unlink, writeFile } from 'node:fs/promises'
import pg from 'pg'
const statePath = '.fixture/notifications-database.json'
interface State { databaseName: string, url: string, snapshot?: unknown }
export async function snapshot(client: pg.Pool) {
  const rows = async (text: string) => (await client.query(text)).rows
  return {
    rows: [...await rows(`SELECT id,recipient_id,type,title,body,metadata,created_at::text,read_at::text FROM notification ORDER BY id`)],
    indexes: [...await rows(`SELECT indexname,indexdef FROM pg_indexes WHERE tablename='notification' ORDER BY indexname`)],
    history: [...await rows(`SELECT id,hash,created_at FROM drizzle.__drizzle_migrations ORDER BY id`)],
    jobs: [...await rows(`SELECT nspname FROM pg_namespace WHERE nspname='notifications_fixture_jobs'`)],
  }
}
export async function saveState(state: State) { await writeFile(statePath, JSON.stringify(state)) }
const [command] = Bun.argv.slice(2)
if (command === 'verify' || command === 'cleanup') {
  let state: State | undefined
  try { state = JSON.parse(await readFile(statePath, 'utf8')) as State }
  catch (error) { if (command !== 'cleanup' || !(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error }
  if (state) {
    assert.match(state.databaseName, /^notifications_fixture_[a-f0-9]{32}$/)
    if (command === 'verify') {
      await assert.rejects(access('node_modules/@repo/nuxt-notifications'))
      await access('node_modules/@repo/nuxt-jobs')
      await access('.output/server/index.mjs')
      const client = new pg.Pool({ connectionString: state.url, max: 1 })
      client.on('error', () => {})
      try { assert.deepEqual(JSON.parse(JSON.stringify(await snapshot(client))), state.snapshot) }
      finally { await client.end() }
      console.info('[notifications fixture] rows/indexes/migration history/Jobs survived removal and final rebuild')
    }
    else {
      const admin = new pg.Pool({ connectionString: process.env.DATABASE_URL!, max: 1 })
      admin.on('error', () => {})
      try { await admin.query(`DROP DATABASE "${state.databaseName}"`) }
      finally { await admin.end() }
      await unlink(statePath)
    }
  }
}
