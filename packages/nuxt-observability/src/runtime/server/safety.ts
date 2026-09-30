const normalized = (key: string) => key.toLowerCase().replace(/[^a-z0-9]/g, '')
const omitted = new Set(['headers', 'body', 'requestbody', 'responsebody', 'payload', 'session', 'user', 'query', 'url'])
const sensitive = new Set(['authorization', 'cookie', 'setcookie', 'xapikey', 'password', 'secret',
  'apikey', 'token', 'accesstoken', 'refreshtoken', 'clientsecret', 'credential', 'credentials', 'databaseurl'])

export function safeText(value: string) {
  return value.replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s/]*@[^\s]*/gi, '[REDACTED_URL]').slice(0, 1024)
}

export function safeError(error: unknown) {
  // Error messages, stacks, causes and custom properties can contain SQL, URLs or payloads.
  const suppliedName = error instanceof Error ? error.name
    : error && typeof error === 'object' && 'type' in error ? error.type : undefined
  const name = typeof suppliedName === 'string' && ['Error', 'TypeError', 'RangeError', 'SyntaxError', 'AbortError'].includes(suppliedName)
    ? suppliedName : 'Error'
  return { type: name, message: 'An operation failed' }
}

/** Key-based recursive omission, case-insensitive at every depth, including child bindings. */
export function sanitize(value: unknown, redactKeys: string[] = [], depth = 0): unknown {
  if (depth > 8) return '[OMITTED]'
  if (value instanceof Error) return safeError(value)
  if (typeof value === 'string') return safeText(value)
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value === 'boolean' || value === null) return value
  if (Array.isArray(value)) return value.slice(0, 100).map(item => sanitize(item, redactKeys, depth + 1))
  if (!value || typeof value !== 'object') return undefined
  const extra = new Set(redactKeys.map(normalized))
  return Object.fromEntries(Object.entries(value).slice(0, 100).flatMap(([key, item]) => {
    const name = normalized(key)
    if (omitted.has(name) || sensitive.has(name) || extra.has(name)) return []
    if (name === 'err' || name === 'error') return [[key, safeError(item)]]
    return [[key, sanitize(item, redactKeys, depth + 1)]]
  }))
}

export function metadata(value: string | undefined, fallback: string) {
  return value && /^[a-zA-Z0-9_.:+/-]{1,128}$/.test(value) ? value : fallback
}
