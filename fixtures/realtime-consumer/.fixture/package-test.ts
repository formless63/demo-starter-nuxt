import assert from 'node:assert/strict'
import { get } from 'node:http'
import { once } from 'node:events'
import { REALTIME_LIMITS, createRealtimeConnection } from '@repo/nuxt-realtime/server'

// Deterministic stalled sink proves the explicit bound even without OS socket pressure.
let closed = false
const stalled = createRealtimeConnection({ bufferedBytes: () => 0, write: () => new Promise(() => {}), close: () => { closed = true } }, () => {})
for (let i = 0; i < 4; i++) stalled.send('x'.repeat(65_536))
assert.equal(stalled.pendingBytes, REALTIME_LIMITS.pendingBytes)
assert.throws(() => stalled.send('x'))
assert(closed); assert.equal(stalled.pendingBytes, 0)

for (const mode of ['sse', 'websocket', 'sse,websocket']) {
  const port = 31000 + Math.floor(Math.random() * 10000)
  const base = `http://127.0.0.1:${port}`
  const app = Bun.spawn(['node', '.output/server/index.mjs'], { env: { ...process.env, REALTIME_TRANSPORTS: mode, NITRO_HOST: '127.0.0.1', NITRO_PORT: String(port) }, stdout: 'pipe', stderr: 'pipe' })
  const logs = Promise.all([new Response(app.stdout).text(), new Response(app.stderr).text()])
  const clients: Array<() => void> = []
  try {
    let ready = false
    for (let i = 0; i < 100; i++) {
      try { if ((await fetch(base)).ok) { ready = true; break } } catch { /* wait for Nitro */ }
      await Bun.sleep(100)
    }
    assert(ready, 'Backendless production boot')
    const headers = { cookie: 'fixture_session=alice', 'Content-Type': 'application/json' }
    const publish = (value: string, cookie = headers.cookie) => fetch(`${base}/api/realtime/publish`, { method: 'POST', headers: { ...headers, cookie }, body: JSON.stringify({ value }) })
    const active = async () => (await (await fetch(`${base}/api/realtime/active`)).json() as { active: number }).active
    await publish('before connection')
    const upgradeHeaders = { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==' }
    const deniedUpgrade = get(`${base}/api/realtime/ws`, { headers: upgradeHeaders })
    const [deniedResponse] = await once(deniedUpgrade, 'response')
    assert.equal(deniedResponse.statusCode, mode.includes('websocket') ? 401 : 503, 'Actual unauthenticated/disabled WebSocket upgrade rejected')
    deniedResponse.resume()
    if (mode.includes('websocket')) {
      const queryUpgrade = get(`${base}/api/realtime/ws?channel=user:bob`, { headers: { ...upgradeHeaders, ...headers } })
      const [queryResponse] = await once(queryUpgrade, 'response')
      assert.equal(queryResponse.statusCode, 401, 'No query channel negotiation on authenticated WebSocket')
      queryResponse.resume()
    }
    const unauthenticated = await fetch(`${base}/api/realtime/sse`)
    assert.equal(unauthenticated.status, mode === 'websocket' ? 503 : 401)
    if (mode.includes('sse')) {
      assert.equal((await fetch(`${base}/api/realtime/sse?channel=user:bob`, { headers })).status, 401)
      const request = get(`${base}/api/realtime/sse`, { headers })
      clients.push(() => request.destroy())
      const [response] = await once(request, 'response')
      assert.equal(response.headers['content-type'], 'text/event-stream')
      assert.equal(response.headers['cache-control'], 'no-cache')
      let received = ''
      response.on('data', (chunk: Buffer) => { received += chunk.toString() })
      await publish('bob private', 'fixture_session=bob')
      await publish('sse expected')
      for (let i = 0; i < 100 && !received.includes('sse expected'); i++) await Bun.sleep(20)
      assert(received.includes('event: fixture.updated\ndata: {'))
      assert(!received.includes('\nid:') && !received.includes('before connection') && !received.includes('bob private'))
      const envelope = JSON.parse(received.split('data: ')[1]!.split('\n')[0]!)
      assert.equal(envelope.type, 'fixture.updated'); assert(envelope.id); assert(envelope.occurredAt)
      if (mode === 'sse,websocket') {
        for (let i = 0; i < 220 && !received.includes(': heartbeat\n\n'); i++) await Bun.sleep(100)
        assert(received.includes(': heartbeat\n\n'), 'Actual 20-second SSE comment')
      }
      request.destroy()
    }
    if (mode.includes('websocket')) {
      const ws = new WebSocket(`${base.replace('http:', 'ws:')}/api/realtime/ws`, { headers } as never)
      clients.push(() => ws.close())
      await new Promise<void>((resolve, reject) => { ws.onopen = () => resolve(); ws.onerror = () => reject(new Error('WebSocket upgrade failed')) })
      const messages: string[] = []
      let pings = 0
      ws.onmessage = (message) => {
        const text = String(message.data)
        if (text === '{"heartbeat":"ping"}') { pings++; ws.send('{"heartbeat":"pong"}') }
        else messages.push(text)
      }
      await publish('bob private', 'fixture_session=bob'); await publish('ws expected')
      for (let i = 0; i < 100 && !messages.length; i++) await Bun.sleep(20)
      assert.equal(JSON.parse(messages[0]!).data.value, 'ws expected')
      assert.equal(messages.length, 1, 'One event; no replay/foreign channels')
      if (mode === 'sse,websocket') {
        for (let i = 0; i < 220 && !pings; i++) await Bun.sleep(100)
        assert(pings > 0, 'Actual 20-second WebSocket transport heartbeat')
      }
      // Client application messages are not a command surface.
      const ended = new Promise<void>(resolve => { ws.onclose = () => resolve() })
      ws.send('{"command":"subscribe","channel":"user:bob"}')
      await Promise.race([ended, Bun.sleep(3000).then(() => { throw new Error('Client commands must close') })])
    }
    for (let i = 0; i < 100 && await active(); i++) await Bun.sleep(20)
    assert.equal(await active(), 0, 'Disconnect removes all listeners/queues')
    console.info(`[realtime fixture] ${mode}: backendless boot, auth, isolation, envelope and cleanup passed`)
  }
  finally {
    for (const close of clients) close()
    app.kill('SIGTERM'); await app.exited
    const output = (await logs).join('')
    assert(!output.includes('bob private'), 'Transport logs omit payloads')
  }
}
