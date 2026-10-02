import { z } from 'zod'
import { StripeCapabilityError } from './errors'
export const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
export const opaque = z.string().min(1).max(128).refine(value => value.isWellFormed() && !/[\u0000-\u001f\u007f-\u009f]/.test(value))
export const connectionId = z.string().min(1).max(64).regex(/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/)
export const checkoutInput = z.object({ customerBindingId: uuid, idempotencyKey: z.string().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/), items: z.array(z.object({ offerId: connectionId, quantity: z.number().int().min(1).max(100) }).strict()).min(1).max(20) }).strict().refine(input => new Set(input.items.map(item => item.offerId)).size === input.items.length)
export const bindingInput = z.object({ bindingId: uuid }).strict()
export const operationInput = z.object({ operationId: uuid }).strict()
export const reconcileInput = z.object({ kind: z.enum(['checkout', 'payment']), bindingId: uuid }).strict()
export const listInput = z.object({ limit: z.number().int().min(1).max(100).default(25), cursor: z.string().min(1).max(2048).optional() }).strict()
export type Scope = { kind: 'user' | 'tenant', id: string }
export interface TrustedContext { actorUserId: string, scope: Scope, signal?: AbortSignal }
export function validate<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value)
  if (!parsed.success) throw new StripeCapabilityError('invalid_input')
  return parsed.data
}
export function trustedContext(context: TrustedContext) {
  validate(opaque, context.actorUserId)
  validate(z.object({ kind: z.enum(['user', 'tenant']), id: opaque }).strict(), context.scope)
  if (context.scope.kind === 'user' && context.actorUserId !== context.scope.id) throw new StripeCapabilityError('forbidden')
}
export function decodeCursor(value: string) {
  try {
    if (value.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error()
    const bytes = Buffer.from(value, 'base64url')
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    const tuple: unknown = JSON.parse(text)
    if (!Array.isArray(tuple) || tuple.length !== 3 || tuple[0] !== 1 || typeof tuple[1] !== 'string') throw new Error()
    const id = validate(uuid, tuple[2]), createdAt = new Date(tuple[1])
    if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(tuple[1]) || createdAt.toISOString() !== tuple[1] || encodeCursor(createdAt, id) !== value) throw new Error()
    return { id, createdAt }
  }
  catch { throw new StripeCapabilityError('invalid_input') }
}
export function encodeCursor(createdAt: Date, id: string) { return Buffer.from(JSON.stringify([1, createdAt.toISOString(), id])).toString('base64url') }
