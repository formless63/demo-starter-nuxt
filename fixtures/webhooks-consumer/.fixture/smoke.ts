import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'
import { once } from 'node:events'
import { createJobsBoss, defineJobRegistry, defineQueues, registerWorkers, resolveJobsConfig, sendRegisteredJob } from '@repo/nuxt-jobs/server'
import { runJobsMigration } from '@repo/nuxt-jobs/cli'
import { createWebhookEvent, createWebhookJobs, defineWebhookEvents, verifyWebhookRequest } from '@repo/nuxt-webhooks/server'
import { z } from 'zod'

export async function runWebhookSmoke(startWorker?: (url: string, secret: string) => Promise<() => Promise<void>>) {
  const events = defineWebhookEvents({ 'fixture.ping': z.object({ message: z.string().min(1).max(200) }).strict() })
  const secret = `whsec_${randomBytes(32).toString('base64')}`
  const received: string[] = []
  const attempts = new Map<string, number>()
  const server = createServer(async (incoming, response) => {
    try {
      const chunks: Buffer[] = []
      for await (const chunk of incoming) chunks.push(Buffer.from(chunk))
      const body = Buffer.concat(chunks)
      const request = new Request('http://localhost/receiver', {
        method: 'POST', headers: incoming.headers as Record<string, string>, body,
      })
      const event = await verifyWebhookRequest(request, { events, secrets: [secret] })
      received.push(body.toString())
      assert.equal(event.data.message, 'signed smoke')
      const count = (attempts.get(incoming.url!) ?? 0) + 1
      attempts.set(incoming.url!, count)
      response.statusCode = incoming.url === '/permanent' ? 400 : incoming.url === '/exhaust' || count === 1 ? 503 : 204
      response.end(response.statusCode === 204 ? undefined : 'private response body')
    }
    catch { response.statusCode = 400; response.end() }
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  assert(address && typeof address === 'object')
  const url = `http://127.0.0.1:${address.port}`
  const webhooks = createWebhookJobs({ events, retryDelaySeconds: 1, retryLimit: 2, targetPolicy: { allowLocalHttp: true }, resolveTarget: ref => ({ url: `${url}/${ref}`, secret }) })
  const registry = defineJobRegistry(webhooks.delivery)
  const previousSchema = process.env.PGBOSS_SCHEMA
  process.env.PGBOSS_SCHEMA = `webhook_fixture_${randomBytes(8).toString('hex')}`
  const config = resolveJobsConfig()
  let stopWorker: (() => Promise<void>) | undefined
  const boss = createJobsBoss(config)
  try {
    await runJobsMigration()
    await boss.start()
    await defineQueues(boss, registry)
    if (startWorker) stopWorker = await startWorker(url, secret)
    else await registerWorkers(boss, registry, 1)
    const event = createWebhookEvent(events, 'fixture.ping', { message: 'signed smoke' })
    for (const targetRef of ['retry', 'permanent', 'exhaust']) {
      const id = await sendRegisteredJob(boss, registry, 'webhooks.deliver', webhooks.prepare(targetRef, event))
      const deadline = Date.now() + 45_000
      let settled = false
      while (Date.now() < deadline) {
        const job = await boss.getJobById('webhooks.deliver', id)
        if (job?.state === 'completed' || job?.state === 'failed') {
          if (targetRef === 'exhaust') {
            assert.equal(job.state, 'failed')
            assert.equal(attempts.get('/exhaust'), 3)
          }
          else {
            assert.equal(job.state, 'completed')
            assert.deepEqual(job.output, targetRef === 'retry' ? { outcome: 'delivered', status: 204 } : { outcome: 'rejected', code: 'remote-status', status: 400 })
            assert.equal(attempts.get(`/${targetRef}`), targetRef === 'retry' ? 2 : 1)
          }
          assert(!JSON.stringify(job.output).includes('private response'))
          settled = true
          break
        }
        await new Promise(resolve => setTimeout(resolve, 100))
      }
      assert(settled, 'Job must settle within bounded smoke deadline')
    }
    assert(received.length === 6 && received.every(body => body === event.body), 'All attempts must reuse exact bytes')
    console.info('[webhooks] signed outbound, inbound verification, durable retries and terminal outcomes passed')
  }
  finally {
    await stopWorker?.()
    await boss.stop({ graceful: true, timeout: 5000 })
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
    if (previousSchema === undefined) delete process.env.PGBOSS_SCHEMA
    else process.env.PGBOSS_SCHEMA = previousSchema
  }
}
