import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createApp, toNodeListener } from 'h3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiError } from '@repo/nuxt-api/server'
import { getLogger, observeOperation } from '@repo/nuxt-observability/server'
import { defineObservedApiHandler } from '../../server/utils/observed-api'
import { starterEchoJob } from '../../server/jobs/tasks/starter-echo'

afterEach(() => vi.restoreAllMocks())

describe('application-owned optional telemetry integrations', () => {
  it('preserves API 401/403/429 envelopes with registered operation/method/status only', async () => {
    const log = vi.spyOn(getLogger(), 'info')
    const app = createApp()
    for (const [status, code] of [[401, 'unauthorized'], [403, 'forbidden'], [429, 'rate_limited']] as const) {
      app.use(`/api/${status}`, defineObservedApiHandler(`fixture.status${status}`, () => apiError(status, code, 'Safe error')))
    }
    const server = createServer(toNodeListener(app))
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    try {
      for (const status of [401, 403, 429]) {
        const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/${status}?token=QUERY_SECRET`, {
          headers: { 'X-API-Key': 'API_KEY_SECRET' },
        })
        expect(response.status).toBe(status)
        expect(await response.json()).toMatchObject({ error: { message: 'Safe error' } })
        expect(log.mock.calls).toContainEqual([expect.objectContaining({
          'api.operation_id': `fixture.status${status}`, 'http.response.status_code': status, outcome: 'failure',
        }), 'api.completed'])
      }
      expect(JSON.stringify(log.mock.calls)).not.toContain('_SECRET')
    }
    finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) }
  })

  it('keeps Jobs results/errors and adds name/id/outcome without payloads', async () => {
    const log = vi.spyOn(getLogger(), 'info')
    const result = await starterEchoJob.handler({ message: 'PAYLOAD_SECRET' }, { id: 'job-id', signal: new AbortController().signal })
    expect(result).toEqual({ echoed: 'PAYLOAD_SECRET' })
    expect(log.mock.calls).toContainEqual([expect.objectContaining({ 'job.name': 'starter.echo', outcome: 'success' }), 'job.completed'])
    const failure = new Error('ERROR_SECRET')
    await expect(observeOperation('job', 'fixture.failure', () => { throw failure }, { jobId: 'failed-id' })).rejects.toBe(failure)
    expect(log.mock.calls).toContainEqual([expect.objectContaining({ 'job.name': 'fixture.failure', outcome: 'failure' }), 'job.completed'])
    expect(JSON.stringify(log.mock.calls)).not.toContain('_SECRET')
  })
})
