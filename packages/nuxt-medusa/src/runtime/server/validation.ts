import { z } from 'zod'
import { MedusaError } from './errors'
export function hasControls(s: string) { return [...s].some(char => { const code = char.charCodeAt(0); return code < 32 || (code >= 127 && code <= 159) }) }
export const opaqueId = z.string().min(1).max(128).refine(s => s.isWellFormed() && !hasControls(s))
export const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
export const connectionId = z.string().min(1).max(64).regex(/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/)
export const kind = z.enum(['product', 'order'])
export const scopeSchema = z.object({ kind: z.enum(['user', 'tenant']), id: opaqueId }).strict()
export type Scope = z.infer<typeof scopeSchema>
export interface TrustedContext { actorUserId: string, scope: Scope, signal?: AbortSignal }
export function context(value: TrustedContext) {
  parse(opaqueId, value.actorUserId); parse(scopeSchema, value.scope)
  if (value.scope.kind === 'user' && value.actorUserId !== value.scope.id) throw new MedusaError('forbidden')
  if (value.signal?.aborted) throw new MedusaError('cancelled')
  return value
}
export const bindingRef = z.object({ bindingId: uuid }).strict()
export const operationRef = z.object({ operationId: uuid }).strict()
export const listInput = z.object({ limit: z.number().int().min(1).max(100).optional(), cursor: z.string().max(2048).optional() }).strict()
export const reconcileInput = z.object({ kind, bindingId: uuid }).strict()
export const syncInput = listInput.extend({ kind }).strict()
export const bridgeEvent = z.object({
  version: z.literal(1), id: uuid,
  type: z.enum(['product.created', 'product.updated', 'product.deleted', 'order.placed']),
  resourceKind: kind, resourceId: opaqueId,
}).strict().refine(e => e.type.startsWith(`${e.resourceKind}.`))
export type BridgeEvent = z.infer<typeof bridgeEvent>
export function parse<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const result = schema.safeParse(value)
  if (!result.success) throw new MedusaError('invalid_input')
  return result.data
}
export function decodeCursor(value: string): unknown[] {
  try {
    if (value.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error()
    const tuple: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(value, 'base64url')))
    if (!Array.isArray(tuple) || Buffer.from(JSON.stringify(tuple)).toString('base64url') !== value || tuple[0] !== 1) throw new Error()
    return tuple
  }
  catch { throw new MedusaError('invalid_input') }
}
export function localCursor(value: string) {
  const t = decodeCursor(value)
  if (t.length !== 3 || typeof t[1] !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(t[1])) throw new MedusaError('invalid_input')
  const createdAt = new Date(t[1])
  if (!Number.isFinite(createdAt.getTime()) || createdAt.toISOString() !== t[1]) throw new MedusaError('invalid_input')
  return { createdAt, id: parse(uuid, t[2]) }
}
export function pageCursor(value: string | undefined, resourceKind: 'product' | 'order', connection: string) {
  if (value === undefined) return 0
  const t = decodeCursor(value)
  if (t.length !== 4 || t[1] !== resourceKind || t[2] !== connection || !Number.isSafeInteger(t[3]) || (t[3] as number) < 0) throw new MedusaError('invalid_input')
  return t[3] as number
}
export function encodeCursor(tuple: unknown[]) { return Buffer.from(JSON.stringify(tuple)).toString('base64url') }
