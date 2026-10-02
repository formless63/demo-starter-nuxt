import { setHeader, setResponseStatus, toWebRequest } from 'h3'
import type { H3Event } from 'h3'
import { MedusaError, safeError, deadline, readBytes } from '@repo/nuxt-medusa/server'
export function requestSignal(event: H3Event) {
  const controller = new AbortController()
  const abort = () => controller.abort()
  const close = () => { if (!event.node.res.writableFinished) abort() }
  event.node.req.once('aborted', abort); event.node.res.once('close', close)
  return { signal: controller.signal, close() { event.node.req.off('aborted', abort); event.node.res.off('close', close) } }
}
export async function medusaHttp<T>(event: H3Event, action: (signal: AbortSignal) => Promise<T>) {
  setHeader(event, 'cache-control', 'private, no-store'); setHeader(event, 'vary', 'Cookie')
  const request = requestSignal(event)
  try {
    const result = await action(request.signal)
    if (Buffer.byteLength(JSON.stringify(result)) > 256 * 1024) throw new MedusaError('limit_exceeded')
    return result
  }
  catch (error) {
    const code = (error as { statusCode?: number })?.statusCode
    const safe = code === 401 ? new MedusaError('unauthenticated') : safeError(error)
    setResponseStatus(event, safe.status)
    return safe.public()
  }
  finally { request.close() }
}
export async function readInput(event: H3Event, signal: AbortSignal) {
  const budget = deadline(5000, [signal])
  try {
    const request = toWebRequest(event), bytes = await readBytes(request.body, 256 * 1024, budget)
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown }
    catch { throw new MedusaError('invalid_input') }
  }
  finally { budget.close() }
}
