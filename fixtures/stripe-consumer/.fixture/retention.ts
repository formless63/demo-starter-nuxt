import assert from 'node:assert/strict'
import { readFile, unlink, access } from 'node:fs/promises'
import postgres from 'postgres'
const mode = process.argv[2]
let state: { name: string, url: string, snapshot: unknown } | undefined
try { state = JSON.parse(await readFile('.fixture/retained.json', 'utf8')) as typeof state } catch (error) { if (mode !== 'cleanup' || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
if (state) {
  assert.match(state.name, /^stripe_fixture_[a-f0-9]{32}$/)
  if (mode === 'verify') {
    await assert.rejects(access('node_modules/@repo/nuxt-stripe')); await assert.rejects(access('node_modules/stripe'))
    await access('node_modules/@repo/nuxt-jobs'); await access('node_modules/@repo/nuxt-webhooks'); await access('.output/server/index.mjs')
    const sql = postgres(state.url, { max: 1 })
    try {
      const snapshot = await sql`select (select jsonb_agg(to_jsonb(t) order by id) from stripe_binding t) bindings,(select jsonb_agg(to_jsonb(t) order by id) from stripe_operation t) operations,(select jsonb_agg(to_jsonb(t) order by binding_id) from stripe_projection t) projections,(select jsonb_agg(to_jsonb(t) order by id) from stripe_inbox t) inbox,(select jsonb_agg(to_jsonb(t) order by id) from drizzle.__drizzle_migrations t) history`
      assert.deepEqual(JSON.parse(JSON.stringify(snapshot)), state.snapshot)
      assert.equal((await sql`select count(*)::int n from pg_namespace where nspname='pgboss'`)[0]!.n, 1)
      console.info('Stripe rows and Jobs retained after removal and rebuild.')
    }
    finally { await sql.end() }
  }
  else if (mode === 'cleanup') {
    const url = new URL(state.url); url.pathname = '/postgres'
    const sql = postgres(url.toString(), { max: 1 })
    try { await sql.unsafe(`drop database "${state.name}" with (force)`); await unlink('.fixture/retained.json') }
    finally { await sql.end() }
  }
}
