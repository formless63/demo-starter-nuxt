import { describe, expect, it, vi } from 'vitest'
import { sendRegisteredJob } from '@wicaso/nuxt-jobs/server'
import { jobRegistry } from '../../server/jobs/registry'

describe('jobs registry', () => {
  it('keeps explicit, discoverable queue names', () => {
    expect(Object.keys(jobRegistry)).toEqual(['starter.echo'])
  })

  it('validates payloads before enqueueing', async () => {
    const send = vi.fn()

    await expect(sendRegisteredJob(
      { send } as never,
      jobRegistry,
      'starter.echo',
      { message: '' },
    )).rejects.toThrow()
    expect(send).not.toHaveBeenCalled()
  })
})
