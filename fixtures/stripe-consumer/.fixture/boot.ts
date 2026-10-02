import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { setTimeout as wait } from 'node:timers/promises'
import { once } from 'node:events'
const reservation = createServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening')
const port = (reservation.address() as { port: number }).port; await new Promise<void>(resolve => reservation.close(() => resolve()))
const child = spawn(process.execPath, ['.output/server/index.mjs'], { env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), STRIPE_SECRET_KEY: '', STRIPE_ACCOUNT_ID: '' }, stdio: ['ignore', 'pipe', 'pipe'] })
let logs = ''; child.stdout.on('data', chunk => { logs += String(chunk) }); child.stderr.on('data', chunk => { logs += String(chunk) })
try {
  let response: Response | undefined
  for (let attempt = 0; attempt < 100; attempt++) { try { response = await fetch(`http://127.0.0.1:${port}/api/stripe-status`); break } catch { await wait(100) } }
  assert.ok(response, 'Node production consumer starts without Stripe configuration')
  assert.equal(response.status, 503); assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.deepEqual(await response.json(), { error: { code: 'unconfigured', message: 'Integration is not configured.', retryable: false } })
  assert.equal((await fetch(`http://127.0.0.1:${port}/`)).status, 200)
  assert.ok(!/sk_test|StripeConnectionError|stack trace/.test(logs))
  console.info('Unconfigured Node24 production consumer boots with safe lazy503 and no provider calls.')
}
finally { child.kill('SIGTERM'); await once(child, 'exit') }
