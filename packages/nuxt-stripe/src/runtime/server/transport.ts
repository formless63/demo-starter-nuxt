import Stripe from 'stripe'
import { StripeCapabilityError } from './errors'
import { API_VERSION, validateConnection } from './config'
import type { StripeConnection } from './config'

export function deadline(maximumMs: number, signal?: AbortSignal, shorterMs = maximumMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new StripeCapabilityError('deadline_exceeded')), Math.min(maximumMs, Math.max(1, shorterMs)))
  const abort = () => controller.abort(new StripeCapabilityError('cancelled'))
  if (signal?.aborted) abort()
  else signal?.addEventListener('abort', abort, { once: true })
  return { signal: controller.signal, check() { if (controller.signal.aborted) throw controller.signal.reason }, close() { clearTimeout(timer); signal?.removeEventListener('abort', abort) } }
}
export async function boundedBody(body: ReadableStream<Uint8Array> | null, signal: AbortSignal, maximum = 2 * 1024 * 1024) {
  if (!body) return new Uint8Array()
  const reader = body.getReader(), chunks: Uint8Array[] = []
  let bytes = 0
  const aborted = () => { void reader.cancel().catch(() => {}) }
  signal.addEventListener('abort', aborted, { once: true })
  try {
    while (true) {
      if (signal.aborted) throw signal.reason
      const next = await reader.read()
      if (signal.aborted) throw signal.reason
      if (next.done) break
      bytes += next.value.byteLength
      if (bytes > maximum) { await reader.cancel(); throw new StripeCapabilityError('limit_exceeded') }
      chunks.push(next.value)
    }
    const result = new Uint8Array(bytes)
    let offset = 0
    for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength }
    return result
  }
  finally { signal.removeEventListener('abort', aborted); reader.releaseLock() }
}
/** One SDK instance/FetchHttpClient per operation; transport cancellation survives body consumption. */
export async function stripeOperation<T>(connection: StripeConnection, operation: (client: Stripe) => Promise<T>, options: { signal?: AbortSignal, timeoutMs?: number, fetch?: typeof fetch, environment?: string } = {}): Promise<T> {
  validateConnection(connection, options.environment)
  const budget = deadline(15000, options.signal, options.timeoutMs)
  const transport: typeof fetch = async (input, init) => {
    budget.check()
    const signal = init?.signal ? AbortSignal.any([budget.signal, init.signal]) : budget.signal
    if (typeof init?.body !== 'string' || Buffer.byteLength(init.body) > 256 * 1024) {
      if (init?.body != null) throw new StripeCapabilityError('limit_exceeded')
    }
    const response = await (options.fetch ?? fetch)(input, { ...init, redirect: 'error', signal })
    const bytes = await boundedBody(response.body, signal)
    budget.check()
    return new Response(bytes, { status: response.status, statusText: response.statusText, headers: response.headers })
  }
  const base = connection.apiBase ? new URL(connection.apiBase) : null
  const client = new Stripe(connection.secretKey, {
    apiVersion: API_VERSION, maxNetworkRetries: 0, telemetry: false, timeout: 15000,
    httpClient: Stripe.createFetchHttpClient(transport),
    ...(base ? { host: base.hostname.replace(/^\[|\]$/g, ''), port: Number(base.port || (base.protocol === 'https:' ? 443 : 80)), protocol: base.protocol === 'http:' ? 'http' : 'https' } : {}),
  })
  try { return await operation(client) }
  catch (error) { budget.check(); throw error }
  finally { budget.close() }
}
