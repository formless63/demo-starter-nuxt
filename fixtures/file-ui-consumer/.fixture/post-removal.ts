import assert from 'node:assert/strict'
import { createStorage } from '@repo/nuxt-storage/server'
import { startApp } from './app'
import { readState } from './state'

assert.throws(() => Bun.resolveSync('@repo/nuxt-file-ui', process.cwd()), 'File UI package is absent after uninstall')
const providers = await readState()
assert.deepEqual(providers.map(provider => provider.provider).sort(), ['garage', 'rustfs'], 'Both real provider witnesses must survive until post-removal')
for (const provider of providers) {
  assert(provider.config)
  assert.deepEqual(provider.objects.map(object => object.kind).sort(), ['file-ui', 'independent-storage'])
  const storage = createStorage(provider.config)
  try {
    await storage.checkStorage()
    for (const object of provider.objects) {
      const downloaded = await storage.getObject(object.key)
      assert.equal(await downloaded.body.transformToString(), object.body, `${provider.provider} ${object.kind} retained exact bytes after uninstall/rebuild`)
      assert.equal((await storage.headObject(object.key)).size, Buffer.byteLength(object.body))
    }
    const key = storage.createKey('post-removal-storage')
    try {
      await storage.putObject(key, 'Storage remains operational')
      assert.equal(await (await storage.getObject(key)).body.transformToString(), 'Storage remains operational')
    }
    finally { await storage.deleteObject(key) }
  }
  finally { storage.close() }
}
const app = await startApp()
try {
  const response = await fetch(app.base)
  assert.equal(response.status, 200)
  assert.match(await response.text(), /Baseline survives File UI removal/)
  assert.equal((await fetch(`${app.base}/files`)).status, 404)
  assert.equal((await fetch(`${app.base}/browser`)).status, 404)
  assert.equal((await fetch(`${app.base}/api/files/list`)).status, 404)
}
finally { await app.stop() }
console.info('[file-ui] actual uninstall/final rebuild: both provider File UI and independent Storage bytes retained; Storage works; removed routes absent')
