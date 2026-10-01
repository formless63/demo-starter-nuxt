import { WebhookError } from './errors'
import { bodyLimit } from './events'
import { runBounded } from './bounded'
import { signWebhook } from './signing'
import { validateWebhookTarget } from './target'
import type { WebhookTarget, WebhookTargetPolicy } from './target'

export function isRetryableWebhookStatus(status: number) {
  return [408, 425, 429].includes(status) || (status >= 500 && status <= 599)
}

export interface DeliveryOptions {
  resolveTarget: (targetRef: string, signal: AbortSignal) => WebhookTarget | Promise<WebhookTarget>
  targetPolicy?: WebhookTargetPolicy
  maxBytes?: number
  timeoutMs?: number
}

export async function deliverWebhook(payload: { targetRef: string, id: string, body: string }, options: DeliveryOptions, signal?: AbortSignal) {
  if (typeof payload.body !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(payload.targetRef)) throw new WebhookError('invalid-event')
  if (Buffer.byteLength(payload.body) > bodyLimit(options.maxBytes)) throw new WebhookError('body-too-large')
  return runBounded(async (combined) => {
    let target: WebhookTarget
    try { target = await options.resolveTarget(payload.targetRef, combined) }
    catch (error) {
      if (error instanceof WebhookError) throw error
      throw new WebhookError('target-resolution', true)
    }
    const url = await validateWebhookTarget(target.url, options.targetPolicy, combined)
    if (combined.aborted) throw new WebhookError('timeout', true)
    const body = Buffer.from(payload.body, 'utf8')
    const headers = signWebhook(payload.id, body, target.secret)
    let response: Response
    try {
      response = await fetch(url, { method: 'POST', redirect: 'manual', signal: combined, headers: { ...headers, 'content-type': 'application/json' }, body })
    }
    catch { throw new WebhookError(combined.aborted ? 'timeout' : 'network', true) }
    // Zero response bytes are read or retained. Status is the entire protocol response.
    void response.body?.cancel().catch(() => {})
    if (response.status < 200 || response.status > 299) throw new WebhookError('remote-status', isRetryableWebhookStatus(response.status), response.status)
    return { outcome: 'delivered' as const, status: response.status }
  }, options.timeoutMs ?? 10_000, signal)
}
