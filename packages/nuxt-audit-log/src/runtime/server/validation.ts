export type AuditJson = null | boolean | number | string | AuditJson[] | { [key: string]: AuditJson }
export type AuditMetadata = { [key: string]: AuditJson }

export const auditLimits = Object.freeze({
  metadataBytes: 8_192,
  depth: 6,
  objectKeys: 50,
  arrayItems: 100,
  nodes: 1_024,
  keyLength: 64,
  stringLength: 1_024,
})

function invalid(): never {
  // Never echo rejected keys, values or credentials in errors.
  throw new TypeError('Invalid audit data')
}

export function boundedString(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value.length || value.length > max || Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) invalid()
  return value
}

/** Lowercase domain.action identifiers, with conservative segment characters. */
export function auditAction(value: unknown): string {
  const action = boundedString(value, 128)
  if (!/^[a-z][a-z0-9]*(?:[_-][a-z0-9]+)*(?:\.[a-z][a-z0-9]*(?:[_-][a-z0-9]+)*)+$/.test(action)) invalid()
  return action
}

export function auditDate(value: unknown): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) invalid()
  return new Date(value.getTime())
}

export function validateMetadata(value: unknown = {}): AuditMetadata {
  const seen = new Set<object>()
  let nodes = 0
  function visit(item: unknown, depth: number): AuditJson {
    if (++nodes > auditLimits.nodes || depth > auditLimits.depth) invalid()
    if (item === null || typeof item === 'boolean') return item
    if (typeof item === 'number') {
      if (!Number.isFinite(item)) invalid()
      return item
    }
    if (typeof item === 'string') {
      if (item.length > auditLimits.stringLength || item.includes('\u0000')) invalid()
      return item
    }
    if (typeof item !== 'object' || !item || seen.has(item)) invalid()
    seen.add(item)
    try {
      if (Array.isArray(item)) {
        if (Object.getPrototypeOf(item) !== Array.prototype || item.length > auditLimits.arrayItems) invalid()
        const keys = Reflect.ownKeys(item)
        if (keys.length !== item.length + 1) invalid() // sparse arrays, symbols and custom properties
        return Array.from({ length: item.length }, (_, i) => {
          const descriptor = Object.getOwnPropertyDescriptor(item, String(i))
          if (!descriptor || !('value' in descriptor)) invalid()
          return visit(descriptor.value, depth + 1)
        })
      }
      if (Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) invalid()
      const keys = Reflect.ownKeys(item)
      if (keys.length > auditLimits.objectKeys) invalid()
      const result: AuditMetadata = {}
      for (const key of keys) {
        boundedString(key, auditLimits.keyLength)
        const normalized = String(key).toLowerCase().replace(/[^a-z0-9]/g, '')
        if (/password|passwd|pwd|secret|token|authorization|cookie|apikey/.test(normalized)
          || ['request', 'session', 'body', 'headers', 'header', '__proto__', 'constructor', 'prototype'].includes(String(key).toLowerCase())) invalid()
        const descriptor = Object.getOwnPropertyDescriptor(item, key)
        if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) invalid()
        result[String(key)] = visit(descriptor.value, depth + 1)
      }
      return result
    }
    finally {
      seen.delete(item)
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid()
  const result = visit(value, 0) as AuditMetadata
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > auditLimits.metadataBytes) invalid()
  return result
}
