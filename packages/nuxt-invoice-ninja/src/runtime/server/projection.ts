import { InvoiceNinjaError } from './errors'
import type { Binding, ClientProjection, InvoiceProjection, InvoiceStatus } from './schema'
import { normalizeDecimal, opaqueId, parse, hasControls } from './validation'
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new InvoiceNinjaError('unavailable')
  return value as Record<string, unknown>
}
export function entity(value: unknown) { return object(object(value).data) }
export function outputDecimal(value: unknown) {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string' || !/^-?(0|[1-9][0-9]{0,23})([.][0-9]{1,8})?$/.test(value)) throw new InvoiceNinjaError('unsupported', false)
  const result = normalizeDecimal(value); return result === '-0' ? '0' : result
}
const statuses: Record<string, InvoiceStatus> = { '1': 'draft', '2': 'sent', '3': 'partial', '4': 'paid', '5': 'cancelled', '6': 'reversed' }
export function projectEntity(binding: Binding, value: unknown, currency: string | null, syncedAt = new Date().toISOString()): ClientProjection | InvoiceProjection {
  const data = entity(value)
  if (parse(opaqueId, data.id) !== binding.remoteId) throw new InvoiceNinjaError('unavailable')
  if (binding.resourceKind === 'client') return { bindingId: binding.id, remoteId: binding.remoteId, syncedAt }
  if (currency !== null && !/^[A-Z]{3}$/.test(currency)) throw new InvoiceNinjaError('unsupported', false)
  let number: string | null = null
  if (data.number !== null && data.number !== undefined) {
    if (typeof data.number !== 'string' || data.number.length > 128 || !data.number.isWellFormed() || hasControls(data.number)) throw new InvoiceNinjaError('unsupported', false)
    number = data.number
  }
  let sourceUpdatedAt: string | null = null
  // Native updated_at is Unix seconds; exact integral conversion within the Date range only.
  if (typeof data.updated_at === 'string' && /^\d{1,13}$/.test(data.updated_at)) {
    const ms = BigInt(data.updated_at) * 1000n
    if (ms <= 8640000000000000n) sourceUpdatedAt = new Date(Number(ms)).toISOString()
  }
  return { bindingId: binding.id, remoteId: binding.remoteId, number, status: statuses[String(data.status_id)] ?? 'unknown', currency,
    amount: outputDecimal(data.amount), balance: outputDecimal(data.balance), sourceUpdatedAt, syncedAt, deleted: data.is_deleted === true }
}
export function serializeProjection(value: ClientProjection | InvoiceProjection) {
  if (!('status' in value)) return { bindingId: value.bindingId, remoteId: value.remoteId, syncedAt: value.syncedAt }
  return { bindingId: value.bindingId, remoteId: value.remoteId, number: value.number, status: value.status, currency: value.currency,
    amount: value.amount, balance: value.balance, sourceUpdatedAt: value.sourceUpdatedAt, syncedAt: value.syncedAt, deleted: value.deleted }
}
