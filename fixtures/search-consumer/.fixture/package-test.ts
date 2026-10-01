import assert from 'node:assert/strict'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'
import { decodeSearchCursor, encodeSearchCursor, searchDefaults, SearchError, searchRows } from '@repo/nuxt-search/server'
import { article } from '../server/database/schema'

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required')
const admin = postgres(process.env.DATABASE_URL, { max: 1 })
const databaseName = `search_fixture_${crypto.randomUUID().replaceAll('-', '')}`
await admin.unsafe(`CREATE DATABASE "${databaseName}"`)
const url = new URL(process.env.DATABASE_URL)
url.pathname = `/${databaseName}`
const client = postgres(url.toString(), { max: 1 })
const db = drizzle(client)
const columns = { vector: article.vector, updatedAt: article.updatedAt, id: article.id }
const search = (query: string, pageSize?: number, cursor?: string, owner = 'a') => searchRows(columns, eq(article.ownerId, owner), { query, pageSize, cursor }, plan => db
  .select({ id: article.id, title: article.title, rank: plan.rank, cursorUpdatedAt: plan.cursorUpdatedAt })
  .from(article).where(plan.where).orderBy(...plan.orderBy).limit(plan.limit))
const invalid = (e: unknown) => e instanceof SearchError && e.code === 'invalid-query' && !('cause' in e)
try {
  await migrate(db, { migrationsFolder: './server/database/migrations' })
  await migrate(db, { migrationsFolder: './server/database/migrations' })
  const [version] = await client`SHOW server_version_num`
  assert(Number(version!.server_version_num) >= 180000)
  const [vector] = await client`SELECT data_type, is_generated, generation_expression FROM information_schema.columns WHERE table_name='article' AND column_name='search_vector'`
  assert.equal(vector!.data_type, 'tsvector'); assert.equal(vector!.is_generated, 'ALWAYS')
  assert.match(vector!.generation_expression, /simple/)
  const indexes = await client`SELECT indexdef FROM pg_indexes WHERE tablename='article'`
  assert(indexes.some(i => /USING gin \(search_vector\)/.test(i.indexdef)))
  await db.insert(article).values([
    { id: 'a-title', ownerId: 'a', title: 'planet', body: null },
    { id: 'a-body', ownerId: 'a', title: 'other', body: 'planet' },
    { id: 'b-secret', ownerId: 'b', title: 'planet secret' },
    { id: 'phrase', ownerId: 'a', title: 'red green blue' },
    { id: 'split', ownerId: 'a', title: 'red blue green' },
    { id: 'long', ownerId: 'a', title: 'z'.repeat(256) },
  ])
  assert.deepEqual((await search('  planet  ')).items.map(x => x.id), ['a-title', 'a-body'])
  assert((await search('planet')).items[0]!.rank > (await search('planet')).items[1]!.rank)
  assert.deepEqual((await search('planet', undefined, undefined, 'b')).items.map(x => x.id), ['b-secret'])
  assert.deepEqual((await search('"red green"')).items.map(x => x.id), ['phrase'])
  assert.equal((await search('red OR planet')).items.length, 4)
  assert.equal((await search('red -blue')).items.length, 0)
  assert.equal((await search('zz')).items.length, 0)
  assert.equal((await search('z'.repeat(256))).items.length, 1)
  for (const query of ['', ' ', 'x', 'z'.repeat(257), '\0x']) await assert.rejects(search(query), invalid)
  for (const query of ['"', '""', '&&', "planet'); DROP TABLE article; --", '((( ! & | : * ))']) {
    if (query.trim().length >= 2) await search(query)
  }
  for (const pageSize of [0, 101, -1, 1.5, NaN]) await assert.rejects(search('planet', pageSize), invalid)
  assert.equal(searchDefaults.pageSize, 25)
  await db.insert(article).values(Array.from({ length: 30 }, (_, i) => ({ id: `tie-${String(i).padStart(2, '0')}`, ownerId: 'a', title: 'tie', updatedAt: new Date('2026-01-01T00:00:00Z') })))
  // Same JS millisecond, distinct database microseconds. Cursor must preserve both.
  await client`UPDATE article SET updated_at='2026-01-01T00:00:00.000001Z' WHERE id='tie-00'`
  await client`UPDATE article SET updated_at='2026-01-01T00:00:00.000002Z' WHERE id='tie-01'`
  const full = await search('tie', 100)
  assert.equal(full.nextCursor, null)
  assert.equal((await search('tie')).items.length, 25)
  assert.deepEqual(full.items.slice(0, 3).map(x => x.id), ['tie-01', 'tie-00', 'tie-29'])
  const ids: string[] = []
  let cursor: string | undefined
  do {
    const page = await search('tie', 1, cursor)
    ids.push(...page.items.map(x => x.id)); cursor = page.nextCursor ?? undefined
    if (cursor) assert.equal(encodeSearchCursor(decodeSearchCursor(cursor)), cursor)
  } while (cursor)
  assert.deepEqual(ids, full.items.map(x => x.id))
  const first = await search('planet', 1)
  assert.equal((await search('planet', 1, first.nextCursor!)).items[0]!.id, 'a-body')
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
  for (const cursor of ['', '!', 'a'.repeat(1025), first.nextCursor! + '=', encode([2, 0.5, '2026-01-01T00:00:00.000000Z', 'id']), encode([1, 0.1, '2026-01-01T00:00:00.000000Z', 'id']), encode([1, 0.5, '2026-02-30T00:00:00.000000Z', 'id']), encode([1, 0.5, '2026-01-01T00:00:00.000000Z', '']), encode([1, 0.5, '2026-01-01T00:00:00.000000Z', 'id', 'extra'])]) await assert.rejects(search('planet', 1, cursor), invalid)
  const captured: unknown[][] = []
  const original = [console.log, console.info, console.warn, console.error, console.debug]
  const capture = (...args: unknown[]) => { captured.push(args) }
  ;[console.log, console.info, console.warn, console.error, console.debug] = [capture, capture, capture, capture, capture]
  try {
    await search('planet')
    await client`DROP TABLE article`
    await assert.rejects(search('PRIVATE_SEARCH_TEXT'), (e: unknown) => e instanceof SearchError && e.code === 'unavailable' && e.message === 'Search unavailable' && !('cause' in e))
  }
  finally { [console.log, console.info, console.warn, console.error, console.debug] = original }
  assert.equal(captured.length, 0, 'Helpers must not log SQL or raw query text')
  console.info('[search fixture] real PostgreSQL migration/vector/GIN/rank/websearch/owner/cursor/bounds/privacy checks passed')
}
finally {
  await client.end()
  await admin.unsafe(`DROP DATABASE "${databaseName}"`)
  await admin.end()
}
