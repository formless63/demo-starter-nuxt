import { Buffer } from 'node:buffer'
import { AuthorizationError } from './errors'

export type Scope = Readonly<{ kind: 'user' | 'tenant', id: string }>
export function opaqueId(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 128 || [...value].some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)) throw new AuthorizationError('invalid-input')
  return value
}
export function scope(value: Scope): Scope {
  if (!value || (value.kind !== 'user' && value.kind !== 'tenant')) throw new AuthorizationError('invalid-input')
  return Object.freeze({ kind: value.kind, id: opaqueId(value.id) })
}
export function identifier(value: unknown, max: number, action = false): string {
  if (typeof value !== 'string' || !value || value.length > max || !/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/.test(value) || (action && !value.includes('.'))) throw new AuthorizationError('configuration')
  return value
}
export function pagination(input: { limit?: number, cursor?: string }) {
  const limit = input.limit ?? 25
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new AuthorizationError('invalid-input')
  let cursor: { createdAt: Date, id: string } | undefined
  if (input.cursor !== undefined) {
    try {
      if (input.cursor.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(input.cursor)) throw new Error()
      const tuple: unknown = JSON.parse(Buffer.from(input.cursor, 'base64url').toString('utf8'))
      if (!Array.isArray(tuple) || tuple.length !== 3 || tuple[0] !== 1 || typeof tuple[1] !== 'string' || typeof tuple[2] !== 'string' || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(tuple[2])) throw new Error()
      const date = new Date(tuple[1])
      if (date.toISOString() !== tuple[1] || Buffer.from(JSON.stringify(tuple)).toString('base64url') !== input.cursor) throw new Error()
      cursor = { createdAt: date, id: tuple[2] }
    }
    catch { throw new AuthorizationError('invalid-input') }
  }
  return { limit, cursor }
}
export function nextCursor(row: { createdAt: Date, id: string }) { return Buffer.from(JSON.stringify([1, row.createdAt.toISOString(), row.id])).toString('base64url') }
