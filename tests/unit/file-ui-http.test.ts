// @vitest-environment node
import { PassThrough } from 'node:stream'
import { ServerResponse, IncomingMessage } from 'node:http'
import { Socket } from 'node:net'
import { createEvent } from 'h3'
import { describe, expect, it, vi } from 'vitest'
import { createMemoryFileMetadata } from '../../packages/nuxt-file-ui/src/runtime/server/memory'
import { createFileHttpHandler, fileRequestBody } from '../../packages/nuxt-file-ui/src/runtime/server/http'
import { readFileBytes, createFileWorkflow, type FileStorage } from '../../packages/nuxt-file-ui/src/runtime/server/workflow'

function event(headers: Record<string, string> = {}) {
  const req = Object.assign(new PassThrough({ highWaterMark: 4 }), { headers, method: 'POST', url: '/api/files/upload' }) as unknown as IncomingMessage
  return createEvent(req, new ServerResponse(req))
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0))
describe('native Nuxt bounded raw transport', () => {
  it('rejects oversized declared bodies before attaching any reader', () => {
    const e = event({ 'content-length': '11' })
    expect(() => fileRequestBody(e, 10)).toThrow('too_large')
    expect(e.node.req.listenerCount('data')).toBe(0)
  })
  it('counts chunked bytes and fails before a single oversized chunk is enqueued', async () => {
    for (const chunks of [[Buffer.alloc(11)], [Buffer.alloc(6), Buffer.alloc(5)]]) {
      const e = event(); const body = fileRequestBody(e, 10)
      const result = expect(readFileBytes(body, 10)).rejects.toMatchObject({ code: 'too_large' })
      for (const chunk of chunks) e.node.req.push(chunk)
      e.node.req.push(null)
      await result
      expect(e.node.req.listenerCount('data')).toBe(0)
    }
  })
  it('pauses ingress while the consumer is not reading and removes listeners on cancellation', async () => {
    const e = event(); const body = fileRequestBody(e, 10)
    e.node.req.push(Buffer.from('abc')); e.node.req.push(Buffer.from('def'))
    await tick()
    expect(e.node.req.isPaused()).toBe(true)
    // One queued chunk only; the second remains in the bounded Node buffer.
    expect(e.node.req.readableLength).toBe(3)
    await body.cancel()
    expect(e.node.req.listenerCount('data')).toBe(0)
    expect(e.node.req.isPaused()).toBe(true)
  })
  it('aborts a pending read promptly without awaiting more client bytes', async () => {
    const e = event(); const abort = new AbortController()
    const result = expect(readFileBytes(fileRequestBody(e, 10), 10, abort.signal)).rejects.toMatchObject({ code: 'cancelled' })
    abort.abort(); await result
    expect(e.node.req.listenerCount('data')).toBe(0)
  })
  it('rejects body middleware rather than claiming it bounded an already buffered body', () => {
    const e = event(); Object.assign(e.node.req, { body: Buffer.alloc(11) })
    expect(() => fileRequestBody(e, 10)).toThrow('invalid_input')
  })
  it('reads exact bytes including NUL and does not decode user payload', async () => {
    const e = event(); const payload = Buffer.from([0, 255, 10, 13])
    const read = readFileBytes(fileRequestBody(e, 4), 4)
    e.node.req.push(payload); e.node.req.push(null)
    expect(await read).toEqual(payload)
  })
  it('authorizes before attaching the upload stream and uses trusted origin', async () => {
    const upload = vi.fn(); const workflow = { maxBytes: 10, upload } as unknown as ReturnType<typeof createFileWorkflow>
    const e = event({ origin: 'https://attacker.example', 'x-file-ui': '1', host: 'attacker.example' })
    await expect(createFileHttpHandler({ workflow, authenticate: async () => null, origin: () => 'https://trusted.example' })(e, 'upload')).rejects.toMatchObject({ statusCode: 401 })
    await expect(createFileHttpHandler({ workflow, authenticate: async () => ({ owner: 'trusted-owner' }), origin: () => 'https://trusted.example' })(e, 'upload')).rejects.toMatchObject({ statusCode: 403 })
    expect(upload).not.toHaveBeenCalled(); expect(e.node.req.listenerCount('data')).toBe(0)
  })
  it('keeps streaming download cancellation wired until the response finishes', async () => {
    const e = event(); e.node.req.method = 'GET'
    let signal: AbortSignal | undefined
    const workflow = { download: async (ctx: { signal: AbortSignal }) => {
      signal = ctx.signal
      return { body: { transformToWebStream: () => new ReadableStream() }, headers: {} }
    } } as unknown as ReturnType<typeof createFileWorkflow>
    const response = await createFileHttpHandler({ workflow, authenticate: async () => ({ owner: 'trusted-owner' }), origin: () => 'https://trusted.example' })(e, 'download')
    expect(response).toBeInstanceOf(Response)
    expect(signal?.aborted).toBe(false)
    e.node.res.emit('close')
    expect(signal?.aborted).toBe(true)
    expect(e.node.res.listenerCount('finish')).toBe(0)
  })

  it('disposes transport listeners when workflow rejects before reading a body', async () => {
    const e = event({ origin: 'https://trusted.example', 'x-file-ui': '1' })
    const workflow = { maxBytes: 10, upload: async () => { throw new Error('rejected before read') } } as unknown as ReturnType<typeof createFileWorkflow>
    await expect(createFileHttpHandler({ workflow, authenticate: async () => ({ owner: 'trusted-owner' }), origin: () => 'https://trusted.example' })(e, 'upload')).rejects.toMatchObject({ statusCode: 503 })
    expect(e.node.req.listenerCount('data')).toBe(0)
    expect(e.node.req.isPaused()).toBe(true)
  })
  it('propagates request errors and aborted input while removing all body listeners', async () => {
    for (const kind of ['error', 'aborted']) {
      const e = event()
      const read = expect(readFileBytes(fileRequestBody(e, 10), 10)).rejects.toMatchObject({ code: kind === 'error' ? 'unavailable' : 'cancelled' })
      e.node.req.emit(kind, new Error('synthetic transport failure'))
      await read
      expect(e.node.req.listenerCount('data')).toBe(0)
      expect(e.node.req.listenerCount('error')).toBe(0)
      expect(e.node.req.listenerCount('aborted')).toBe(0)
    }
  })

  it('rejects decoded upstream middleware and non-binary chunks without reencoding', async () => {
    const encoded = event(); encoded.node.req.setEncoding('utf8')
    expect(() => fileRequestBody(encoded, 10)).toThrow('invalid_input')
    const e = event(); const read = expect(readFileBytes(fileRequestBody(e, 10), 10)).rejects.toMatchObject({ code: 'invalid_input' })
    e.node.req.emit('data', 'unbounded decoded payload')
    await read
    expect(e.node.req.listenerCount('data')).toBe(0)
  })
  it('aborts an in-flight upload when the response socket closes', async () => {
    const e = event({ origin: 'https://trusted.example', 'x-file-ui': '1' })
    const workflow = { maxBytes: 10, upload: async (ctx: { signal: AbortSignal }, input: { body: ReadableStream<Uint8Array> }) => readFileBytes(input.body, 10, ctx.signal) } as unknown as ReturnType<typeof createFileWorkflow>
    const pending = expect(createFileHttpHandler({ workflow, authenticate: async () => ({ owner: 'trusted-owner' }), origin: () => 'https://trusted.example' })(e, 'upload')).rejects.toMatchObject({ statusCode: 503 })
    await tick(); e.node.res.emit('close'); await pending
    expect(e.node.req.listenerCount('data')).toBe(0)
    expect(e.node.req.listenerCount('aborted')).toBe(0)
  })

  it('never reserves metadata or invokes storage after partial real IncomingMessage failure', async () => {
    for (const kind of ['error', 'aborted', 'response-close']) {
      const req = new IncomingMessage(new Socket())
      req.method = 'POST'; req.url = '/api/files/upload'
      req.headers = { origin: 'https://trusted.example', 'x-file-ui': '1', 'x-file-name': 'fixture.txt', 'content-type': 'text/plain', 'idempotency-key': 'synthetic-token-001' }
      const e = createEvent(req, new ServerResponse(req))
      const metadata = createMemoryFileMetadata()
      const reserve = vi.spyOn(metadata, 'reserve')
      const storage = vi.fn(() => ({} as FileStorage))
      const workflow = createFileWorkflow({ metadata, storage, authorize: async () => true, maxBytes: 10 })
      const pending = expect(createFileHttpHandler({ workflow, authenticate: async () => ({ owner: 'trusted-owner' }), origin: () => 'https://trusted.example' })(e, 'upload')).rejects.toMatchObject({ statusCode: 503 })
      await tick(); req.push(Buffer.from('abc')); await tick()
      if (kind === 'response-close') e.node.res.emit('close')
      else if (kind === 'error') req.emit('error', new Error('synthetic failure'))
      else req.emit('aborted')
      await pending
      expect(reserve).not.toHaveBeenCalled(); expect(storage).not.toHaveBeenCalled()
      expect(await metadata.list('trusted-owner', 10)).toEqual([])
      expect(req.listenerCount('data')).toBe(0)
      expect(req.isPaused()).toBe(true)
      // Actual IncomingMessage destruction after an aborted transport must not
      // produce an unhandled late error or leave a body handler attached.
      req.destroy(new Error('late synthetic socket error'))
      await tick()
      expect(req.listenerCount('data')).toBe(0)
      req.socket.destroy()
    }
  })

})
