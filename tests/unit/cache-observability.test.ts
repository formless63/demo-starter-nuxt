import { describe, expect, it, vi } from 'vitest'
import { createCache } from '@repo/nuxt-cache/server'
import { getLogger, getMeter } from '@repo/nuxt-observability/server'
import { recordCacheOperation } from '../../server/utils/observed-cache'

describe('optional Cache telemetry', () => {
  it('records bounded operation/outcome/duration/hit-miss without private input or raw failures', async () => {
    const log = vi.spyOn(getLogger(), 'info')
    const meter = getMeter()
    const record = vi.fn()
    const histogram = vi.spyOn(meter, 'createHistogram').mockReturnValue({ record } as ReturnType<typeof meter.createHistogram>)
    const cache = createCache({ url: 'redis://SECRET_USER:SECRET_PASSWORD@127.0.0.1:1', env: {}, onOperation: recordCacheOperation })
    try {
      await expect(cache.get('SECRET_KEY')).rejects.toMatchObject({ code: 'unavailable', message: 'Cache: unavailable' })
      recordCacheOperation({ operation: 'get', outcome: 'success', duration: 0.01, hit: false })
      recordCacheOperation({ operation: 'get', outcome: 'success', duration: 0.01, hit: true })
      expect(log.mock.calls).toContainEqual([expect.objectContaining({ operation: 'get', outcome: 'error' }), 'cache.operation'])
      expect(log.mock.calls).toContainEqual([expect.objectContaining({ operation: 'get', outcome: 'success', result: 'miss' }), 'cache.operation'])
      expect(log.mock.calls).toContainEqual([expect.objectContaining({ operation: 'get', outcome: 'success', result: 'hit' }), 'cache.operation'])
      for (const [, attributes] of record.mock.calls) {
        expect(Object.keys(attributes).sort()).toEqual(Object.keys(attributes).includes('app.cache.result')
          ? ['app.cache.operation', 'app.cache.outcome', 'app.cache.result']
          : ['app.cache.operation', 'app.cache.outcome'])
      }
      expect(JSON.stringify(log.mock.calls)).not.toContain('SECRET')
      expect(JSON.stringify(record.mock.calls)).not.toContain('SECRET')
    }
    finally { await cache.close(); log.mockRestore(); histogram.mockRestore() }
  })
})
