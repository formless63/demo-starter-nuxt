import { createServer } from 'node:http'
import { once } from 'node:events'
import { describe, expect, it } from 'vitest'
import { createStorage } from '@repo/nuxt-storage/server'
import type { Readable } from 'node:stream'
describe('Storage AbortSignal narrow contract', () => {
  it('preabort performs no I/O and unrelated errors keep ordinary classification', async () => {
    let requests = 0
    const server = createServer((_req, res) => { requests++; res.writeHead(404); res.end() })
    server.listen(0, '127.0.0.1'); await once(server, 'listening')
    const endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}`
    const storage = createStorage({ bucket: 'fixture', region: 'us-east-1', endpoint, accessKeyId: 'fixture', secretAccessKey: 'fixture-secret', env: {} })
    try {
      const signal = AbortSignal.abort()
      for (const action of [() => storage.getObject('test/key', { signal }), () => storage.putObject('test/key', Buffer.from('x'), { signal }), () => storage.headObject('test/key', { signal })]) await expect(action()).rejects.toMatchObject({ code: 'cancelled' })
      expect(requests).toBe(0)
      await expect(storage.headObject('test/key')).rejects.toMatchObject({ code: 'not-found' })
    }
    finally { storage.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
  })
  it('cancels acquisition, PUT, HEAD and destroys an acquired GET body', async () => {
    let notify: (() => void) | undefined
    const server = createServer((req, res) => {
      if (req.url?.includes('stream')) { res.writeHead(200, { 'content-length': 10000 }); res.write('first') }
      notify?.()
    })
    server.listen(0, '127.0.0.1'); await once(server, 'listening')
    const endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}`
    const storage = createStorage({ bucket: 'fixture', region: 'us-east-1', endpoint, accessKeyId: 'fixture', secretAccessKey: 'fixture-secret', env: {} })
    try {
      for (const operation of ['get', 'put', 'head']) {
        const controller = new AbortController()
        const arrived = new Promise<void>(resolve => { notify = resolve })
        const request = operation === 'get' ? storage.getObject('test/key', { signal: controller.signal }) : operation === 'put' ? storage.putObject('test/key', Buffer.from('body'), { signal: controller.signal }) : storage.headObject('test/key', { signal: controller.signal })
        const result = request.catch(error => error)
        await arrived; controller.abort()
        expect(await result).toMatchObject({ code: 'cancelled' })
      }
      const controller = new AbortController()
      const object = await storage.getObject('stream/key', { signal: controller.signal })
      const stream = object.body as Readable
      const error = once(stream, 'error')
      controller.abort()
      expect((await error)[0]).toMatchObject({ code: 'cancelled' })
      expect(stream.destroyed).toBe(true)
    }
    finally { storage.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
  })
})
