import { describe, expect, it, vi } from 'vitest'
import { getLogger, getMeter, getTracer } from '@repo/nuxt-observability/server'
import { EmailError } from '@repo/nuxt-email/server'
import { runEmailOperation } from '../../server/utils/observed-email'

describe('optional Email telemetry', () => {
  it('emits bounded dimensions, numeric counts and no content/identity/provider errors', async () => {
    const log = vi.spyOn(getLogger(), 'info')
    const spans = vi.spyOn(getTracer(), 'startSpan')
    const record = vi.fn()
    vi.spyOn(getMeter(), 'createHistogram').mockReturnValue({ record } as ReturnType<ReturnType<typeof getMeter>['createHistogram']>)
    try {
      await runEmailOperation('send', 'tls', async () => 'CONTENT_SECRET', 2)
      await expect(runEmailOperation('verify', 'starttls', async () => { throw new EmailError('authentication', false, new Error('CREDENTIAL_SECRET')) })).rejects.toMatchObject({ code: 'authentication' })
      expect(log.mock.calls).toContainEqual([expect.objectContaining({ operation: 'send', outcome: 'success', security: 'tls' }), 'email.operation'])
      expect(log.mock.calls).toContainEqual([expect.objectContaining({ operation: 'verify', outcome: 'error', security: 'starttls' }), 'email.operation'])
      for (const [, attrs] of record.mock.calls) expect(Object.keys(attrs)).toEqual(['app.email.operation', 'app.email.outcome', 'app.email.security'])
      expect(JSON.stringify(log.mock.calls)).not.toContain('SECRET'); expect(JSON.stringify(record.mock.calls)).not.toContain('SECRET')
      expect(spans.mock.calls.map(([name]) => name)).toEqual(['email.send', 'email.verify'])
    }
    finally { vi.restoreAllMocks() }
  })
})
