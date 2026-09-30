import { describe, expect, it, vi } from 'vitest'
import { createStorage } from '@repo/nuxt-storage/server'
import { getLogger, getMeter, getTracer } from '@repo/nuxt-observability/server'
import { runStorageOperation } from '../../server/utils/observed-storage'

describe('optional Storage telemetry', () => {
  it('records bounded operation/outcome/duration/bytes, never object identity or signed URLs', async () => {
    const log = vi.spyOn(getLogger(), 'info')
    const spans = vi.spyOn(getTracer(), 'startSpan')
    const meter = getMeter()
    const record = vi.fn()
    const histogram = vi.spyOn(meter, 'createHistogram').mockReturnValue({ record } as ReturnType<typeof meter.createHistogram>)
    const storage = createStorage({ bucket: 'SECRET_BUCKET', env: {}, runOperation: runStorageOperation })
    try {
      await expect(storage.checkStorage()).rejects.toMatchObject({ code: 'configuration' })
      const signed = createStorage({ bucket: 'secret-bucket', endpoint: 'http://localhost:9000', accessKeyId: 'SECRET_ACCESS', secretAccessKey: 'SECRET_CREDENTIAL', env: {}, runOperation: runStorageOperation })
      try {
        const result = await signed.presignUpload('SECRET_KEY/name', { contentType: 'text/plain' })
        expect(result.url).toContain('SECRET_KEY')
        await runStorageOperation('put', async () => true, 12)
        expect(log.mock.calls).toContainEqual([expect.objectContaining({ operation: 'presign-upload', outcome: 'success' }), 'storage.operation'])
        expect(log.mock.calls).toContainEqual([expect.objectContaining({ operation: 'check', outcome: 'error' }), 'storage.operation'])
        for (const [, attributes] of record.mock.calls) expect(Object.keys(attributes)).toEqual(['app.storage.operation', 'app.storage.outcome'])
        expect(JSON.stringify(log.mock.calls)).not.toContain('SECRET')
        expect(JSON.stringify(record.mock.calls)).not.toContain('SECRET')
        expect(JSON.stringify(log.mock.calls)).not.toContain('X-Amz-')
        expect(spans.mock.calls.map(([name]) => name)).toEqual(['storage.check', 'storage.presign-upload', 'storage.put'])
        expect(JSON.stringify(spans.mock.calls.map(([name, options]) => [name, options]))).not.toContain('SECRET')
      }
      finally { signed.close() }
    }
    finally { storage.close(); log.mockRestore(); histogram.mockRestore(); spans.mockRestore() }
  })
})
