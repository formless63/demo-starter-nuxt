import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import postgres from 'postgres'
import { snapshot, statePath } from './lifecycle'
const state = JSON.parse(await readFile(statePath, 'utf8'))
assert.match(state.name, /^medusa_fixture_[a-f0-9]{32}$/)
await assert.rejects(access('node_modules/@repo/nuxt-medusa'))
await assert.rejects(access('server/api/probe.get.ts'))
await access('node_modules/@repo/nuxt-jobs'); await access('node_modules/@repo/nuxt-webhooks'); await access('.output/server/index.mjs')
const client = postgres(state.url, { max: 1 })
try { assert.deepEqual(JSON.parse(JSON.stringify(await snapshot(client))), state.snapshot) }
finally { await client.end() }
console.info('[medusa] bindings/projections/operations/inbox/indexes/migrations/Jobs retained after removal and rebuild')
