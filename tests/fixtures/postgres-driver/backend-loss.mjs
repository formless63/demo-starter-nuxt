// Standalone official-driver regression: no application or capability imports.
import assert from 'node:assert/strict'
import { databaseUrl, postgres } from './driver.mjs'

const client = postgres(databaseUrl.toString(), { max: 1, prepare: true })
let callbacks = 0
try {
  await assert.rejects(client.begin(async tx => {
    callbacks++
    await tx`SELECT pg_terminate_backend(pg_backend_pid())`
  }), error => ['CONNECTION_CLOSED', '57P01', 'ECONNRESET'].includes(error.code))
  assert.equal(callbacks, 1)
  // Keep the pool alive after rejection: application teardown is not the trigger.
  await new Promise(resolve => setTimeout(resolve, 100))
  const [row] = await client`SELECT 1::integer AS value`
  assert.equal(row.value, 1)
  console.info('transaction rejection, no replay and subsequent authoritative query passed')
}
finally { await client.end({ timeout: 1 }) }
