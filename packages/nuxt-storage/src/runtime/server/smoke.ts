import assert from 'node:assert/strict'
import type { Storage } from './index'

// Also consumed by the external artifact fixture: one provider-neutral contract.
// This explicitly writes temporary objects, but never creates/deletes a bucket.
export async function smokeStorage(storage: Storage) {
  const prefix = storage.createKey('storage-smoke')
  const keys = ['object', 'signed', 'multipart', 'abort', 'bad-policy'].map(name => `${prefix}/${name}`)
  const uploads: { key: string, id: string }[] = []
  const text = 'private storage contract'
  let failure: unknown
  let cleanupFailed: boolean
  async function request(url: string, init?: RequestInit) {
    const response = await fetch(url, init)
    assert(response.ok, `Storage smoke request failed (${response.status})`)
    return response
  }
  try {
    await storage.checkStorage()
    await storage.putObject(keys[0]!, text, { contentType: 'text/plain', cacheControl: 'private, max-age=0', metadata: { purpose: 'smoke' } })
    const head = await storage.headObject(keys[0]!)
    assert.equal(head.size, Buffer.byteLength(text))
    assert.equal(head.contentType, 'text/plain')
    assert.equal(head.cacheControl, 'private, max-age=0')
    assert.equal(head.metadata.purpose, 'smoke')
    assert(head.etag && head.modifiedAt)
    const download = await storage.getObject(keys[0]!)
    // Only this known-small test object is buffered. Production callers stream it.
    assert.equal(await download.body.transformToString(), text)
    await storage.verifyUploadedObject(keys[0]!, { maxBytes: 100, contentType: 'text/plain', metadata: { purpose: 'smoke' } })
    await assert.rejects(storage.verifyUploadedObject(keys[0]!, { maxBytes: 1 }), { code: 'verification-failed' })
    await assert.rejects(storage.verifyUploadedObject(keys[0]!, { maxBytes: 100, contentType: 'image/png' }), { code: 'verification-failed' })
    await assert.rejects(storage.verifyUploadedObject(keys[0]!, { maxBytes: 100, metadata: { purpose: 'wrong' } }), { code: 'verification-failed' })
    await storage.putObject(keys[4]!, text)
    await assert.rejects(storage.verifyUploadedObject(keys[4]!, { maxBytes: 1, deleteOnFailure: true }), { code: 'verification-failed' })
    await assert.rejects(storage.headObject(keys[4]!), { code: 'not-found' })

    const upload = await storage.presignUpload(keys[1]!, { contentType: 'text/plain', metadata: { purpose: 'signed' }, expiresIn: 30 })
    const signedUrl = new URL(upload.url)
    assert.equal(signedUrl.searchParams.get('X-Amz-Expires'), '30')
    assert(signedUrl.searchParams.get('X-Amz-SignedHeaders')?.includes('content-type'))
    const mismatch = await fetch(upload.url, { method: 'PUT', headers: { ...upload.headers, 'content-type': 'image/png' }, body: text })
    assert.equal(mismatch.status, 403, 'Mismatched signed Content-Type must fail')
    await mismatch.body?.cancel()
    await (await request(upload.url, { method: 'PUT', headers: upload.headers, body: text })).body?.cancel()
    assert.equal((await storage.headObject(keys[1]!)).metadata.purpose, 'signed')
    const signedDownload = await storage.presignDownload(keys[1]!)
    assert.equal(await (await request(signedDownload.url)).text(), text)
    const unsigned = new URL(signedDownload.url)
    unsigned.search = ''
    const anonymous = await fetch(unsigned)
    assert(!anonymous.ok, 'Private object must not allow unsigned access')
    await anonymous.body?.cancel()
    const first = await storage.listObjects({ prefix: `${prefix}/`, maxResults: 1 })
    assert.equal(first.objects.length, 1)
    assert(first.truncated && first.continuationToken)
    const second = await storage.listObjects({ prefix: `${prefix}/`, maxResults: 1, continuationToken: first.continuationToken })
    assert.equal(second.objects.length, 1)
    assert.notEqual(first.objects[0]!.key, second.objects[0]!.key)

    const multipart = await storage.createMultipartUpload(keys[2]!, { contentType: 'application/octet-stream', metadata: { purpose: 'multipart' } })
    uploads.push({ key: keys[2]!, id: multipart.uploadId })
    const parts = []
    const firstBody = Buffer.alloc(5 * 1024 * 1024, 97)
    for (const [index, body] of [firstBody, Buffer.from('tail')].entries()) {
      const part = await storage.presignMultipartPart(keys[2]!, multipart.uploadId, index + 1)
      const response = await request(part.url, { method: 'PUT', headers: part.headers, body })
      const etag = response.headers.get('etag')
      assert(etag, 'Multipart PUT must return ETag')
      parts.push({ partNumber: index + 1, etag })
      await response.body?.cancel()
    }
    await storage.completeMultipartUpload(keys[2]!, multipart.uploadId, parts)
    uploads.pop()
    const completed = await storage.getObject(keys[2]!)
    const bytes = await completed.body.transformToByteArray()
    assert.equal(bytes.length, firstBody.length + 4)
    assert.equal(Buffer.from(bytes.subarray(-4)).toString(), 'tail')
    assert.equal(completed.metadata.purpose, 'multipart')
    const aborted = await storage.createMultipartUpload(keys[3]!)
    uploads.push({ key: keys[3]!, id: aborted.uploadId })
    await storage.abortMultipartUpload(keys[3]!, aborted.uploadId)
    uploads.pop()
    const abortedPart = await storage.presignMultipartPart(keys[3]!, aborted.uploadId, 1)
    const failed = await fetch(abortedPart.url, { method: 'PUT', body: text })
    assert(!failed.ok, 'Aborted multipart upload must not accept parts')
    await failed.body?.cancel()
    await storage.deleteObject(keys[0]!)
    await assert.rejects(storage.headObject(keys[0]!), { code: 'not-found' })
  }
  catch (error) { failure = error }
  finally {
    // Attempt every cleanup even when an earlier cleanup fails; propagate failure.
    const results = await Promise.allSettled([
      ...uploads.map(upload => storage.abortMultipartUpload(upload.key, upload.id)),
      ...keys.map(key => storage.deleteObject(key)),
    ])
    cleanupFailed = results.some(result => result.status === 'rejected')
  }
  if (cleanupFailed) throw new Error('Storage smoke cleanup failed')
  if (failure) throw failure
  assert.equal((await storage.listObjects({ prefix: `${prefix}/` })).objects.length, 0, 'Smoke objects must be cleaned up')
  return { ok: true as const }
}
