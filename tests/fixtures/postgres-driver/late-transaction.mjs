// A callback from a dead transaction must not commit a replacement transaction.
import assert from 'node:assert/strict'
import { databaseUrl, postgres } from './driver.mjs'

const pool = postgres(databaseUrl.toString(), { max: 1, onnotice: () => {} })
const admin = postgres(databaseUrl.toString(), { max: 1, onnotice: () => {} })
let resume, ready
const gate = new Promise(resolve => { resume = resolve })
const connected = new Promise(resolve => { ready = resolve })
const old = pool.begin(async tx => {
  const [row] = await tx`SELECT pg_backend_pid()::integer AS pid`
  ready(row.pid)
  await gate
}).then(() => ({ success: true }), error => ({ success: false, code: error.code }))
try {
  // This pid was obtained from this child's own transaction, never operator input.
  await admin`SELECT pg_terminate_backend(${await connected})`
  assert.equal((await old).success, false)
  await pool.begin(async tx => {
    const [before] = await tx`SELECT txid_current()::text AS id`
    resume()
    await new Promise(resolve => setTimeout(resolve, 100))
    const [after] = await tx`SELECT txid_current()::text AS id`
    assert.equal(after.id, before.id, 'Dead callback must not commit replacement transaction')
  })
  console.info('late dead transaction did not affect replacement transaction')
}
finally {
  resume()
  await Promise.all([pool.end({ timeout: 1 }), admin.end({ timeout: 1 })])
}
