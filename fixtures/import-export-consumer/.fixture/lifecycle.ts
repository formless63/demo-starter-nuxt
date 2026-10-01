import assert from 'node:assert/strict'
import { access, readFile, unlink, writeFile } from 'node:fs/promises'
import postgres from 'postgres'
import { createStorage } from '@repo/nuxt-storage/server'
import type { StorageOptions } from '@repo/nuxt-storage/server'
import { compose } from './providers'
const path = '.fixture/transfer-survival.json'
interface State { databaseName: string, url: string, snapshot: unknown, providers: { project: string, config: StorageOptions, key: string }[] }
export async function snapshot(connection: ReturnType<typeof postgres>) {
  return { receipts: [...await connection`select to_jsonb(t) as record from transfer t order by id`], domain: [...await connection`select to_jsonb(t) as record from fixture_project t order by id`], history: [...await connection`select to_jsonb(t) as record from drizzle.__drizzle_migrations t order by id`], jobs: [...await connection`select nspname from pg_namespace where nspname='pgboss'`] }
}
export async function saveState(state: State) { await writeFile(path, JSON.stringify(state), { mode: 0o600 }) }
if (['verify', 'cleanup'].includes(process.argv[2] ?? '')) {
  let state: State | undefined
  try { state = JSON.parse(await readFile(path, 'utf8')) as State }
  catch (error) { if (process.argv[2] !== 'cleanup' || (error as { code?: string }).code !== 'ENOENT') throw error }
  if (state) {
    assert.match(state.databaseName, /^transfer_fixture_[a-f0-9]{32}$/)
    if (process.argv[2] === 'verify') {
      await assert.rejects(access('node_modules/@repo/nuxt-import-export'))
      await access('node_modules/@repo/nuxt-jobs'); await access('node_modules/@repo/nuxt-storage'); await access('.output/server/index.mjs')
      const connection = postgres(state.url, { max: 1 })
      try { assert.deepEqual(JSON.parse(JSON.stringify(await snapshot(connection))), state.snapshot) }
      finally { await connection.end() }
      for (const fixture of state.providers) {
        const storage = createStorage(fixture.config)
        try { assert((await storage.headObject(fixture.key)).size! > 0) }
        finally { storage.close() }
      }
      console.info('[import-export] receipts/domain/migration history/Jobs/source objects survive removal/rebuild')
    }
    else {
      for (const fixture of state.providers) {
        assert.match(fixture.project, /^transfer-test-(?:rustfs|garage)-[a-f0-9]{8}$/)
        await compose(fixture.project, ['down', '--volumes', '--remove-orphans'])
      }
      const admin = postgres(process.env.DATABASE_URL!, { max: 1 })
      try { await admin.unsafe(`DROP DATABASE "${state.databaseName}" WITH (FORCE)`) }
      finally { await admin.end() }
      await unlink(path)
    }
  }
}
