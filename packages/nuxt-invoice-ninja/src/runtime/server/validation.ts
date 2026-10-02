import { z } from 'zod'
import { InvoiceNinjaError } from './errors'
export const opaqueId = z.string().min(1).max(128).refine(s => s.isWellFormed() && !/[\u0000-\u001f\u007f-\u009f]/u.test(s))
export const connectionId = z.string().max(64).regex(/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/)
export const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
export const scopeSchema = z.object({ kind: z.enum(['user', 'tenant']), id: opaqueId }).strict()
export type Scope = z.infer<typeof scopeSchema>
export interface TrustedContext { actorUserId: string, scope: Scope, signal?: AbortSignal }
export const bindingRef = z.object({ bindingId: uuid }).strict()
export const operationRef = z.object({ operationId: uuid }).strict()
export const invoiceReconcileInput = z.object({ invoiceBindingId: uuid }).strict()
export const clientReconcileInput = z.object({ clientBindingId: uuid }).strict()
const decimal = z.string().regex(/^(0|[1-9][0-9]{0,13})([.][0-9]{1,4})?$/).transform(normalizeDecimal)
export function normalizeDecimal(s: string) { return s.includes('.') ? s.replace(/0+$/, '').replace(/[.]$/, '') : s }
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s => { const d = new Date(`${s}T00:00:00.000Z`); return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s })
export const draftInput = z.object({
  clientBindingId: uuid, idempotencyKey: z.string().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/),
  invoiceDate: date, dueDate: date.optional(),
  numbering: z.discriminatedUnion('mode', [z.object({ mode: z.literal('provider') }).strict(), z.object({ mode: z.literal('explicit'), number: z.string().min(1).max(64).regex(/^[A-Za-z0-9._/-]+$/) }).strict()]),
  lines: z.array(z.object({
    description: z.string().min(1).max(2000).refine(s => s.isWellFormed() && !/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/u.test(s)),
    quantity: decimal.refine(s => s !== '0'), unitCost: decimal,
  }).strict()).min(1).max(100),
}).strict().refine(s => !s.dueDate || s.dueDate >= s.invoiceDate)
export type DraftInput = z.infer<typeof draftInput>
export const listInput = z.object({ limit: z.number().int().min(1).max(100).default(25), cursor: z.string().max(2048).optional() }).strict()
export function parse<T>(schema: z.ZodType<T>, value: unknown): T { const r = schema.safeParse(value); if (!r.success) throw new InvoiceNinjaError('invalid_input'); return r.data }
export function decodeCursor(value: string) {
  try {
    if (value.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error()
    const bytes = Buffer.from(value, 'base64url'), s = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    const a: unknown = JSON.parse(s)
    if (!Array.isArray(a) || a.length !== 3 || a[0] !== 1 || typeof a[1] !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(a[1])) throw new Error()
    const id = parse(uuid, a[2]), createdAt = new Date(a[1])
    if (createdAt.toISOString() !== a[1] || Buffer.from(JSON.stringify(a)).toString('base64url') !== value) throw new Error()
    return { id, createdAt }
  }
  catch { throw new InvoiceNinjaError('invalid_input') }
}
