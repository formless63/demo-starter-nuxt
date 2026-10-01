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
    if (req.headers['x-private-header'] !== undefined || (mode === 'completion' && req.headers.authorization !== undefined)) { res.writeHead(401).end(); return }
    res.on('close', () => { if (!res.writableFinished) disconnected[mode] = (disconnected[mode] ?? 0) + 1 })
    const status = ({ auth: 401, forbidden: 403, rate: 429, unavailable: 503, invalid: 400 } as Record<string, number>)[mode]
    if (status) { res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { message: 'PRIVATE_PROVIDER_CONTENT api-key-secret', type: 'fixture_error' } })); return }
    if (mode === 'stall-headers') return
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.flushHeaders()
    const send = (delta: object, reason: string | null = null, counts?: object) => res.write(`data: ${JSON.stringify({ id: 'private-id', object: 'chat.completion.chunk', created: 0, model: input.model, choices: [{ index: 0, delta, finish_reason: reason }], ...(counts ? { usage: counts } : {}) })}\n\n`)
    if (mode === 'stall' || mode === 'cancel' || mode === 'return' || mode === 'pause' || mode === 'timeout-stream') { send({ content: 'first' }); return }
    if (mode === 'stream-error') { send({ content: 'first' }); res.end('data: {"error":{"message":"PRIVATE_PROVIDER_CONTENT"}}\n\n'); return }
    if (mode === 'incomplete') { send({ content: 'partial' }); res.end(); return }
    const content = mode === 'json' ? '{"value":"ok"}' : mode === 'schema' ? '{"value":7}' : mode === 'malformed' ? '{not json}' : mode === 'limit' ? 'é'.repeat(524288) : mode === 'oversized' ? 'é'.repeat(524289) : 'hello world'
    if (mode === 'stream') {
      send({ content: 'hello ' })
      const timer = setTimeout(() => { send({ content: 'world' }); end() }, 200)
      res.on('close', () => clearTimeout(timer))
    }
    else { send({ content }); end() }
    function end() {
      const reason = mode === 'length' || mode === 'json-length' ? 'length' : mode === 'filter' ? 'content_filter' : mode === 'other' ? 'tool_calls' : 'stop'
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
