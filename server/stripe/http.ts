import { setHeader, setResponseStatus } from 'h3'
import type { H3Event } from 'h3'
import { safeError, StripeCapabilityError, deadline, boundedBody } from '@repo/nuxt-stripe/server'
export async function stripeHttp<T>(event: H3Event, action: (signal: AbortSignal) => Promise<T>, callback = false) {
  setHeader(event, 'cache-control', 'no-store')
  const controller = new AbortController(), close = () => { if (!event.node.res.writableEnded) controller.abort() }
  event.node.res.once('close', close)
  const budget = deadline(callback ? 5000 : 15000, controller.signal)
  try {
    const result = await action(budget.signal)
    budget.check()
    if (Buffer.byteLength(JSON.stringify(result)) > 256 * 1024) throw new StripeCapabilityError('limit_exceeded')
    return result
  }
  catch (error) { const safe = safeError(error); setResponseStatus(event, safe.statusCode); return { error: safe.public(event.method === 'GET' && !callback) } }
  finally { budget.close(); event.node.res.removeListener('close', close) }
}
export async function rawBody(event: H3Event, signal: AbortSignal, maximum: number) {
  const request = event.node.req
  let detach = () => {}
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const data = (chunk: Buffer | string) => { request.pause(); controller.enqueue(typeof chunk === 'string' ? Buffer.from(chunk) : chunk) }
      const end = () => { detach(); controller.close() }
      const error = (cause: Error) => { detach(); controller.error(cause) }
      detach = () => { request.off('data', data); request.off('end', end); request.off('error', error) }
      request.on('data', data); request.once('end', end); request.once('error', error)
      request.pause()
    },
    pull() { request.resume() },
    cancel() {
      // Stop reading now, then close after the static error response reaches the client.
      // Destroying the request here would also destroy the socket before a413/504 response.
      request.pause(); detach()
      if (!event.node.res.headersSent) event.node.res.setHeader('connection', 'close')
      event.node.res.once('finish', () => request.destroy())
    },
  })
  return boundedBody(body, signal, maximum)
}
