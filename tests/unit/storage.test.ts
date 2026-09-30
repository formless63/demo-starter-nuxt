import { describe, expect, it } from 'vitest'
import { createStorage, createStorageKey, resolveStorageConfig, validateCompletedParts, validateStorageKey } from '@repo/nuxt-storage/server'

describe('Storage configuration and safe primitives', () => {
  it('requires a bucket only on use and preserves the AWS credential chain', async () => {
    const storage = createStorage({ env: {} })
    await expect(storage.checkStorage()).rejects.toMatchObject({ code: 'configuration' })
    const config = resolveStorageConfig({}, { STORAGE_BUCKET: 'test-bucket', AWS_DEFAULT_REGION: 'eu-west-1' })
    expect(config).toMatchObject({ region: 'eu-west-1', forcePathStyle: false, credentials: undefined, presignTtlSeconds: 600 })
    const chain = createStorage({ bucket: 'test-bucket', env: {} })
    expect(chain.getS3Client().config.credentials).toBeTypeOf('function')
    chain.close()
  })
  it('supports self-hosted endpoint, explicit/session credentials and path-style overrides', () => {
    const config = resolveStorageConfig({}, { STORAGE_BUCKET: 'test-bucket', STORAGE_ENDPOINT: 'http://localhost:9000', STORAGE_ACCESS_KEY_ID: 'access', STORAGE_SECRET_ACCESS_KEY: 'secret', STORAGE_SESSION_TOKEN: 'session' })
    expect(config).toMatchObject({ forcePathStyle: true, credentials: { accessKeyId: 'access', secretAccessKey: 'secret', sessionToken: 'session' } })
    expect(resolveStorageConfig({ forcePathStyle: false }, { STORAGE_BUCKET: 'test-bucket', STORAGE_ENDPOINT: 'http://localhost:9000' }).forcePathStyle).toBe(false)
    expect(resolveStorageConfig({}, { STORAGE_BUCKET: 'test-bucket', AWS_REGION: 'us-west-2', AWS_DEFAULT_REGION: 'us-east-1' }).region).toBe('us-west-2')
    for (const env of [{ STORAGE_ACCESS_KEY_ID: 'access' }, { STORAGE_SECRET_ACCESS_KEY: 'secret' }, { STORAGE_FORCE_PATH_STYLE: 'maybe' }, { STORAGE_ENDPOINT: 'https://access:secret@example.com' }, { STORAGE_KEY_PREFIX: '../invalid' }]) {
      expect(() => resolveStorageConfig({}, { STORAGE_BUCKET: 'test-bucket', ...env })).toThrow('Storage: configuration')
    }
    for (const ttl of [29, 3601, 1.5, NaN]) expect(() => resolveStorageConfig({ bucket: 'test-bucket', presignTtlSeconds: ttl }, {})).toThrow()
  })
  it('generates opaque namespaced keys and rejects path/header injection', () => {
    const first = createStorageKey('imports', 'application/')
    expect(first).toMatch(/^application\/imports\/[a-f0-9-]{36}$/)
    expect(createStorageKey('imports', 'application')).not.toBe(first)
    for (const key of ['/absolute', '../secret', 'a/../b', 'a//b', 'a\nb', 'a\\b', 'a%2fb', 'a'.repeat(1025)]) expect(() => validateStorageKey(key)).toThrow()
    for (const namespace of ['file.png', 'user/name', '../foo', '', 'é']) expect(() => createStorageKey(namespace)).toThrow()
  })
  it('validates multipart ordering and signs exact headers with bounded TTL without logging URLs', async () => {
    for (const parts of [[], [{ partNumber: 0, etag: 'etag' }], [{ partNumber: 1, etag: '' }], [{ partNumber: 2, etag: 'x' }, { partNumber: 1, etag: 'x' }]]) expect(() => validateCompletedParts(parts)).toThrow()
    const storage = createStorage({ bucket: 'test-bucket', region: 'us-east-1', accessKeyId: 'safe-access', secretAccessKey: 'test-secret', env: {} })
    try {
      const signed = await storage.presignUpload('test/key', { contentType: 'text/plain', metadata: { purpose: 'test' }, expiresIn: 30 })
      const url = new URL(signed.url)
      expect(url.hostname).toBe('test-bucket.s3.us-east-1.amazonaws.com')
      expect(url.searchParams.get('X-Amz-SignedHeaders')).toContain('content-type')
      expect(url.searchParams.get('X-Amz-SignedHeaders')).toContain('x-amz-meta-purpose')
      expect(signed.headers).toEqual({ 'content-type': 'text/plain', 'x-amz-meta-purpose': 'test' })
      expect(url.searchParams.get('X-Amz-Expires')).toBe('30')
      expect(signed.url).not.toContain('test-secret')
      await expect(storage.presignDownload('test/key', 3601)).rejects.toMatchObject({ code: 'invalid-input' })
      await expect(storage.presignMultipartPart('test/key', '', 1)).rejects.toMatchObject({ code: 'invalid-input' })
      await expect(storage.presignMultipartPart('test/key', 'id', 10001)).rejects.toMatchObject({ code: 'invalid-input' })
      await expect(storage.presignUpload('test/key', { contentType: 'text/plain\r\ninjected' })).rejects.toMatchObject({ code: 'invalid-input' })
      await expect(storage.presignUpload('test/key', { metadata: { purpose: 'a\nb' } })).rejects.toMatchObject({ code: 'invalid-input' })
    }
    finally { storage.close() }
  })
})
