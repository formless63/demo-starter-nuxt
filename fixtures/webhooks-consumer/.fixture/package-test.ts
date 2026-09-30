import assert from 'node:assert/strict'
import { createWebhookEvent, signWebhook } from '@repo/nuxt-webhooks/server'
import { events } from '../server/webhooks/registry'
import { runWebhookSmoke } from './smoke'

await runWebhookSmoke(async (url, secret) => {
  const env = { ...process.env, WEBHOOK_FIXTURE_URL: url, WEBHOOK_FIXTURE_SECRET: secret }
  const worker = Bun.spawn(['bun', 'run', 'webhooks:worker'], { env, stdout: 'pipe', stderr: 'pipe' })
  const workerOutput = new Response(worker.stdout).text()
  const workerErrors = new Response(worker.stderr).text()
  const port = 31000 + Math.floor(Math.random() * 10000)
  const app = Bun.spawn(['node', '.output/server/index.mjs'], { env: { ...env, NITRO_HOST: '127.0.0.1', NITRO_PORT: String(port) }, stdout: 'pipe', stderr: 'pipe' })
  const appOutput = new Response(app.stdout).text()
  const appErrors = new Response(app.stderr).text()
  try {
    let ready = false
    for (let i = 0; i < 100; i++) {
      try { if ((await fetch(`http://127.0.0.1:${port}`)).ok) { ready = true; break } }
      catch { /* wait for Nitro */ }
      await Bun.sleep(100)
    }
    assert(ready, 'Packed Nitro app must start')
    const event = createWebhookEvent(events, 'fixture.ping', { message: 'signed route' })
    const response = await fetch(`http://127.0.0.1:${port}/api/webhook`, { method: 'POST', body: event.body, headers: signWebhook(event.id, Buffer.from(event.body), secret) })
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { accepted: true })
    const invalid = await fetch(`http://127.0.0.1:${port}/api/webhook`, { method: 'POST', body: `${event.body} `, headers: signWebhook(event.id, Buffer.from(event.body), secret) })
    assert.equal(invalid.status, 400)
  }
  catch (error) {
    worker.kill('SIGTERM'); app.kill('SIGTERM')
    await Promise.all([worker.exited, app.exited])
    const logs = `${await appOutput}${await appErrors}${await workerErrors}`.replaceAll(secret, '[redacted]')
    // Raw causes can contain credentials; fixture diagnostics are sanitized.
    // eslint-disable-next-line preserve-caught-error
    throw new Error(`${error instanceof Error ? error.message : 'Fixture failure'}: ${logs}`)
  }
  return async () => {
    worker.kill('SIGTERM'); app.kill('SIGTERM')
    const [code, output, errors, , appLogs, appErrorLogs] = await Promise.all([worker.exited, workerOutput, workerErrors, app.exited, appOutput, appErrors])
    assert.equal(code, 0)
    assert(output.includes('[jobs] worker started') && output.includes('[jobs] worker stopped'))
    assert(!`${output}${errors}${appLogs}${appErrorLogs}`.includes(secret), 'Secret must not be logged')
  }
})
