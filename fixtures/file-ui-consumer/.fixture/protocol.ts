import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { createStorage } from '@repo/nuxt-storage/server'
import { createFileStorage, createFileWorkflow, createMemoryFileMetadata } from '@repo/nuxt-file-ui/server'

/** Real HTTP/S3 SDK transport; synthetic local object bytes only, no SDK mock. */
export async function startProtocol() {
  const objects = new Map<string, { body: Buffer, type: string, hash: string }>()
  let puts = 0
  let dropPutResponse = false
  let lateWriter: Promise<void> | undefined
  const server = createServer(async (request, response) => {
    const key = (request.url ?? '').split('?')[0]!
    if (request.method === 'PUT') {
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      const object = { body: Buffer.concat(chunks), type: String(request.headers['content-type']), hash: String(request.headers['x-amz-meta-sha256']) }
      puts++
      if (dropPutResponse) {
        dropPutResponse = false
        // Lose the response before the provider write commits. Only an explicit
        // awaited writer fence, never a time-to-live, licenses deletion.
        lateWriter = new Promise(resolve => setTimeout(() => { objects.set(key, object); resolve() }, 150))
        response.destroy()
        return
      }
      objects.set(key, object)
      response.writeHead(200, { etag: '"fixture"' }).end()
      return
    }
    if (request.method === 'DELETE') { objects.delete(key); response.writeHead(204).end(); return }
    const object = objects.get(key)
    if (!object) { response.writeHead(404).end(); return }
    response.writeHead(200, { 'content-type': object.type, 'content-length': object.body.length, 'x-amz-meta-sha256': object.hash })
      .end(request.method === 'HEAD' ? undefined : object.body)
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  assert(address && typeof address !== 'string')
  const config = { bucket: 'file-ui-fixture', region: 'us-east-1', endpoint: `http://127.0.0.1:${address.port}`, accessKeyId: 'fixture', secretAccessKey: 'fixture-only-no-production', env: {} }
  return {
    objects, config, puts: () => puts,
    loseNextPut: () => { dropPutResponse = true },
    fenceWriter: async () => { await lateWriter },
    async close() {
      await lateWriter
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => server.close(error => error && (error as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING' ? reject(error) : resolve()))
    },
  }
}

export async function runProtocol(protocol: Awaited<ReturnType<typeof startProtocol>>) {
  // Caller-provided maxAttempts=3 cannot relax the File UI one-PUT factory.
  const storage = createFileStorage({ ...protocol.config, maxAttempts: 3 })
  try {
    assert.equal(await storage.getS3Client().config.maxAttempts(), 1)
    const ordinary = createStorage(protocol.config)
    try { assert.equal(await ordinary.getS3Client().config.maxAttempts(), 3) }
    finally { ordinary.close() }
    const workflow = createFileWorkflow({ metadata: createMemoryFileMetadata(8), storage: () => storage, authorize: async () => true })
    const context = { owner: 'synthetic-alice' }
    const input = () => ({ token: 'file-ui-protocol-0001', name: 'safe.html', type: 'text/html', body: new Response('<script>bad()</script>').body })
    const before = protocol.puts()
    const first = await workflow.upload(context, input())
    assert.equal(first.state, 'ready')
    assert.deepEqual(await workflow.upload(context, input()), first)
    assert.equal(protocol.puts() - before, 1)
    const download = await workflow.download(context, first.id)
    assert.equal(await download.body.transformToString(), '<script>bad()</script>')
    assert.match(download.headers['Content-Disposition'], /^attachment/)
    assert.equal(download.headers['Content-Type'], 'application/octet-stream')
    assert.equal((await workflow.remove(context, first.id)).state, 'removed')
    assert.equal(protocol.objects.size, 0)

    protocol.loseNextPut()
    const beforeUncertain = protocol.puts()
    const uncertain = await workflow.upload(context, { ...input(), token: 'file-ui-protocol-0002' })
    assert.equal(uncertain.state, 'cleanup-pending')
    assert.equal(protocol.puts() - beforeUncertain, 1, 'A dropped response never causes an SDK PUT retry')
    assert.equal((await workflow.remove(context, uncertain.id)).state, 'cleanup-pending')
    await protocol.fenceWriter()
    assert.equal(protocol.objects.size, 1)
    assert.equal((await workflow.reconcile(context, uncertain.id, { writersStopped: false })).state, 'cleanup-pending')
    assert.equal(protocol.objects.size, 1, 'Elapsed time alone cannot authorize cleanup')
    assert.equal((await workflow.reconcile(context, uncertain.id, { writersStopped: true })).state, 'removed')
    assert.equal(protocol.objects.size, 0)
    console.info('[file-ui] packed real S3 SDK/local HTTP: one PUT, replay, attachment bytes, lost response/late commit, explicit writer fence passed')
  }
  finally { storage.close() }
}
