import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { boundedInteger, WebhookError } from './errors'

export const DEFAULT_MAX_BODY_BYTES = 64 * 1024
export const MAX_BODY_BYTES = 1024 * 1024
export const webhookIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/)
export const eventTypeSchema = z.string().regex(/^[a-z][a-z0-9._-]{0,127}$/)
export type WebhookEventRegistry = Record<string, z.ZodType>
export type WebhookEvent<Registry extends WebhookEventRegistry> = {
  [Type in Extract<keyof Registry, string>]: { id: string, type: Type, createdAt: string, data: z.output<Registry[Type]> }
}[Extract<keyof Registry, string>]

export function defineWebhookEvents<const Registry extends WebhookEventRegistry>(registry: Registry): Registry {
  if (!Object.keys(registry).length || Object.keys(registry).some(type => !eventTypeSchema.safeParse(type).success)) throw new WebhookError('configuration')
  return Object.freeze({ ...registry })
}

const envelope = z.object({
  id: webhookIdSchema,
  type: eventTypeSchema,
  createdAt: z.iso.datetime(),
  data: z.json(),
}).strict()

// Schema transforms must return JSON data themselves, without toJSON coercion or
// silently losing unsupported properties during serialization.
function assertJsonData(value: unknown, ancestors = new Set<object>()): void {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return
  if (typeof value === 'number' && Number.isFinite(value)) return
  if (typeof value !== 'object' || !value || ancestors.has(value)) throw new WebhookError('invalid-event')
  const array = Array.isArray(value)
  const prototype = Object.getPrototypeOf(value)
  if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) throw new WebhookError('invalid-event')
  const keys = Reflect.ownKeys(value)
  if (array && keys.length !== value.length + 1) throw new WebhookError('invalid-event')
  ancestors.add(value)
  try {
    for (const key of array ? Array.from({ length: value.length }, (_, i) => String(i)) : keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (typeof key !== 'string' || !descriptor?.enumerable || !('value' in descriptor)) throw new WebhookError('invalid-event')
      assertJsonData(descriptor.value, ancestors)
    }
  }
  finally { ancestors.delete(value) }
}

export function parseWebhookEvent<Registry extends WebhookEventRegistry>(value: unknown, registry: Registry): WebhookEvent<Registry> {
  try {
    const parsed = envelope.parse(value)
    if (!Object.hasOwn(registry, parsed.type)) throw new WebhookError('invalid-event')
    const data = registry[parsed.type]!.parse(parsed.data)
    assertJsonData(data)
    return { ...parsed, data } as WebhookEvent<Registry>
  }
  catch { throw new WebhookError('invalid-event') }
}

export function bodyLimit(maxBytes = DEFAULT_MAX_BODY_BYTES) {
  return boundedInteger(maxBytes, 1, MAX_BODY_BYTES)
}

/** Serialize once; pass this exact string to Jobs. No secrets or endpoint URL. */
export function createWebhookEvent<Registry extends WebhookEventRegistry, Type extends Extract<keyof Registry, string>>(
  registry: Registry,
  type: Type,
  data: z.input<Registry[Type]>,
  options: { maxBytes?: number } = {},
) {
  try {
    if (!Object.hasOwn(registry, type)) throw new WebhookError('invalid-event')
    const event = { id: randomUUID(), type, createdAt: new Date().toISOString(), data: registry[type]!.parse(data) }
    assertJsonData(event.data)
    envelope.parse(event)
    const body = JSON.stringify(event)
    if (Buffer.byteLength(body) > bodyLimit(options.maxBytes)) throw new WebhookError('body-too-large')
    return { id: event.id, type, body }
  }
  catch (error) {
    if (error instanceof WebhookError) throw error
    throw new WebhookError('invalid-event')
  }
}
