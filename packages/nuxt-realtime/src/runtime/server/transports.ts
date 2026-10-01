import { PassThrough } from 'node:stream'
import { defineWebSocketHandler, sendStream, setResponseHeaders, createError } from 'h3'
import type { H3Event } from 'h3'
import type { RealtimeHub } from './hub'
import { authorizedChannels, encodeRealtimeEvent } from './events'
import { REALTIME_LIMITS, RealtimeError } from './errors'
import { resolveRealtimeConfig } from './config'
import { createRealtimeConnection } from './connection'

export interface RealtimeRequest { url: string, headers: Headers }
export interface RealtimeTransportOptions {
  hub: RealtimeHub
  /** Application checks normal cookie/session and resolves the entire permitted set. */
  authorize: (request: RealtimeRequest) => Promise<readonly string[] | undefined>
  env?: Record<string, string | undefined>
}
async function authorize(request: RealtimeRequest, options: RealtimeTransportOptions, transport: 'sse' | 'websocket') {
  if (!resolveRealtimeConfig(options.env).transports.includes(transport)) throw new RealtimeError('closed')
  // Channels/tokens/query negotiation are deliberately absent in v1.
  if (new URL(request.url, 'http://localhost').search) throw new RealtimeError('unauthorized')
  try { return authorizedChannels(await options.authorize(request)) }
  catch { throw new RealtimeError('unauthorized') }
}
export function sseFrame(encoded: string, type: string) { return `event: ${type}\ndata: ${encoded}\n\n` }
export const SSE_HEARTBEAT = ': heartbeat\n\n'
export const WS_PING = '{"heartbeat":"ping"}'
export const WS_PONG = '{"heartbeat":"pong"}'

/** H3's Node stream primitive honors pipe backpressure and permits real SSE comments. */
export async function serveRealtimeSse(event: H3Event, options: RealtimeTransportOptions) {
  let channels: string[]
  try { channels = await authorize({ url: event.path, headers: event.headers }, options, 'sse') }
  catch (error) { throw createError({ statusCode: error instanceof RealtimeError && error.code === 'unauthorized' ? 401 : 503, statusMessage: 'Realtime unavailable' }) }
  const stream = new PassThrough({ highWaterMark: 16_384 })
  let unsubscribe = () => {}, heartbeat: ReturnType<typeof setInterval> | undefined
  let cancelWrite: (() => void) | undefined
  const disconnect = () => connection.close()
  const connection = createRealtimeConnection({
    bufferedBytes: () => stream.readableLength + event.node.res.writableLength,
    write: frame => new Promise<void>((resolve, reject) => {
      if (stream.destroyed) { reject(new RealtimeError('closed')); return }
      if (stream.write(frame)) { resolve(); return }
      const cleanup = () => { stream.off('drain', drained); stream.off('close', ended); cancelWrite = undefined }
      const drained = () => { cleanup(); resolve() }
      const ended = () => { cleanup(); reject(new RealtimeError('closed')) }
      cancelWrite = ended
      stream.once('drain', drained); stream.once('close', ended)
    }),
    close: () => { cancelWrite?.(); stream.destroy(); if (!event.node.res.destroyed) event.node.res.end() },
  }, () => {
    unsubscribe(); clearInterval(heartbeat); heartbeat = undefined
    event.node.req.off('aborted', disconnect); event.node.res.off('close', disconnect)
  })
  unsubscribe = options.hub.subscribe(channels, (value) => { connection.send(sseFrame(encodeRealtimeEvent(value), value.type)) }, disconnect)
  event.node.req.once('aborted', disconnect); event.node.res.once('close', disconnect)
  heartbeat = setInterval(() => { try { connection.send(SSE_HEARTBEAT) } catch { connection.close() } }, REALTIME_LIMITS.heartbeatMs)
  setResponseHeaders(event, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' })
  event.node.res.flushHeaders()
  // Resolve on close as H3 sendStream's Node promise otherwise waits for readable end.
  const sending = sendStream(event, stream)
  // Flush a comment immediately so browsers/proxies recognize an idle connection.
  connection.send(': connected\n\n')
  await Promise.race([sending, new Promise<void>(resolve => stream.once('close', resolve))]).finally(disconnect)
}

type Hooks = Parameters<typeof defineWebSocketHandler>[0]
type Peer = Parameters<NonNullable<Hooks['open']>>[0]
export function createRealtimeWebSocketHandler(options: RealtimeTransportOptions) {
  // CrossWS 0.3 context is a string-keyed record; keep authorization server-side.
  const grants = new WeakMap<object, string[]>()
  const connections = new Map<Peer, { connection: ReturnType<typeof createRealtimeConnection>, heartbeat: ReturnType<typeof setInterval>, unsubscribe: () => void, awaitingPong: boolean }>()
  return defineWebSocketHandler({
    async upgrade(request) {
      try {
        const channels = await authorize(request, options, 'websocket')
        grants.set(request.context, channels)
      }
      catch (error) { return new Response('Realtime unavailable', { status: error instanceof RealtimeError && error.code === 'unauthorized' ? 401 : 503 }) }
    },
    open(peer) {
      const channels = grants.get(peer.context)
      grants.delete(peer.context)
      if (!channels) { peer.close(1008, 'Unauthorized'); return }
      const connection = createRealtimeConnection({
        bufferedBytes: () => peer.websocket.bufferedAmount ?? 0,
        write: async (frame) => {
          if (peer.websocket.readyState !== 1) throw new RealtimeError('closed')
          peer.send(frame, { compress: false })
        },
        close: code => { if (code === 'closed') peer.close(1000, 'Closed'); else peer.terminate() },
      }, () => {
        const state = connections.get(peer)
        if (state) { state.unsubscribe(); clearInterval(state.heartbeat); connections.delete(peer) }
      })
      try {
        const unsubscribe = options.hub.subscribe(channels, event => connection.send(encodeRealtimeEvent(event)), () => connection.close())
        const heartbeat = setInterval(() => {
          const state = connections.get(peer)
          if (!state) return
          if (state.awaitingPong || peer.websocket.readyState !== 1) { connection.close('unavailable'); return }
          state.awaitingPong = true
          try { connection.send(WS_PING) } catch { connection.close('unavailable') }
        }, REALTIME_LIMITS.heartbeatMs)
        connections.set(peer, { connection, heartbeat, unsubscribe, awaitingPong: false })
      }
      catch { connection.close('unavailable') }
    },
    message(peer, message) {
      const state = connections.get(peer)
      // Only an outstanding transport heartbeat can be answered. No client commands.
      if (state?.awaitingPong && message.uint8Array().byteLength === Buffer.byteLength(WS_PONG) && message.text() === WS_PONG) state.awaitingPong = false
      else state?.connection.close('unavailable')
    },
    close(peer) { connections.get(peer)?.connection.close() },
    error(peer) { connections.get(peer)?.connection.close('unavailable') },
  })
}
