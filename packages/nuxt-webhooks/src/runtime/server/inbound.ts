import { bodyLimit, parseWebhookEvent } from './events'
import type { WebhookEvent, WebhookEventRegistry } from './events'
import { WebhookError } from './errors'
import { runBounded } from './bounded'
import { verifyWebhookSignature } from './signing'

/** Implement with durable atomic claim + work/Jobs enqueue in one transaction.
 * Scope by trusted receiver/tenant, retain IDs beyond retry horizon, and roll back on failure.
 * Jobs singleton windows alone are not durable replay storage.
 */
export interface WebhookIdempotency<Context = void> {
  runOnce<T>(id: string, operation: (context: Context) => Promise<T>): Promise<{ duplicate: true } | { duplicate: false, result: T }>
}

export async function verifyWebhookRequest<Registry extends WebhookEventRegistry>(request: Request, options: {
  events: Registry
  secrets: readonly string[]
  maxBytes?: number
  toleranceSeconds?: number
  timeoutMs?: number
}) {
  const maxBytes = bodyLimit(options.maxBytes)
  const length = request.headers.get('content-length')
  if (length !== null && (!/^[0-9]+$/.test(length) || Number(length) > maxBytes)) throw new WebhookError('body-too-large')
  if (request.bodyUsed) throw new WebhookError('invalid-signature')
  return runBounded(async (signal) => {
    let reader: ReadableStreamDefaultReader<Uint8Array>
    try {
      if (!request.body) throw new WebhookError('invalid-event')
      reader = request.body.getReader()
    }
    catch { throw new WebhookError('invalid-event') }
    const cancel = () => { void reader.cancel().catch(() => {}) }
    signal.addEventListener('abort', cancel, { once: true })
    const chunks: Uint8Array[] = []
    let total = 0
    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        total += value.byteLength
        if (total > maxBytes) throw new WebhookError('body-too-large')
        chunks.push(value)
      }
      const bytes = Buffer.concat(chunks, total)
      const id = verifyWebhookSignature(bytes, request.headers, options.secrets, options)
      let event: WebhookEvent<Registry>
      try { event = parseWebhookEvent(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), options.events) }
      catch { throw new WebhookError('invalid-event') }
      if (event.id !== id) throw new WebhookError('invalid-event')
      return event
    }
    catch (error) {
      void reader.cancel().catch(() => {})
      if (error instanceof WebhookError) throw error
      throw new WebhookError('invalid-event')
    }
    finally {
      signal.removeEventListener('abort', cancel)
      reader.releaseLock()
    }
  }, options.timeoutMs ?? 15_000, request.signal)
}

/** The callback can call sendJobInTransaction using the application's durable hook. */
export async function handoffWebhook<Event extends { id: string }, Result, Context = void>(event: Event, operation: (event: Event, context: Context) => Promise<Result>, idempotency: WebhookIdempotency<Context>) {
  return idempotency.runOnce(event.id, context => operation(event, context))
}
