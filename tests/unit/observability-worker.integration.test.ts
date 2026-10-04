import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { describe, expect, it } from 'vitest'
import pg from 'pg'
import { createJobsBoss, resolveJobsConfig } from '@repo/nuxt-jobs/server'

const databaseUrl = process.env.DATABASE_URL
const describeWithDatabase = databaseUrl ? describe : describe.skip

describeWithDatabase('optional telemetry in the real standalone Jobs worker', () => {
  it('drains then exports real job spans/metrics on SIGTERM without logging payloads', async () => {
    const received: Array<{ path: string, body: string }> = []
    const receiver = createServer(async (request, response) => {
      let body = ''
      for await (const chunk of request) body += chunk.toString()
      received.push({ path: request.url!, body })
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end('{}')
    })
    await new Promise<void>(resolve => receiver.listen(0, '127.0.0.1', resolve))
    const endpoint = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}`
    const schema = `obs_worker_${crypto.randomUUID().replaceAll('-', '')}`
    const config = { ...resolveJobsConfig(), databaseUrl: databaseUrl!, schema }
    const migrator = createJobsBoss(config, true)
    const producer = createJobsBoss(config)
    const client = new pg.Pool({ connectionString: databaseUrl!, max: 1 }).on('error', () => {})
    let worker: ReturnType<typeof spawn> | undefined
    let output = ''
    let errors = ''

    async function until(check: () => boolean | Promise<boolean>) {
      const deadline = Date.now() + 12_000
      while (Date.now() < deadline) {
        if (await check()) return
        if (worker?.exitCode !== null && worker?.exitCode !== undefined) throw new Error(`Worker exited: ${errors}`)
        await new Promise(resolve => setTimeout(resolve, 100))
      }
      throw new Error('Worker did not reach the expected state')
    }

    try {
      await migrator.start()
      await migrator.stop({ graceful: false })
      worker = spawn('bun', ['scripts/jobs-worker.ts'], {
        env: { ...process.env, DATABASE_URL: databaseUrl!, PGBOSS_DATABASE_URL: databaseUrl!, PGBOSS_SCHEMA: schema,
          OTEL_EXPORTER_OTLP_ENDPOINT: endpoint, OTEL_SDK_DISABLED: 'false',
          OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: '', OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: '',
          OTEL_TRACES_EXPORTER: 'otlp', OTEL_METRICS_EXPORTER: 'otlp', OTEL_EXPORTER_OTLP_HEADERS: '',
        }, stdio: ['ignore', 'pipe', 'pipe'],
      })
      worker.stdout!.on('data', chunk => { output += chunk.toString() })
      worker.stderr!.on('data', chunk => { errors += chunk.toString() })
      const closed = new Promise<number | null>((resolve, reject) => {
        worker!.once('close', resolve)
        worker!.once('error', reject)
      })
      await until(() => output.includes('[jobs] worker started'))
      await producer.start()
      const id = await producer.send('starter.echo', { message: 'WORKER_PAYLOAD_SECRET' })
      expect(id).toBeTruthy()
      await until(async () => (await producer.getJobById('starter.echo', id!))?.state === 'completed')
      worker.kill('SIGTERM')
      const timeout = setTimeout(() => worker?.kill('SIGKILL'), 10_000)
      try { expect(await closed).toBe(0) }
      finally { clearTimeout(timeout) }
      expect(output).toContain('[jobs] worker stopped')
      expect(output).toContain('job.completed')
      expect(output).toContain(id!)
      expect(output + errors).not.toContain('WORKER_PAYLOAD_SECRET')
      expect(errors).toBe('')
      expect(received.some(item => item.path === '/v1/traces' && item.body.includes('job starter.echo'))).toBe(true)
      expect(received.some(item => item.path === '/v1/metrics' && item.body.includes('app.job.executions'))).toBe(true)
      expect(JSON.stringify(received)).not.toContain('WORKER_PAYLOAD_SECRET')
    }
    finally {
      if (worker && worker.exitCode === null) worker.kill('SIGKILL')
      await producer.stop({ graceful: false })
      await migrator.stop({ graceful: false })
      await client.query(`drop schema if exists "${schema}" cascade`)
      await client.end()
      await new Promise<void>((resolve, reject) => receiver.close(error => error ? reject(error) : resolve()))
    }
  }, 40_000)
})
