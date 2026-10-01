import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { REALTIME_LIMITS, RealtimeError } from './errors'

export const realtimeTypeSchema = z.string().regex(/^[a-z][a-z0-9._-]{0,127}$/)
export const realtimeChannelSchema = z.string().regex(/^[a-z][a-z0-9._:/-]{0,127}$/)
export type RealtimeRegistry = Record<string, z.ZodType>
export interface RealtimeEvent { id: string, type: string, occurredAt: string, data: unknown }
const envelope = z.object({ id: z.uuid(), type: realtimeTypeSchema, occurredAt: z.iso.datetime(), data: z.unknown() }).strict()

export function defineRealtimeEvents<const Registry extends RealtimeRegistry>(registry: Registry): Registry {
  if (!Object.keys(registry).length || Object.keys(registry).some(type => !realtimeTypeSchema.safeParse(type).success)) throw new RealtimeError('configuration')
  return Object.freeze({ ...registry })
}

// Inspect descriptors before serialization/schema parsing; never invoke a getter/toJSON.
export function assertRealtimeJson(value: unknown, ancestors = new Set<object>()): void {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return
  if (typeof value === 'number' && Number.isFinite(value)) return
  if (typeof value !== 'object' || !value || ancestors.has(value)) throw new RealtimeError('invalid-input')
  const array = Array.isArray(value)
  const prototype = Object.getPrototypeOf(value)
  if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) throw new RealtimeError('invalid-input')
  const keys = Reflect.ownKeys(value)
  if (array && keys.length !== value.length + 1) throw new RealtimeError('invalid-input')
  ancestors.add(value)
  try {
    for (const key of array ? Array.from({ length: value.length }, (_, i) => String(i)) : keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (typeof key !== 'string' || !descriptor?.enumerable || !('value' in descriptor)) throw new RealtimeError('invalid-input')
      assertRealtimeJson(descriptor.value, ancestors)
    }
  }
  finally { ancestors.delete(value) }
}

export function encodeRealtimeEvent(event: RealtimeEvent): string {
  try {
    assertRealtimeJson(event)
    envelope.parse(event)
    if (new Date(event.occurredAt).toISOString() !== event.occurredAt) throw new RealtimeError('invalid-input')
    const encoded = JSON.stringify(event)
    if (Buffer.byteLength(encoded) > REALTIME_LIMITS.eventBytes) throw new RealtimeError('invalid-input')
    return encoded
  }
  catch { throw new RealtimeError('invalid-input') }
}

export function createRealtimeEvent<Registry extends RealtimeRegistry, Type extends Extract<keyof Registry, string>>(registry: Registry, type: Type, data: z.input<Registry[Type]>) {
  try {
    if (!Object.hasOwn(registry, type)) throw new RealtimeError('invalid-input')
    assertRealtimeJson(data)
    const event = { id: randomUUID(), type, occurredAt: new Date().toISOString(), data: registry[type]!.parse(data) }
    encodeRealtimeEvent(event)
    return event
  }
  catch { throw new RealtimeError('invalid-input') }
}

/** For app-owned fanout ingestion: validate the same registered schemas and bounds. */
export function parseRealtimeEvent(value: unknown, registry: RealtimeRegistry): RealtimeEvent {
  try {
    assertRealtimeJson(value)
    const event = envelope.parse(value)
    if (!Object.hasOwn(registry, event.type)) throw new RealtimeError('invalid-input')
    const parsed = { ...event, data: registry[event.type]!.parse(event.data) }
    encodeRealtimeEvent(parsed)
    return parsed
  }
  catch { throw new RealtimeError('invalid-input') }
}

export function authorizedChannels(value: unknown): string[] {
  if (!Array.isArray(value) || !value.length || value.length > REALTIME_LIMITS.channels) throw new RealtimeError('unauthorized')
  if (value.some(channel => !realtimeChannelSchema.safeParse(channel).success) || new Set(value).size !== value.length) throw new RealtimeError('unauthorized')
  return [...value] as string[]
}
