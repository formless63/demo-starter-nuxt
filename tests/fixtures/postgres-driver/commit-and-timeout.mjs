// TEMP tables belong only to this connection and vanish on teardown.
import assert from 'node:assert/strict'
import { databaseUrl, postgres } from './driver.mjs'

const client = postgres(databaseUrl.toString(), { max: 1, onnotice: () => {} })
async function nextQuery() {
  assert.equal((await client`SELECT 1::integer AS value`)[0].value, 1)
}
try {
  await assert.rejects(client.begin(async tx => {
    await tx`CREATE TEMP TABLE commit_probe (id integer, UNIQUE(id) DEFERRABLE INITIALLY DEFERRED) ON COMMIT DROP`
    await tx`INSERT INTO commit_probe VALUES(1),(1)`
  }), error => error.code === '23505')
  await nextQuery()
  await assert.rejects(client.begin(async tx => {
    await tx`SET LOCAL statement_timeout='20ms'`
    await tx`SELECT pg_sleep(1)`
  }), error => error.code === '57014')
  await nextQuery()
  await assert.rejects(client.begin(async tx => {
    await tx`SELECT 1`
    throw new Error('caller rollback')
  }), /caller rollback/)
  await nextQuery()
  console.info('deferred commit failure, statement cancellation and caller rollback passed')
}
finally { await client.end({ timeout: 1 }) }
