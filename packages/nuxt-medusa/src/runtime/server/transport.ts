import { isIP } from 'node:net'
import { MedusaError } from './errors'
import { cancellable, checkLength, deadline, readBytes } from './io'
import { connectionId, parse, hasControls } from './validation'
export interface Connection { id: string, baseUrl: string, secretApiKey: string, salesChannelId?: string }
function literalLoopback(host: string) {
  const original = host.replace(/^\[|\]$/g, '')
  return (isIP(original) === 4 && /^127\./.test(original)) || (isIP(original) === 6 && original === '::1')
}
export function endpoint(value: string, env: NodeJS.ProcessEnv = process.env) {
  try {
    if (typeof value !== 'string' || value.length > 2048 || (/\s/u.test(value) || hasControls(value))) throw new Error()
    const originalHost = /^https?:\/\/([^/?#]+)/.exec(value)?.[1] ?? ''
    const host = originalHost.startsWith('[') ? originalHost.slice(0, originalHost.indexOf(']') + 1) : originalHost.split(':')[0]!
    const url = new URL(value)
    if (url.username || url.password || url.hash || url.search || (url.pathname !== '/' && url.pathname !== '')) throw new Error()
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['test', 'development'].includes(env.NODE_ENV ?? '') && literalLoopback(host))) throw new Error()
    return url
  }
  catch { throw new MedusaError('unconfigured') }
}
export function validateConnection(value: Connection, env?: NodeJS.ProcessEnv) {
  parse(connectionId, value.id); endpoint(value.baseUrl, env)
  if (typeof value.secretApiKey !== 'string' || value.secretApiKey.length < 1 || value.secretApiKey.length > 4096 || (/[:\s]/u.test(value.secretApiKey) || hasControls(value.secretApiKey))) throw new MedusaError('unconfigured')
  return value
}
export function environmentConnection(env: NodeJS.ProcessEnv = process.env): Connection {
  return validateConnection({ id: 'default', baseUrl: env.MEDUSA_BASE_URL ?? '', secretApiKey: env.MEDUSA_SECRET_API_KEY ?? '' }, env)
}
export const fields = {
  product: 'id,title,handle,status,updated_at',
  order: 'id,status,payment_status,fulfillment_status,currency_code,total,raw_total,updated_at',
} as const
/** Only four Admin GET paths. Never SDK retries or implicit pagination. */
export async function adminGet(connection: Connection, resourceKind: 'product' | 'order', input: { remoteId: string } | { limit: number, offset: number }, options: { signal?: AbortSignal, timeoutMs?: number, env?: NodeJS.ProcessEnv, fetch?: typeof fetch } = {}) {
  validateConnection(connection, options.env)
  const budget = deadline(15000, [options.signal], options.timeoutMs)
  let response: Response | undefined
  try {
    budget.check()
    const plural = resourceKind === 'product' ? 'products' : 'orders'
    const url = new URL(`/admin/${plural}${'remoteId' in input ? `/${encodeURIComponent(input.remoteId)}` : ''}`, connection.baseUrl)
    url.searchParams.set('fields', fields[resourceKind])
    if ('limit' in input) {
      url.searchParams.set('limit', String(input.limit)); url.searchParams.set('offset', String(input.offset))
      if (connection.salesChannelId) url.searchParams.set('sales_channel_id', connection.salesChannelId)
    }
    response = await cancellable((options.fetch ?? fetch)(url, { method: 'GET', redirect: 'manual', signal: budget.signal, headers: { accept: 'application/json', authorization: `Basic ${Buffer.from(`${connection.secretApiKey}:`).toString('base64')}` } }), budget.signal)
    checkLength(response.headers, 2 * 1024 * 1024)
    const bytes = await readBytes(response.body, 2 * 1024 * 1024, budget)
    budget.check()
    if (response.status === 404 && 'remoteId' in input) return null
    if (response.status === 429 || response.status >= 500) throw new MedusaError('unavailable')
    if (!response.ok || response.status >= 300) throw new MedusaError('unsupported')
    // Preserve exact numeric lexemes: numeric totals never pass through Number.
    return parseExactJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  }
  catch (error) {
    void response?.body?.cancel().catch(() => {})
    budget.check()
    throw error instanceof MedusaError ? error : new MedusaError('unavailable')
  }
  finally { budget.close() }
}
/** JSON numbers become decimal lexemes; provider IDs, strings and keys are unchanged. */
export function parseExactJson(text: string): unknown {
  let result = '', inString = false, escaped = false
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!
    if (inString) { result += char; if (escaped) escaped = false; else if (char === '\\') escaped = true; else if (char === '"') inString = false; continue }
    if (char === '"') { inString = true; result += char; continue }
    if (char === '-' || /[0-9]/.test(char)) {
      const match = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(text.slice(i))
      if (!match) throw new MedusaError('unsupported')
      result += JSON.stringify(match[0]); i += match[0].length - 1
    }
    else result += char
  }
  try { return JSON.parse(result) }
  catch { throw new MedusaError('unsupported') }
}
