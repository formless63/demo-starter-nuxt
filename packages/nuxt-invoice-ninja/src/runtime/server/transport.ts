import { createHash, timingSafeEqual } from 'node:crypto'
import { isIP } from 'node:net'
import { InvoiceNinjaError, InvoiceNinjaRejection, safeError } from './errors'
import { parse, opaqueId, hasControls } from './validation'
export interface Connection { baseUrl: string, apiToken: string, webhookSecret?: string, previousWebhookSecret?: string }
export function resolveEnvironmentConnection(): Connection {
  const baseUrl = process.env.INVOICE_NINJA_BASE_URL, apiToken = process.env.INVOICE_NINJA_API_TOKEN
  if (!baseUrl || !apiToken) throw new InvoiceNinjaError('unconfigured')
  return { baseUrl, apiToken, webhookSecret: process.env.INVOICE_NINJA_WEBHOOK_SECRET, previousWebhookSecret: process.env.INVOICE_NINJA_WEBHOOK_SECRET_PREVIOUS }
}
export function validateConnection(connection: Connection, allowLocal = ['development', 'test'].includes(process.env.NODE_ENV ?? '')) {
  try {
    const url = new URL(connection.baseUrl)
    // URL normalization can convert nonliteral numeric hostnames; inspect the original authority too.
    const originalHost = /^[a-z]+:\/\/([^/?#]+)/i.exec(connection.baseUrl)?.[1]?.replace(/:\d+$/, '')
    const literalLoopback = originalHost === '[::1]' || (typeof originalHost === 'string' && isIP(originalHost) === 4 && originalHost.startsWith('127.'))
    if (url.username || url.password || url.hash || url.search || (url.protocol !== 'https:' && !(allowLocal && url.protocol === 'http:' && literalLoopback))) throw new Error()
    if (!connection.apiToken || Buffer.byteLength(connection.apiToken) > 8192 || hasControls(connection.apiToken)) throw new Error()
    return url
  }
  catch { throw new InvoiceNinjaError('unconfigured') }
}
export function operationSignal(signal: AbortSignal | undefined, milliseconds: number) {
  return AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(milliseconds)])
}
export function checkSignal(signal?: AbortSignal) {
  if (signal?.aborted) throw new InvoiceNinjaError(signal.reason?.name === 'TimeoutError' ? 'deadline_exceeded' : 'cancelled')
}
export async function awaitWithSignal<T>(signal: AbortSignal, action: () => Promise<T>): Promise<T> {
  checkSignal(signal)
  let abort: (() => void) | undefined
  const cancelled = new Promise<never>((_, reject) => { abort = () => { try { checkSignal(signal) } catch (error) { reject(error) } }; signal.addEventListener('abort', abort, { once: true }) })
  try { return await Promise.race([action(), cancelled]) } finally { if (abort) signal.removeEventListener('abort', abort) }
}
export async function readBytes(stream: ReadableStream<Uint8Array> | null, maximum: number, signal: AbortSignal) {
  if (!stream) return Buffer.alloc(0)
  const reader = stream.getReader(), chunks: Uint8Array[] = []; let size = 0
  const cancel = () => { void reader.cancel().catch(() => {}) }
  signal.addEventListener('abort', cancel, { once: true })
  try {
    checkSignal(signal)
    while (true) {
      const part = await reader.read(); checkSignal(signal)
      if (part.done) break
      size += part.value.byteLength
      if (size > maximum) { cancel(); throw new InvoiceNinjaError('limit_exceeded') }
      chunks.push(part.value)
    }
    return Buffer.concat(chunks, size)
  }
  finally { if (signal.aborted) cancel(); signal.removeEventListener('abort', cancel); reader.releaseLock() }
}
/** Preserve JSON numeric lexemes before any binary floating point conversion. */
export function parseExactJSON(bytes: Uint8Array): unknown {
  try {
    const s = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    let out = '', quoted = false, escape = false
    for (let i = 0; i < s.length; i++) {
      const c = s[i]!
      if (quoted) { out += c; if (escape) escape = false; else if (c === '\\') escape = true; else if (c === '"') quoted = false; continue }
      if (c === '"') { quoted = true; out += c; continue }
      if (c === '-' || /\d/.test(c)) {
        const token = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(s.slice(i))?.[0]
        if (!token) throw new Error()
        out += JSON.stringify(token); i += token.length - 1
      }
      else out += c
    }
    return JSON.parse(out)
  }
  catch { throw new InvoiceNinjaError('unavailable') }
}
export async function providerRequest(connection: Connection, kind: 'client' | 'invoice', remoteId: string | null, body?: object, callerSignal?: AbortSignal, fetcher: typeof fetch = fetch) {
  const base = validateConnection(connection), signal = operationSignal(callerSignal, 15_000)
  const path = `/api/v1/${kind === 'client' ? 'clients' : 'invoices'}${remoteId === null ? '' : `/${encodeURIComponent(parse(opaqueId, remoteId))}`}`
  const data = body ? JSON.stringify(body) : undefined
  if (data && Buffer.byteLength(data) > 256 * 1024) throw new InvoiceNinjaError('limit_exceeded')
  try {
    checkSignal(signal)
    const response = await fetcher(new URL(`${base.pathname.replace(/\/$/, '')}${path}`, base.origin), {
      method: body ? 'POST' : 'GET', redirect: 'error', signal,
      headers: { 'X-API-TOKEN': connection.apiToken, 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: data,
    })
    const bytes = await readBytes(response.body, 2 * 1024 * 1024, signal)
    if (response.status === 404 && !body) return null
    if (!response.ok && body && [400, 401, 403, 404, 405, 409, 422].includes(response.status)) throw new InvoiceNinjaRejection(response.status === 422 ? 'unsupported' : 'forbidden', false)
    if (!response.ok) throw new InvoiceNinjaError(response.status === 422 ? 'unsupported' : response.status >= 500 || response.status === 429 ? 'unavailable' : 'forbidden', !body && (response.status >= 500 || response.status === 429))
    return parseExactJSON(bytes)
  }
  catch (error) { checkSignal(signal); if (error instanceof InvoiceNinjaRejection) throw error; throw safeError(error, Boolean(body)) }
}
function validSecret(s: string | undefined) { return s !== undefined && Buffer.byteLength(s) >= 32 && Buffer.byteLength(s) <= 256 && !hasControls(s) }
export function verifyWebhookSecret(header: string | undefined, connection: Connection) {
  if (!validSecret(connection.webhookSecret) || (connection.previousWebhookSecret !== undefined && !validSecret(connection.previousWebhookSecret))) throw new InvoiceNinjaError('unconfigured')
  if (header && Buffer.byteLength(header) > 8192) throw new InvoiceNinjaError('limit_exceeded')
  const digest = (s: string) => createHash('sha256').update(s).digest()
  const received = digest(header ?? '')
  const current = timingSafeEqual(received, digest(connection.webhookSecret!))
  const previous = timingSafeEqual(received, digest(connection.previousWebhookSecret ?? '')) && connection.previousWebhookSecret !== undefined
  if (!header || !(current || previous)) throw new InvoiceNinjaError('invalid_input')
}
