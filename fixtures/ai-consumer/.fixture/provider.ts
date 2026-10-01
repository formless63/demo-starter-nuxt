import { createServer } from 'node:http'
import type { Socket } from 'node:net'

// Test-only, deterministic Chat Completions/SSE endpoint; no credentials or frameworks.
export async function startProvider() {
  const sockets = new Set<Socket>()
  const requests: Record<string, number> = {}
  const authenticated: Record<string, boolean> = {}
  const disconnected: Record<string, number> = {}
  const completed: Record<string, boolean> = {}
  const server = createServer(async (req, res) => {
    if (req.url !== '/v1/chat/completions' || req.method !== 'POST') { res.writeHead(404).end(); return }
    let body = ''
    for await (const chunk of req) body += chunk
    const input = JSON.parse(body)
    const mode = input.messages[0]?.content ?? 'completion'
    requests[mode] = (requests[mode] ?? 0) + 1
    authenticated[mode] = req.headers.authorization === 'Bearer fixture-test-key'
    if (req.headers['x-private-header'] !== undefined || (['completion', 'empty-key'].includes(mode) && req.headers.authorization !== undefined)) { res.writeHead(401).end(); return }
    res.on('close', () => { if (!res.writableFinished) disconnected[mode] = (disconnected[mode] ?? 0) + 1 })
    const status = ({ auth: 401, forbidden: 403, rate: 429, 'request-timeout': 408, unavailable: 503, invalid: 400 } as Record<string, number>)[mode]
    if (status) { res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { message: 'PRIVATE_PROVIDER_CONTENT api-key-secret', type: 'fixture_error' } })); return }
    if (mode === 'redirect') { res.writeHead(307, { location: '/private-redirect-target' }).end(); return }
    if (mode.startsWith('raw-')) {
      res.writeHead(mode === 'raw-error' ? 400 : 200, { 'content-type': mode === 'raw-sse' ? 'text/event-stream' : 'application/json' })
      res.write(mode === 'raw-sse' ? 'data: ' : '{"envelope":"')
      let sent = 0
      const pump = () => {
        if (res.destroyed) return
        if (sent >= 34 * 1024 * 1024) return // Keep socket open so disconnect is observable.
        sent += 65536
        if (res.write('x'.repeat(65536))) setImmediate(pump)
        else res.once('drain', pump)
      }
      pump()
      return
    }
    if (mode === 'stall-headers') return
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.flushHeaders()
    const send = (delta: object, reason: string | null = null, counts?: object) => res.write(`data: ${JSON.stringify({ id: 'private-id', object: 'chat.completion.chunk', created: 0, model: input.model, choices: [{ index: 0, delta, finish_reason: reason }], ...(counts ? { usage: counts } : {}) })}\n\n`)
    if (mode === 'stall' || mode === 'cancel' || mode === 'return' || mode === 'pause' || mode === 'timeout-stream') { send({ content: 'first' }); return }
    if (mode === 'malformed-sse') { res.end('data: {invalid}\n\n'); return }
    if (mode === 'bad-protocol') { res.end('data: {"choices":{}}\n\n'); return }
    if (mode.startsWith('split-')) { send({ content: 'x'.repeat(1048572) }); send({ content: '\ud83d' }); if (mode === 'split-empty') send({ content: '' }); send({ content: '\ude00' }); end(); return }
    if (mode === 'lone-high' || mode === 'lone-low' || mode === 'bad-pair') { send({ content: mode === 'lone-low' ? '\ude00' : '\ud83d' }); if (mode === 'bad-pair') send({ content: 'x' }); end(); return }
    if (mode === 'many-overflow') { for (let i = 0; i < 1025; i++) send({ content: 'x'.repeat(1024) }); return }
    if (mode === 'stream-error') { send({ content: 'first' }); res.end('data: {"error":{"message":"PRIVATE_PROVIDER_CONTENT"}}\n\n'); return }
    if (mode === 'incomplete') { send({ content: 'partial' }); res.end(); return }
    const content = mode === 'structured-limit' || mode === 'structured-over' ? JSON.stringify({ value: 'x'.repeat(1048576 - 12 + (mode === 'structured-over' ? 1 : 0)) }) : mode.startsWith('json') ? '{"value":"ok"}' : mode === 'schema' ? '{"value":7}' : mode === 'malformed' ? '{not json}' : mode === 'limit' ? 'é'.repeat(524288) : mode === 'oversized' ? 'é'.repeat(524289) : 'hello world'
    if (mode === 'stream') {
      send({ content: 'hello ' })
      const timer = setTimeout(() => { send({ content: 'world' }); end() }, 200)
      res.on('close', () => clearTimeout(timer))
    }
    else { send({ content }); end() }
    function end() {
      const reason = mode === 'length' || mode === 'json-length' ? 'length' : mode === 'filter' || mode === 'json-filter' ? 'content_filter' : mode === 'other' || mode === 'json-other' ? 'tool_calls' : 'stop'
      send({}, reason)
      // Usage is a trailing chunk after finish_reason, as in the upstream protocol.
      res.write(`data: ${JSON.stringify({ choices: [], usage: mode === 'bad-usage' ? { prompt_tokens: -1, completion_tokens: 1.5, total_tokens: 'bad' } : { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 } })}\n\n`)
      completed[mode] = true
      res.end('data: [DONE]\n\n')
    }
  })
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)) })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  return {
    baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`, requests, authenticated, disconnected, completed,
    async close() { for (const socket of sockets) socket.destroy(); await new Promise<void>(resolve => server.close(() => resolve())) },
  }
}
