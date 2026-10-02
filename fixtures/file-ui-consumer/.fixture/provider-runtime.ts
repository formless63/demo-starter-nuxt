import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { createFileStorage, createFileWorkflow, createMemoryFileMetadata } from '@repo/nuxt-file-ui/server'
import { createStorage } from '@repo/nuxt-storage/server'
import { startProvider } from './providers'
import { writeState, type RetainedProvider } from './state'

export async function runProviders() {
  const retained: RetainedProvider[] = []
  await writeState(retained)
  for (const provider of ['rustfs', 'garage'] as const) {
    // Record before Docker startup so the generic finally hook can remove a
    // partly-created disposable project after bootstrap or assertion failure.
    const entry: RetainedProvider = { provider, project: `file-ui-${provider}-${randomUUID()}`, objects: [] }
    retained.push(entry)
    await writeState(retained)
    entry.config = await startProvider(provider, entry.project)
    await writeState(retained)
    const storage = createFileStorage(entry.config)
    const independent = createStorage(entry.config)
    try {
      const metadata = createMemoryFileMetadata(8) // NON-DURABLE, bounded fixture only.
      const options = { metadata, storage: () => storage, authorize: async () => true }
      let workflow = createFileWorkflow(options)
      const owner = { owner: `synthetic-${provider}` }
      const bytes = new Uint8Array([0, 1, 2, 255])
      const token = randomUUID()
      const input = () => ({ token, name: 'fixture.bin', type: 'application/octet-stream', body: new Response(bytes).body, expectedSize: bytes.length, expectedDigest: createHash('sha256').update(bytes).digest('hex') })
      const row = await workflow.upload(owner, input())
      assert.equal(row.state, 'ready')
      assert.equal((await workflow.upload(owner, input())).id, row.id)
      assert.deepEqual(await (await workflow.download(owner, row.id)).body.transformToByteArray(), bytes)
      // Recreate workflow while retaining the fixture adapter. This covers
      // lifecycle retry, not durable metadata restart; process-loss is separate.
      workflow = createFileWorkflow(options)
      assert.equal((await workflow.remove(owner, row.id)).state, 'removed')
      assert.equal((await workflow.upload(owner, input())).state, 'removed')
      const receipt = await metadata.get(owner.owner, row.id)
      assert(receipt)
      await assert.rejects(storage.headObject(receipt.key), { code: 'not-found' })

      const fileBody = `file-ui retained bytes (${provider})`
      const file = await workflow.upload(owner, { ...input(), token: randomUUID(), name: 'retained.txt', type: 'text/plain', expectedDigest: undefined, expectedSize: undefined, body: new Response(fileBody).body })
      assert.equal(file.state, 'ready')
      const record = await metadata.get(owner.owner, file.id)
      assert(record)
      entry.objects.push({ key: record.key, body: fileBody, kind: 'file-ui' })
      await writeState(retained)
      const marker = independent.createKey('file-ui-removal-fixture')
      const markerBody = `independent Storage retained bytes (${provider})`
      await independent.putObject(marker, markerBody, { contentType: 'text/plain' })
      entry.objects.push({ key: marker, body: markerBody, kind: 'independent-storage' })
      await writeState(retained)
      console.info(`[file-ui] pinned ${provider}: actual SDK upload/replay/hash/readback/download/delete and retained removal witnesses ready`)
    }
    finally { storage.close(); independent.close() }
  }
}
