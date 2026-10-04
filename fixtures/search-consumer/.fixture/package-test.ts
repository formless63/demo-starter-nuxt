import assert from 'node:assert/strict'
import { eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import pg from 'pg'
import { decodeSearchCursor, encodeSearchCursor, searchDefaults, SearchError, searchRows } from '@repo/nuxt-search/server'
import { article } from '../server/database/schema'
import { goldenCursor, goldenToken, invalidTokens, verifyCursorContract } from './cursor-contract'
import { saveState, snapshot } from './lifecycle'

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required')
const admin = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 })
admin.on('error', () => {})
const databaseName = `search_fixture_${crypto.randomUUID().replaceAll('-', '')}`
await admin.query(`CREATE DATABASE "${databaseName}"`)
const url = new URL(process.env.DATABASE_URL)
url.pathname = `/${databaseName}`
const client = new pg.Pool({ connectionString: url.toString(), max: 1 })
client.on('error', () => {})
const db = drizzle(client)
await saveState({ databaseName, url: url.toString() })
const columns = { vector: article.vector, updatedAt: article.updatedAt, id: article.id }
const search = (query: string, pageSize?: number, cursor?: string, owner = 'a') => searchRows(columns, eq(article.ownerId, owner), { query, pageSize, cursor }, plan => db
  .select({ id: article.id, title: article.title, rank: plan.rank, cursorUpdatedAt: plan.cursorUpdatedAt })
  .from(article).where(plan.where).orderBy(...plan.orderBy).limit(plan.limit))
const invalid = (e: unknown) => e instanceof SearchError && e.code === 'invalid-query' && !('cause' in e)
try {
  verifyCursorContract({ decodeSearchCursor, encodeSearchCursor, searchDefaults })
  await migrate(db, { migrationsFolder: './server/database/migrations' })
  await migrate(db, { migrationsFolder: './server/database/migrations' })
  const [version] = (await client.query(`SHOW server_version_num`)).rows
  assert(Number(version!.server_version_num) >= 180000)
  const [vector] = (await client.query(`SELECT data_type, is_generated, generation_expression FROM information_schema.columns WHERE table_name='article' AND column_name='search_vector'`)).rows
  assert.equal(vector!.data_type, 'tsvector'); assert.equal(vector!.is_generated, 'ALWAYS')
  assert.match(vector!.generation_expression, /simple/)
  const indexes = (await client.query(`SELECT indexdef FROM pg_indexes WHERE tablename='article'`)).rows
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
  for (const query of ['', ' ', 'x', 'z'.repeat(257), '\0x', 'xx\ud800', 'xx\udfff']) await assert.rejects(search(query), invalid)
  for (const query of ['"', '""', '&&', "planet'); DROP TABLE article; --", '((( ! & | : * ))']) {
    if (query.trim().length >= 2) await search(query)
  }
  for (const pageSize of [0, 101, -1, 1.5, NaN]) await assert.rejects(search('planet', pageSize), invalid)
  assert.equal(searchDefaults.pageSize, 25)
  await db.insert(article).values(Array.from({ length: 130 }, (_, i) => ({ id: `tie-${String(i).padStart(3, '0')}`, ownerId: 'a', title: 'body rank', body: 'tie', updatedAt: new Date('2026-01-01T00:00:00Z') })))
  // Same JS millisecond, distinct database microseconds. Cursor must preserve both.
  await client.query(`UPDATE article SET updated_at='2026-01-01T00:00:00.000001Z' WHERE id='tie-000'`)
  await client.query(`UPDATE article SET updated_at='2026-01-01T00:00:00.000002Z' WHERE id='tie-001'`)
  const full = [...(await client.query(`SELECT id FROM article WHERE body='tie' ORDER BY updated_at DESC, id DESC`)).rows].map(x => x.id)
  assert.equal((await search('tie')).items.length, 25)
  assert.deepEqual(full.slice(0, 3), ['tie-001', 'tie-000', 'tie-129'])
  for (const pageSize of [1, undefined, 100]) {
    const ids: string[] = []
    let cursor: string | undefined
    do {
      const page = await search('tie', pageSize, cursor)
      ids.push(...page.items.map(x => x.id)); cursor = page.nextCursor ?? undefined
      for (const row of page.items) assert.equal(row.rank, goldenCursor[1])
      if (cursor) {
        const tuple = decodeSearchCursor(cursor)
        assert.equal(encodeSearchCursor(tuple), cursor)
        assert.equal(tuple[1], JSON.parse(JSON.stringify(page.items.at(-1)))!.rank)
        const [equal] = (await client.query(`SELECT ts_rank_cd(search_vector, websearch_to_tsquery('simple', 'tie'), 32) = $1::real AS exact FROM article WHERE id=$2`, [tuple[1], tuple[3]])).rows
        assert.equal(equal!.exact, true)
      }
    } while (cursor)
    assert.deepEqual(ids, full)
  }
  const [real] = (await client.query(`SELECT (0.2857143::real)::text AS text, encode(float4send(0.2857143::real), 'hex') AS hex`)).rows
  assert.equal(Math.fround(Number(real!.text)), goldenCursor[1]); assert.equal(real!.hex, '3e924925')
  await db.insert(article).values({ id: goldenCursor[3], ownerId: 'a', title: 'body rank', body: 'unicode' })
  await client.query(`UPDATE article SET updated_at=$1::timestamptz WHERE id=$2`, [goldenCursor[2], goldenCursor[3]])
  const unicode = await search('unicode')
  assert.equal(encodeSearchCursor([1, unicode.items[0]!.rank, goldenCursor[2], unicode.items[0]!.id]), goldenToken)
  assert.deepEqual((await search('planet', 100, encodeSearchCursor([1, 1, goldenCursor[2], 'b-secret']), 'a')).items.map(x => x.id), ['a-title', 'a-body'])
  assert((await search('planet', 100, (await search('planet', 1)).nextCursor!, 'b')).items.every(x => x.id === 'b-secret'))
  const first = await search('planet', 1)
  assert.equal((await search('planet', 1, first.nextCursor!)).items[0]!.id, 'a-body')
  for (const cursor of invalidTokens) await assert.rejects(search('planet', 1, cursor), invalid)
  const captured: unknown[][] = []
  const original = [console.log, console.info, console.warn, console.error, console.debug]
  const capture = (...args: unknown[]) => { captured.push(args) }
  ;[console.log, console.info, console.warn, console.error, console.debug] = [capture, capture, capture, capture, capture]
  try {
    await search('planet')
    // Real SQL failure without destroying the table needed for removal survival.
    await assert.rejects(searchRows(columns, eq(article.ownerId, 'a'), { query: 'PRIVATE_SEARCH_TEXT' }, plan => db.select({ id: article.id, title: article.title, rank: sql<number>`missing_search_vector`, cursorUpdatedAt: plan.cursorUpdatedAt }).from(article).where(plan.where).orderBy(...plan.orderBy).limit(plan.limit)), (e: unknown) => e instanceof SearchError && e.code === 'unavailable' && e.message === 'Search unavailable' && !('cause' in e))
  }
  finally { [console.log, console.info, console.warn, console.error, console.debug] = original }
  assert.equal(captured.length, 0, 'Helpers must not log SQL or raw query text')
  await saveState({ databaseName, url: url.toString(), snapshot: await snapshot(client) })
  console.info('[search fixture] real PostgreSQL migration/vector/GIN/rank/websearch/owner/cursor/bounds/privacy checks passed')
}
finally {
  await client.end()
  await admin.end()
}
