import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { signWebhook, verifyWebhookSignature } from '@repo/nuxt-webhooks/server'
import { MedusaError } from './errors'
import { deadline, checkLength, readBytes, cancellable } from './io'
import { bridgeEvent, connectionId, opaqueId, parse, uuid } from './validation'
import type { BridgeEvent } from './validation'
import { endpoint } from './transport'
export const bridgeProtocol = 'application-bridge.standard-webhooks-v1' as const
export function bridgeSecrets(env: NodeJS.ProcessEnv = process.env) {
  const values = [env.MEDUSA_BRIDGE_WEBHOOK_SECRET, env.MEDUSA_BRIDGE_WEBHOOK_SECRET_PREVIOUS].filter((s): s is string => s !== undefined)
  if (!env.MEDUSA_BRIDGE_WEBHOOK_SECRET || !values.every(s => /^whsec_[A-Za-z0-9+/]+={0,2}$/.test(s) && Buffer.from(s.slice(6), 'base64').length >= 24 && Buffer.from(s.slice(6), 'base64').length <= 64 && Buffer.from(s.slice(6), 'base64').toString('base64') === s.slice(6))) throw new MedusaError('unconfigured')
  return values
}
const envelope = z.object({ version: z.literal(1), id: uuid, type: z.string().min(1).max(64).regex(/^[a-z]+\.[a-z_]+$/), resourceKind: z.enum(['product', 'order']), resourceId: opaqueId }).strict()
/** The caller owns the five-second budget through its receipt transaction. */
export async function readBridge(request: Request, secrets: readonly string[], budget: ReturnType<typeof deadline>) {
  try {
    budget.check(); checkLength(request.headers, 1024 * 1024)
    for (const name of ['webhook-id', 'webhook-timestamp', 'webhook-signature']) {
      const value = request.headers.get(name)
      if (!value || Buffer.byteLength(value) > 8192 || (name !== 'webhook-signature' && value.includes(','))) throw new MedusaError('invalid_input')
    }
    if (!/^v1,[A-Za-z0-9+/]{43}=(?: v1,[A-Za-z0-9+/]{43}=)*$/.test(request.headers.get('webhook-signature')!)) throw new MedusaError('invalid_input')
    const bytes = await readBytes(request.body, 1024 * 1024, budget)
    const id = verifyWebhookSignature(bytes, request.headers, secrets, { toleranceSeconds: 300 })
    const value = parse(envelope, JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)))
    if (value.id !== id || !value.type.startsWith(`${value.resourceKind}.`)) throw new MedusaError('invalid_input')
    const supported = bridgeEvent.safeParse(value)
    return { event: value, supported: supported.success, hash: createHash('sha256').update(bytes).digest('hex') }
  }
  catch (error) {
    budget.check()
    if (error instanceof MedusaError) throw error
    throw new MedusaError('invalid_input')
  }
}
/** Separate provider-project producer. No starter queue, no PII, no registration. */
export async function deliverBridge(input: BridgeEvent, options: { targetUrl: string, connectionId: string, secret: string, signal?: AbortSignal, timeoutMs?: number, env?: NodeJS.ProcessEnv, fetch?: typeof fetch }) {
  const event = parse(bridgeEvent, input), connection = parse(connectionId, options.connectionId)
  bridgeSecrets({ MEDUSA_BRIDGE_WEBHOOK_SECRET: options.secret })
  let target: URL
  try {
    target = new URL(options.targetUrl)
    endpoint(target.origin, options.env)
    if (target.username || target.password || target.hash || target.search || target.pathname !== `/api/integrations/medusa/webhooks/${connection}`) throw new Error()
  }
  catch { throw new MedusaError('unconfigured') }
  const bytes = Buffer.from(JSON.stringify(event)), budget = deadline(15000, [options.signal], options.timeoutMs)
  let response: Response | undefined
  try {
    budget.check()
    response = await cancellable((options.fetch ?? fetch)(target, { method: 'POST', redirect: 'manual', signal: budget.signal, headers: { 'content-type': 'application/json', ...signWebhook(event.id, bytes, options.secret) }, body: bytes }), budget.signal)
    checkLength(response.headers, 2 * 1024 * 1024); await readBytes(response.body, 2 * 1024 * 1024, budget); budget.check()
    if (!response.ok) throw new MedusaError('unavailable')
  }
  catch (error) { void response?.body?.cancel().catch(() => {}); budget.check(); throw error instanceof MedusaError ? error : new MedusaError('unavailable') }
  finally { budget.close() }
}
export function createBridgeEvent(type: BridgeEvent['type'], resourceId: string, deliveryId = randomUUID()): BridgeEvent {
  return parse(bridgeEvent, { version: 1, id: deliveryId, type, resourceKind: type.startsWith('product.') ? 'product' : 'order', resourceId })
}
