// @vitest-environment node
import { createHmac, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { Webhook } from 'standardwebhooks'
import { createWebhookEvent, createWebhookJobs, defineWebhookEvents, deliverWebhook, handoffWebhook, isRetryableWebhookStatus, signWebhook, validateWebhookTarget, verifyWebhookRequest, verifyWebhookSignature, WebhookError, type WebhookIdempotency } from '@repo/nuxt-webhooks/server'

const secret = `whsec_${Buffer.alloc(32, 7).toString('base64')}`
const rotated = `whsec_${Buffer.alloc(32, 8).toString('base64')}`
const events = defineWebhookEvents({ 'test.created': z.object({ message: z.string() }).strict() })
const event = createWebhookEvent(events, 'test.created', { message: 'snowman ☃' })
const bytes = Buffer.from(event.body)
function request(body: string | Uint8Array = bytes, headers = signWebhook(event.id, bytes, secret)) {
  return new Request('https://receiver.example/webhook', { method: 'POST', body, headers })
}

describe('Standard Webhooks interoperability', () => {
  it('matches current reference signatures in both directions', () => {
    const date = new Date()
    const reference = new Webhook(secret)
    const headers = signWebhook(event.id, bytes, secret, date.getTime())
    expect(headers['webhook-signature']).toBe(reference.sign(event.id, date, bytes))
    expect(reference.verify(bytes, headers)).toEqual(JSON.parse(event.body))
    expect(verifyWebhookSignature(bytes, new Headers({ ...headers, 'webhook-signature': reference.sign(event.id, date, bytes) }), [secret])).toBe(event.id)
  })
  it('authenticates raw binary bytes without UTF-8 replacement', () => {
    const body = Buffer.from([0, 255, 128])
    const headers = signWebhook('test_id', body, secret, 1700000000000)
    const expected = createHmac('sha256', Buffer.alloc(32, 7)).update('test_id.1700000000.').update(body).digest('base64')
    expect(headers['webhook-signature']).toBe(`v1,${expected}`)
    expect(verifyWebhookSignature(body, new Headers(headers), [secret], { now: 1700000000000 })).toBe('test_id')
  })
  it('accepts rotated secrets and multiple signatures, rejects tampering and stale/future timestamps', async () => {
    const headers = signWebhook(event.id, bytes, rotated)
    headers['webhook-signature'] = `${signWebhook(event.id, bytes, secret)['webhook-signature']} ${headers['webhook-signature']}`
    expect(await verifyWebhookRequest(request(bytes, headers), { events, secrets: [secret, rotated] })).toEqual(JSON.parse(event.body))
    await expect(verifyWebhookRequest(request(`${event.body} `), { events, secrets: [secret] })).rejects.toMatchObject({ code: 'invalid-signature' })
    for (const offset of [-301000, 301000]) {
      await expect(verifyWebhookRequest(request(bytes, signWebhook(event.id, bytes, secret, Date.now() + offset)), { events, secrets: [secret] })).rejects.toMatchObject({ code: 'invalid-signature' })
    }
    const malformed = { ...signWebhook(event.id, bytes, secret), 'webhook-timestamp': '123junk' }
    await expect(verifyWebhookRequest(request(bytes, malformed), { events, secrets: [secret] })).rejects.toThrow(WebhookError)
  })
})

describe('inbound boundaries and replay handoff', () => {
  it('rejects Content-Length and actual stream size independently', async () => {
    const headers = { ...signWebhook(event.id, bytes, secret), 'content-length': '99999' }
    await expect(verifyWebhookRequest(new Request('https://example.test', { method: 'POST', body: bytes, headers }), { events, secrets: [secret], maxBytes: 500 })).rejects.toMatchObject({ code: 'body-too-large' })
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(200)); controller.enqueue(new Uint8Array(200)); controller.close() } })
    const chunked = new Request('https://example.test', { method: 'POST', body: stream, duplex: 'half', headers: { 'content-length': '1' } } as RequestInit)
    await expect(verifyWebhookRequest(chunked, { events, secrets: [secret], maxBytes: 300 })).rejects.toMatchObject({ code: 'body-too-large' })
  })
  it('bounds a stalled inbound stream', async () => {
    const stream = new ReadableStream({ pull() { return new Promise(() => {}) } })
    const incoming = new Request('https://example.test', { method: 'POST', body: stream, duplex: 'half' } as RequestInit)
    await expect(verifyWebhookRequest(incoming, { events, secrets: [secret], timeoutMs: 100 })).rejects.toMatchObject({ code: 'timeout' })
  })
  it('parses only authenticated, registered, valid envelopes and checks header/body ID', async () => {
    for (const data of [{ ...JSON.parse(event.body), type: 'unknown' }, { ...JSON.parse(event.body), data: { message: 1 } }, { ...JSON.parse(event.body), id: 'different' }]) {
      const body = JSON.stringify(data)
      await expect(verifyWebhookRequest(request(body, signWebhook(event.id, Buffer.from(body), secret)), { events, secrets: [secret] })).rejects.toMatchObject({ code: 'invalid-event' })
    }
    const body = '{invalid json'
    await expect(verifyWebhookRequest(request(body), { events, secrets: [secret] })).rejects.toMatchObject({ code: 'invalid-signature' })
    const used = request(); await used.text()
    await expect(verifyWebhookRequest(used, { events, secrets: [secret] })).rejects.toThrow()
  })
  it('makes replay storage explicitly application-owned and passes work through the hook', async () => {
    // Verification alone deliberately accepts replay within the time window.
    await verifyWebhookRequest(request(), { events, secrets: [secret] })
    await verifyWebhookRequest(request(), { events, secrets: [secret] })
    let invoked = 0
    const hook = { async runOnce<T>(id: string, operation: () => Promise<T>) { expect(id).toBe(event.id); invoked++; return { duplicate: false as const, result: await operation() } } }
    expect(await handoffWebhook(event, async () => 'job-id', hook)).toEqual({ duplicate: false, result: 'job-id' })
    expect(invoked).toBe(1)
    const transaction = { marker: 'same transaction' }
    const durable: WebhookIdempotency<typeof transaction> = {
      async runOnce(id, operation) { return { duplicate: false, result: await operation(transaction) } },
    }
    expect(await handoffWebhook(event, async (_, tx) => tx === transaction, durable)).toEqual({ duplicate: false, result: true })
  })
})

describe('outbound policy and Jobs composition', () => {
  it('enforces synchronized default body and timestamp bounds', () => {
    const large = defineWebhookEvents({ 'large.event': z.object({ value: z.string() }) })
    expect(() => createWebhookEvent(large, 'large.event', { value: 'x'.repeat(64 * 1024) })).toThrow(WebhookError)
    expect(() => createWebhookEvent(large, 'large.event', { value: 'x'.repeat(64 * 1024) }, { maxBytes: 1024 * 1024 })).not.toThrow()
    expect(() => createWebhookEvent(large, 'large.event', { value: 'x' }, { maxBytes: 1024 * 1024 + 1 })).toThrow()
    const headers = new Headers(signWebhook(event.id, Buffer.from(event.body), secret))
    expect(verifyWebhookSignature(Buffer.from(event.body), headers, [secret], { toleranceSeconds: 900 })).toBe(event.id)
    expect(() => verifyWebhookSignature(Buffer.from(event.body), headers, [secret], { toleranceSeconds: 901 })).toThrow()
  })
  it('rejects unsafe canonical target URLs', async () => {
    for (const url of ['http://example.com', 'https://user:pass@example.com', 'https://example.com/#', 'https://localhost', 'https://foo.localhost', 'https://localhost.', 'https://127.1', 'https://2130706433', 'https://0x7f000001', 'https://10.1.2.3', 'https://172.16.1.1', 'https://192.168.0.1', 'https://169.254.169.254', 'https://[::1]', 'https://[::ffff:127.0.0.1]', 'https://[fc00::1]', 'https://[fe80::1]']) await expect(validateWebhookTarget(url)).rejects.toMatchObject({ code: 'invalid-target' })
    expect((await validateWebhookTarget('https://example.com')).protocol).toBe('https:')
    expect((await validateWebhookTarget('http://127.0.0.1', { allowLocalHttp: true })).protocol).toBe('http:')
    await expect(validateWebhookTarget('https://example.com', { validate: () => { throw new Error('private-url') } })).rejects.toMatchObject({ code: 'invalid-target' })
  })
  it('rejects unregistered/oversized events and secret-bearing Jobs payloads', () => {
    expect(() => createWebhookEvent(events, 'test.created', { message: 'x'.repeat(1000) }, { maxBytes: 100 })).toThrow(WebhookError)
    const jobs = createWebhookJobs({ events, resolveTarget: () => ({ url: 'https://example.com', secret }) })
    const prepared = jobs.prepare('target', event)
    expect(Object.keys(prepared).sort()).toEqual(['body', 'id', 'targetRef', 'type'])
    expect(jobs.delivery.payload.safeParse({ ...prepared, secret }).success).toBe(false)
    expect(jobs.delivery.payload.safeParse({ ...prepared, id: 'different' }).success).toBe(false)
    expect(jobs.delivery.send).toMatchObject({ retryLimit: 5, retryDelay: 30, retryBackoff: true, retryDelayMax: 900 })
  })
  it('classifies HTTP status codes and safely returns permanent resolver failures', async () => {
    for (const status of [408, 425, 429, 500, 503, 599]) expect(isRetryableWebhookStatus(status)).toBe(true)
    for (const status of [200, 301, 400, 401, 403, 404, 410, 422]) expect(isRetryableWebhookStatus(status)).toBe(false)
    const jobs = createWebhookJobs({ events, resolveTarget: () => { throw new WebhookError('invalid-target') } })
    expect(await jobs.delivery.handler(jobs.prepare('target', event), { id: 'job', signal: new AbortController().signal })).toEqual({ outcome: 'rejected', code: 'invalid-target', status: undefined })
  })
  it('uses native fetch, disables redirects, resolves rotation on each attempt and sanitizes remote bodies', async () => {
    let current = secret
    let redirectVisits = 0
    const server = createServer(async (req, res) => {
      if (req.url === '/redirect') { res.writeHead(302, { location: '/followed' }); res.end('private-body'); return }
      if (req.url === '/followed') redirectVisits++
      if (req.url === '/hang') return
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(Buffer.from(chunk))
      expect(verifyWebhookSignature(Buffer.concat(chunks), new Headers(req.headers as Record<string, string>), [current])).toBe(event.id)
      res.writeHead(req.url === '/retry' ? 429 : 204); res.end(req.url === '/retry' ? 'private-body' : undefined)
    })
    server.listen(0, '127.0.0.1'); await once(server, 'listening')
    const address = server.address() as { port: number }
    const options = { targetPolicy: { allowLocalHttp: true }, timeoutMs: 100, resolveTarget: (ref: string) => ({ url: `http://127.0.0.1:${address.port}/${ref}`, secret: current }) }
    try {
      await expect(deliverWebhook({ targetRef: 'ok', ...event }, options)).resolves.toMatchObject({ outcome: 'delivered' })
      current = rotated
      await expect(deliverWebhook({ targetRef: 'ok', ...event }, options)).resolves.toMatchObject({ outcome: 'delivered' })
      await expect(deliverWebhook({ targetRef: 'retry', ...event }, options)).rejects.toMatchObject({ retryable: true, status: 429, message: 'Webhook remote-status' })
      await expect(deliverWebhook({ targetRef: 'redirect', ...event }, options)).rejects.toMatchObject({ retryable: false, status: 302 })
      expect(redirectVisits).toBe(0)
      await expect(deliverWebhook({ targetRef: 'hang', ...event }, options)).rejects.toMatchObject({ retryable: true, code: 'timeout' })
      await expect(deliverWebhook({ targetRef: 'target', ...event }, { ...options, resolveTarget: () => { throw new Error(`secret ${randomBytes(8)}`) } })).rejects.toMatchObject({ code: 'target-resolution', message: 'Webhook target-resolution' })
    }
    finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
  })
})
