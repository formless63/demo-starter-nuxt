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
  catch (error) { const safe = safeError(error); setResponseStatus(event, safe.statusCode); return { error: safe.public() } }
  finally { budget.close(); event.node.res.removeListener('close', close) }
}
export async function rawBody(event: H3Event, signal: AbortSignal, maximum: number) {
  const request = event.node.req
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      try { for await (const chunk of request) { if (signal.aborted) throw signal.reason; controller.enqueue(typeof chunk === 'string' ? Buffer.from(chunk) : chunk) } controller.close() }
      catch (error) { controller.error(error) }
    },
    cancel() { request.destroy() },
  })
  return boundedBody(body, signal, maximum)
}
