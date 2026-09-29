import { describe, expect, it, vi } from 'vitest'
import { PgBoss } from 'pg-boss'
import { sendRegisteredJob } from '../../modules/jobs/runtime/server/client'
import { jobRegistry } from '../../server/jobs/registry'

describe('jobs registry', () => {
  it('keeps explicit, discoverable queue names', () => {
    expect(Object.keys(jobRegistry)).toEqual(['starter.echo'])
  })

  it('validates payloads before enqueueing', async () => {
    const send = vi.spyOn(PgBoss.prototype, 'send')

    await expect(sendRegisteredJob(
      {} as PgBoss,
      jobRegistry,
      'starter.echo',
      { message: '' },
    )).rejects.toThrow()
    expect(send).not.toHaveBeenCalled()
    send.mockRestore()
  })
})
