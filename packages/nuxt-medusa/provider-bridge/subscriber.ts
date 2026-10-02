/** Copy into the separate Medusa 2.21.2 project's src/subscribers explicitly.
 * application-bridge.standard-webhooks-v1; not Medusa-native commerce signing.
 * No PII, credentials in payloads, remote registration or starter-owned queue.
 */
import { createHmac, randomUUID } from 'node:crypto'
import { isIP } from 'node:net'
const types = ['product.created', 'product.updated', 'product.deleted', 'order.placed'] as const
type EventType = typeof types[number]
export const config = { event: [...types], context: { subscriberId: 'golden-starter-medusa-bridge-v1' } }
function targetUrl() {
  const original = process.env.MEDUSA_BRIDGE_TARGET_URL ?? '', connection = process.env.MEDUSA_BRIDGE_CONNECTION_ID ?? ''
  if (!/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/.test(connection) || connection.length > 64 || original.length > 2048) throw new Error('Bridge configuration invalid.')
  const url = new URL(original), authority = /^https?:\/\/([^/?#]+)/.exec(original)?.[1] ?? ''
  const host = authority.startsWith('[') ? authority.slice(1, authority.indexOf(']')) : authority.split(':')[0]!
  const loopback = (isIP(host) === 4 && host.startsWith('127.')) || (isIP(host) === 6 && host === '::1')
  if (url.username || url.password || url.hash || url.search || url.pathname !== `/api/integrations/medusa/webhooks/${connection}` || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['test', 'development'].includes(process.env.NODE_ENV ?? '') && loopback))) throw new Error('Bridge configuration invalid.')
  return url
}
/** A retained delivery record can reuse deliveryId. Native subscriber retries may generate a new ID. */
export async function sendHint(type: EventType, resourceId: string, deliveryId = randomUUID(), parent?: AbortSignal) {
  if (!types.includes(type) || typeof resourceId !== 'string' || !resourceId.isWellFormed() || resourceId.length < 1 || resourceId.length > 128 || [...resourceId].some(c => c.charCodeAt(0) < 32 || (c.charCodeAt(0) >= 127 && c.charCodeAt(0) <= 159))) throw new Error('Bridge event invalid.')
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(deliveryId)) throw new Error('Bridge event invalid.')
  const secret = process.env.MEDUSA_BRIDGE_WEBHOOK_SECRET ?? '', key = Buffer.from(secret.slice(6), 'base64')
  if (!secret.startsWith('whsec_') || key.length < 24 || key.length > 64 || key.toString('base64') !== secret.slice(6)) throw new Error('Bridge configuration invalid.')
  const url = targetUrl(), event = { version: 1, id: deliveryId, type, resourceKind: type.startsWith('product.') ? 'product' : 'order', resourceId }, bytes = Buffer.from(JSON.stringify(event))
  const timestamp = String(Math.floor(Date.now() / 1000))
  const signature = createHmac('sha256', key).update(`${deliveryId}.${timestamp}.`).update(bytes).digest('base64')
  const controller = new AbortController(), abort = () => controller.abort(), timer = setTimeout(abort, 15000)
  parent?.addEventListener('abort', abort, { once: true }); if (parent?.aborted) abort()
  let response: Response | undefined
  try {
    if (controller.signal.aborted) throw new Error()
    response = await fetch(url, { method: 'POST', redirect: 'manual', signal: controller.signal, headers: { 'content-type': 'application/json', 'webhook-id': deliveryId, 'webhook-timestamp': timestamp, 'webhook-signature': `v1,${signature}` }, body: bytes })
    const reader = response.body?.getReader(); let size = 0
    if (reader) {
      const cancel = () => { void reader.cancel().catch(() => {}) }
      controller.signal.addEventListener('abort', cancel, { once: true })
      try {
        while (true) { const chunk = await reader.read(); if (controller.signal.aborted) throw new Error(); if (chunk.done) break; size += chunk.value.byteLength; if (size > 2 * 1024 * 1024) { cancel(); throw new Error() } }
      }
      finally { controller.signal.removeEventListener('abort', cancel); reader.releaseLock() }
    }
    if (controller.signal.aborted || !response.ok) throw new Error()
  }
  catch { void response?.body?.cancel().catch(() => {}); throw new Error('Bridge delivery unavailable.') }
  finally { clearTimeout(timer); parent?.removeEventListener('abort', abort) }
}
export default async function subscriber({ event }: { event: { name: string, data: { id?: unknown } } }) {
  if (!types.includes(event.name as EventType) || typeof event.data?.id !== 'string') throw new Error('Bridge event invalid.')
  await sendHint(event.name as EventType, event.data.id)
}
