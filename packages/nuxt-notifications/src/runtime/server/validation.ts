import { NotificationError } from './errors'
export type NotificationJson = null | boolean | number | string | NotificationJson[] | { [key: string]: NotificationJson }
export type NotificationMetadata = { [key: string]: NotificationJson }

export const notificationLimits = Object.freeze({
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
  throw new NotificationError('invalid-input')
}

export function boundedString(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value.trim().length || value.length > max || !value.isWellFormed() || Array.from(value).some(character => character.charCodeAt(0) < 32 || (character.charCodeAt(0) >= 127 && character.charCodeAt(0) <= 159))) invalid()
  return value
}

/** Namespaced lowercase notification identifiers. */
export function notificationType(value: unknown): string {
  const type = boundedString(value, 128)
  if (!/^[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)+$/.test(type) || !type.includes('.')) invalid()
  return type
}

export function notificationDate(value: unknown): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) invalid()
  return new Date(value.getTime())
}

export function validateMetadata(value: unknown = {}): NotificationMetadata {
  const seen = new Set<object>()
  let nodes = 0
  function visit(item: unknown, depth: number): NotificationJson {
    if (++nodes > notificationLimits.nodes || depth > notificationLimits.depth) invalid()
    if (item === null || typeof item === 'boolean') return item
    if (typeof item === 'number') {
      if (!Number.isFinite(item)) invalid()
      return item
    }
    if (typeof item === 'string') {
      if (item.length > notificationLimits.stringLength || !item.isWellFormed() || Array.from(item).some(character => character.charCodeAt(0) < 32 || (character.charCodeAt(0) >= 127 && character.charCodeAt(0) <= 159))) invalid()
      return item
    }
    if (typeof item !== 'object' || !item || seen.has(item)) invalid()
    seen.add(item)
    try {
      if (Array.isArray(item)) {
        if (Object.getPrototypeOf(item) !== Array.prototype || item.length > notificationLimits.arrayItems) invalid()
        const keys = Reflect.ownKeys(item)
        if (keys.length !== item.length + 1) invalid() // sparse arrays, symbols and custom properties
        return Array.from({ length: item.length }, (_, i) => {
          const descriptor = Object.getOwnPropertyDescriptor(item, String(i))
          if (!descriptor?.enumerable || !('value' in descriptor)) invalid()
          return visit(descriptor.value, depth + 1)
        })
      }
      if (Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) invalid()
      const keys = Reflect.ownKeys(item)
      if (keys.length > notificationLimits.objectKeys) invalid()
      const result: NotificationMetadata = {}
      for (const key of keys) {
        boundedString(key, notificationLimits.keyLength)
        const normalized = String(key).toLowerCase().replace(/[^a-z0-9]/g, '')
        if (/password|passwd|pwd|secret|token|authorization|cookie|apikey|credential/.test(normalized)
          || ['request', 'session', 'body', 'headers', 'header', 'proto', 'constructor', 'prototype'].includes(normalized)) invalid()
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
  const result = visit(value, 0) as NotificationMetadata
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > notificationLimits.metadataBytes) invalid()
  return result
}
