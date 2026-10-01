// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { authorizedChannels, createRealtimeConnection, createRealtimeEvent, createRealtimeHub, createRealtimeWebSocketHandler, defineRealtimeEvents, encodeRealtimeEvent, parseRealtimeEvent, REALTIME_LIMITS, RealtimeError, resolveRealtimeConfig, sseFrame, SSE_HEARTBEAT, WS_PING, WS_PONG } from '@repo/nuxt-realtime/server'

const events = defineRealtimeEvents({ 'test.updated': z.object({ value: z.string() }).strict() })
afterEach(() => vi.useRealTimers())
describe('Realtime v1', () => {
  it('normalizes all transport choices and rejects invalid configuration', () => {
    expect(resolveRealtimeConfig({}).normalized).toBe('sse')
    for (const mode of ['sse', 'websocket', 'sse,websocket']) expect(resolveRealtimeConfig({ REALTIME_TRANSPORTS: mode }).normalized).toBe(mode)
    expect(resolveRealtimeConfig({ REALTIME_TRANSPORTS: ' WebSocket, SSE ' }).normalized).toBe('sse,websocket')
    for (const mode of ['', 'both', 'sse,sse', 'rpc', 'websocket,']) expect(() => resolveRealtimeConfig({ REALTIME_TRANSPORTS: mode })).toThrow(RealtimeError)
  })
  it('generates UUID/UTC envelopes, validates schema and allows exactly 64KiB', () => {
    const value = createRealtimeEvent(events, 'test.updated', { value: '☃' })
    expect(value.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(new Date(value.occurredAt).toISOString()).toBe(value.occurredAt)
    expect(parseRealtimeEvent(JSON.parse(encodeRealtimeEvent(value)), events)).toEqual(value)
    expect(() => createRealtimeEvent(events, 'test.updated', { value: 1 } as never)).toThrow(RealtimeError)
    const baseBytes = Buffer.byteLength(encodeRealtimeEvent({ ...value, data: { value: '' } }))
    expect(Buffer.byteLength(encodeRealtimeEvent({ ...value, data: { value: 'x'.repeat(65536 - baseBytes) } }))).toBe(65536)
    expect(() => encodeRealtimeEvent({ ...value, data: { value: 'x'.repeat(65537 - baseBytes) } })).toThrow(RealtimeError)
    for (const type of ['Bad', '1bad', '', 'x'.repeat(129), 'bad type']) expect(() => defineRealtimeEvents({ [type]: z.unknown() })).toThrow(RealtimeError)
  })
  it('rejects runtime objects, accessors, cycles, lossy arrays and unsafe transforms', () => {
    const any = defineRealtimeEvents({ 'test.data': z.unknown() })
    const cycle: Record<string, unknown> = {}; cycle.self = cycle
    const getter = vi.fn(() => 'private')
    const accessor = Object.defineProperty({}, 'value', { get: getter, enumerable: true })
    for (const data of [undefined, NaN, Infinity, BigInt(1), () => 1, Symbol(), new Date(), new (class { x = 1 })(), cycle, accessor, { x: undefined }, Array(2), Object.assign([1], { extra: 1 }), Object.defineProperty({}, 'x', { value: 1 })]) expect(() => createRealtimeEvent(any, 'test.data', data)).toThrow(RealtimeError)
    expect(getter).not.toHaveBeenCalled()
    expect(() => createRealtimeEvent(defineRealtimeEvents({ 'test.transform': z.string().transform(() => new Date()) }), 'test.transform', 'safe')).toThrow(RealtimeError)
  })
  it('authorizes at most 32 exact channels with no wildcard', () => {
    expect(authorizedChannels(Array.from({ length: 32 }, (_, i) => `user:${i}`))).toHaveLength(32)
    for (const channels of [undefined, [], ['*'], ['User:a'], ['user:a', 'user:a'], ['user:a?token=x'], Array.from({ length: 33 }, (_, i) => `user:${i}`)]) expect(() => authorizedChannels(channels)).toThrow(RealtimeError)
  })
  it('formats full envelopes without SSE id or replay and uses comment heartbeat', () => {
    const value = createRealtimeEvent(events, 'test.updated', { value: 'one' })
    expect(sseFrame(encodeRealtimeEvent(value), value.type)).toBe(`event: test.updated\ndata: ${JSON.stringify(value)}\n\n`)
    expect(SSE_HEARTBEAT).toBe(': heartbeat\n\n')
    const hub = createRealtimeHub(), alice = vi.fn(), bob = vi.fn()
    hub.publish('user:a', value)
    const unsubscribe = hub.subscribe(['user:a', 'shared'], alice)
    hub.subscribe(['user:b'], bob)
    expect(alice).not.toHaveBeenCalled()
    hub.publish('user:a', value); expect(alice).toHaveBeenCalledTimes(1); expect(bob).not.toHaveBeenCalled()
    unsubscribe(); hub.publish('user:a', value); expect(alice).toHaveBeenCalledTimes(1)
    hub.close(); expect(hub.activeCount).toBe(0)
    expect(() => hub.publish('user:a', value)).toThrow(RealtimeError)
  })
  it('caps explicit queued/in-flight bytes and transport pressure, discards on close', async () => {
    let finish = () => {}
    const close = vi.fn(), cleanup = vi.fn()
    const connection = createRealtimeConnection({ bufferedBytes: () => 0, write: () => new Promise<void>(resolve => { finish = resolve }), close }, cleanup)
    for (let i = 0; i < 4; i++) connection.send('x'.repeat(65536))
    expect(connection.pendingBytes).toBe(262144)
    expect(() => connection.send('x')).toThrow(RealtimeError)
    expect(connection.pendingBytes).toBe(0); expect(cleanup).toHaveBeenCalledTimes(1); expect(close).toHaveBeenCalledWith('backpressure')
    finish(); await Promise.resolve(); expect(connection.pendingBytes).toBe(0)
    const pressure = createRealtimeConnection({ bufferedBytes: () => REALTIME_LIMITS.pendingBytes, write: async () => {}, close }, () => {})
    expect(() => pressure.send('x')).toThrow(RealtimeError)
  })
  it('closes stalled writes after one 20-second interval and removes resources', async () => {
    vi.useFakeTimers()
    const cleanup = vi.fn(), close = vi.fn()
    const connection = createRealtimeConnection({ bufferedBytes: () => 0, write: () => new Promise(() => {}), close }, cleanup)
    connection.send('event')
    await vi.advanceTimersByTimeAsync(20000)
    expect(connection.closed).toBe(true); expect(close).toHaveBeenCalledWith('backpressure'); expect(cleanup).toHaveBeenCalledTimes(1)
  })
  it('authenticates WebSocket upgrades, enforces channels, heartbeat/liveness and close cleanup', async () => {
    vi.useFakeTimers()
    const hub = createRealtimeHub(), authorize = vi.fn(async () => ['user:a'])
    const handler = createRealtimeWebSocketHandler({ hub, authorize, env: { REALTIME_TRANSPORTS: 'websocket' } })
    const hooks = handler.__websocket__!
    const context = {}, request = { url: 'http://localhost/api/realtime/ws', headers: new Headers(), context }
    await hooks.upgrade!(request)
    const sent: string[] = []
    const peer = { context, request, websocket: { bufferedAmount: 0, readyState: 1 }, send: (value: string) => { sent.push(value) }, close: vi.fn(), terminate: vi.fn() } as unknown as Parameters<NonNullable<typeof hooks.open>>[0]
    hooks.open!(peer)
    expect(hub.activeCount).toBe(1)
    const event = createRealtimeEvent(events, 'test.updated', { value: 'ws' })
    hub.publish('user:b', event); expect(sent).toHaveLength(0)
    hub.publish('user:a', event); await Promise.resolve(); expect(JSON.parse(sent[0]!)).toEqual(event)
    await vi.advanceTimersByTimeAsync(20000); expect(sent.at(-1)).toBe(WS_PING)
    hooks.message!(peer, { text: () => WS_PONG, uint8Array: () => Buffer.from(WS_PONG) } as never)
    await vi.advanceTimersByTimeAsync(20000); expect(peer.terminate).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(20000); expect(peer.terminate).toHaveBeenCalledTimes(1); expect(hub.activeCount).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
    const denied = createRealtimeWebSocketHandler({ hub: createRealtimeHub(), authorize: async () => undefined, env: { REALTIME_TRANSPORTS: 'websocket' } }).__websocket__!
    expect((await denied.upgrade!(request) as Response).status).toBe(401)
    expect((await hooks.upgrade!({ ...request, url: request.url + '?token=private' }) as Response).status).toBe(401)
  })
})
