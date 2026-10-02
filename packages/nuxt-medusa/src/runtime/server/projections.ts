import { MedusaError } from './errors'
import { opaqueId, parse, hasControls } from './validation'
export const productStatuses = ['draft', 'proposed', 'published', 'rejected', 'deleted', 'unknown'] as const
export const orderStatuses = ['pending', 'completed', 'draft', 'archived', 'canceled', 'requires_action', 'deleted', 'unknown'] as const
export const paymentStatuses = ['not_paid', 'awaiting', 'authorized', 'partially_authorized', 'captured', 'partially_captured', 'partially_refunded', 'refunded', 'canceled', 'requires_action', 'unknown'] as const
export const fulfillmentStatuses = ['not_fulfilled', 'partially_fulfilled', 'fulfilled', 'partially_shipped', 'shipped', 'partially_delivered', 'delivered', 'canceled', 'unknown'] as const
export interface ProductProjection { bindingId: string, remoteId: string, title: string, handle: string | null, status: typeof productStatuses[number], sourceUpdatedAt: string | null, syncedAt: string, deleted: boolean }
export interface OrderProjection { bindingId: string, remoteId: string, status: typeof orderStatuses[number], paymentStatus: typeof paymentStatuses[number], fulfillmentStatus: typeof fulfillmentStatuses[number], currency: string | null, total: string | null, sourceUpdatedAt: string | null, syncedAt: string, deleted: boolean }
export type Projection = ProductProjection | OrderProjection
function enumValue<T extends readonly string[]>(values: T, value: unknown): T[number] { return typeof value === 'string' && values.includes(value) && value !== 'deleted' ? value : 'unknown' }
function text(value: unknown, nullable = false) {
  if (value == null && nullable) return null
  if (typeof value !== 'string' || value.length > 256 || !value.isWellFormed() || hasControls(value)) throw new MedusaError('unsupported')
  return value
}
export function decimal(value: unknown): string | null {
  if (value == null) return null
  if (typeof value !== 'string' || !/^-?(0|[1-9][0-9]{0,23})(\.[0-9]{1,8})?$/.test(value)) throw new MedusaError('unsupported')
  const normalized = value.includes('.') ? value.replace(/0+$/, '').replace(/\.$/, '') : value
  return /^-0(?:\.0*)?$/.test(normalized) ? '0' : normalized
}
function sourceTime(value: unknown) {
  if (value == null) return null
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT/.test(value)) throw new MedusaError('unsupported')
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) throw new MedusaError('unsupported')
  return date.toISOString()
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new MedusaError('unsupported')
  return value as Record<string, unknown>
}
export function projectResource(resourceKind: 'product' | 'order', bindingId: string, remoteId: string, value: unknown, now = new Date()): Projection {
  const data = object(value)
  if (parse(opaqueId, data.id) !== remoteId) throw new MedusaError('unsupported')
  const common = { bindingId, remoteId, sourceUpdatedAt: sourceTime(data.updated_at), syncedAt: now.toISOString(), deleted: false }
  if (resourceKind === 'product') return { ...common, title: text(data.title)!, handle: text(data.handle, true), status: enumValue(productStatuses, data.status) }
  const currency = data.currency_code == null ? null : typeof data.currency_code === 'string' && /^[a-z]{3}$/.test(data.currency_code) ? data.currency_code : null
  // Native raw_total.value is arbitrary precision. Numeric total is preserved by parseExactJson.
  const raw = data.raw_total == null ? undefined : object(data.raw_total).value
  return { ...common, status: enumValue(orderStatuses, data.status), paymentStatus: enumValue(paymentStatuses, data.payment_status), fulfillmentStatus: enumValue(fulfillmentStatuses, data.fulfillment_status), currency, total: decimal(raw ?? data.total) }
}
/** Closed serializers reselect every field even from the private local JSON column. */
export function publicProjection(kind: 'product' | 'order', value: Projection): Projection {
  const common = { bindingId: value.bindingId, remoteId: value.remoteId, sourceUpdatedAt: value.sourceUpdatedAt, syncedAt: value.syncedAt, deleted: value.deleted }
  if (kind === 'product') { const p = value as ProductProjection; return { ...common, title: p.title, handle: p.handle, status: p.status } }
  const p = value as OrderProjection
  return { ...common, status: p.status, paymentStatus: p.paymentStatus, fulfillmentStatus: p.fulfillmentStatus, currency: p.currency, total: p.total }
}
