import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createStorage } from '../../../packages/nuxt-storage/src/runtime/server'
import { createOpsService } from '../../../packages/nuxt-ops-admin/src/runtime/server'
let requests = 0
const server = createServer((request, response) => {
  assert.equal(request.method, 'HEAD')
  requests++
  response.writeHead(503); response.end()
})
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
const endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}`
const options = { endpoint, bucket: 'disposable-ops-test', region: 'us-east-1', accessKeyId: 'local-fixture', secretAccessKey: 'local-fixture-secret', env: {} }
const ordinary = createStorage(options)
const diagnostic = createStorage({ ...options, maxAttempts: 1 })
try {
  assert.equal(requests, 0)
  assert.equal(await ordinary.getS3Client().config.maxAttempts(), 3)
  await assert.rejects(ordinary.checkStorage(), { code: 'unavailable' })
  assert.equal(requests, 3)
  requests = 0
  const ops = createOpsService([
    { id: 'storage', title: 'Storage', isConfigured: () => true, inspect: async () => { await diagnostic.checkStorage(); return { status: 'ok' } } },
    { id: 'healthy', title: 'Healthy', isConfigured: () => true, inspect: async () => ({ status: 'ok' }) },
  ])
  assert.equal(requests, 0)
  const summary = await ops.summary()
  assert.deepEqual(summary.adapters.map(card => card.status), ['unavailable', 'ok'])
  assert.equal(requests, 1)
  console.info('[ops-admin] HEAD503: ordinary Storage three attempts; Ops one attempt; sibling healthy')
}
finally { ordinary.close(); diagnostic.close(); await new Promise<void>(resolve => server.close(() => resolve())) }
