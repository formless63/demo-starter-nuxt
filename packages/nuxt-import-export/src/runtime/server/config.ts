import { TransferError } from './errors'
export function transferConfig(env: NodeJS.ProcessEnv = process.env) {
  function integer(name: string, fallback: number, min: number, max: number) {
    const value = env[name]
    if (value === undefined || value === '') return fallback
    if (!/^[0-9]+$/.test(value)) throw new TransferError('configuration')
    const number = Number(value)
    if (!Number.isSafeInteger(number) || number < min || number > max) throw new TransferError('configuration')
    return number
  }
  return {
    maxBytes: integer('IMPORT_EXPORT_MAX_BYTES', 16777216, 1024, 67108864),
    maxRows: integer('IMPORT_EXPORT_MAX_ROWS', 10000, 1, 100000),
    timeoutSeconds: integer('IMPORT_EXPORT_TIMEOUT_SECONDS', 60, 5, 300),
    artifactTtlSeconds: integer('IMPORT_EXPORT_ARTIFACT_TTL_SECONDS', 86400, 300, 604800),
  }
}
export type TransferConfig = ReturnType<typeof transferConfig>
export type Scope = { kind: 'user', id: string } | { kind: 'tenant', id: string }
export interface TransferContext { requesterId: string, scope: Scope }
export function opaqueId(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 128 || /[\u0000-\u001f\u007f-\u009f]/.test(value)) throw new TransferError('invalid-input')
  return value
}
export function trustedContext(context: TransferContext) {
  if (!context?.requesterId) throw new TransferError('unauthenticated')
  opaqueId(context.requesterId)
  if (!context.scope || !['user', 'tenant'].includes(context.scope.kind)) throw new TransferError('invalid-input')
  opaqueId(context.scope.id)
  if (context.scope.kind === 'user' && context.scope.id !== context.requesterId) throw new TransferError('forbidden')
  return context
}
export function transferId(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)) throw new TransferError('invalid-input')
  return value
}
export function idempotencyKey(value: unknown): string {
  if (typeof value !== 'string' || !/^[\x20-\x7e]{1,128}$/.test(value)) throw new TransferError('invalid-input')
  return value
}
