import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createJobsBoss } from '@repo/nuxt-jobs/server'
import { access, readFile, unlink, writeFile } from 'node:fs/promises'
import postgres from 'postgres'
import { createStorage } from '@repo/nuxt-storage/server'
import type { StorageOptions } from '@repo/nuxt-storage/server'
import { compose } from './providers'
const path = '.fixture/transfer-survival.json'
export interface RetainedProvider { project: string, config: StorageOptions, objects: { kind: 'source' | 'output', key: string, size: number, hash: string }[], job: { queue: string, id: string, record: unknown } }
interface State { databaseName: string, url: string, snapshot: unknown, providers: RetainedProvider[] }
export async function digestObject(storage: ReturnType<typeof createStorage>, key: string) {
  const object = await storage.getObject(key), hash = createHash('sha256')
  let size = 0
  for await (const chunk of object.body as AsyncIterable<Uint8Array>) { size += chunk.byteLength; hash.update(chunk) }
  return { key, size, hash: hash.digest('hex') }
}
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
      const boss = createJobsBoss({ databaseUrl: state.url, schema: 'pgboss', concurrency: 1, useListenNotify: false }, 'reader')
      try {
        await boss.start()
        for (const fixture of state.providers) {
          assert.deepEqual(JSON.parse(JSON.stringify(await boss.getJobById(fixture.job.queue, fixture.job.id))), fixture.job.record, 'Exact recorded native job survives removal/rebuild')
          assert.deepEqual(fixture.objects.map(object => object.kind), ['source', 'output'])
          const storage = createStorage(fixture.config)
          try {
            for (const object of fixture.objects) {
              assert.equal((await storage.headObject(object.key)).size, object.size)
              assert.deepEqual(await digestObject(storage, object.key), { key: object.key, size: object.size, hash: object.hash }, `${object.kind} digest survives removal/rebuild`)
            }
          }
          finally { storage.close() }
        }
      }
      finally { await boss.stop() }
      console.info('[import-export] exact receipts/domain/history/native jobs/source+output digests survive actual removal/final rebuild')
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
