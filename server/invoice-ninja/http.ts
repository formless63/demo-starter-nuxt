import { Readable } from 'node:stream'
import type { H3Event } from 'h3'
import { getQuery, setHeader, setResponseStatus } from 'h3'
import { InvoiceNinjaError, safeError, readBytes } from '@repo/nuxt-invoice-ninja/server'
import type { TrustedContext } from '@repo/nuxt-invoice-ninja/server'
import { requireUser } from '../utils/session'
export function requestSignal(event: H3Event) {
  const controller = new AbortController()
  const abort = () => controller.abort()
  const close = () => { if (!event.node.res.writableEnded) abort() }
  event.node.req.once('aborted', abort); event.node.res.once('close', close)
  event.node.res.once('finish', () => { event.node.req.removeListener('aborted', abort); event.node.res.removeListener('close', close) })
  return controller.signal
}
export async function invoiceContext(event: H3Event): Promise<TrustedContext> {
  try { const user = await requireUser(event); return { actorUserId: user.id, scope: { kind: 'user', id: user.id }, signal: requestSignal(event) } }
  catch { throw new InvoiceNinjaError('unauthenticated') }
}
export async function invoiceBody(event: H3Event) {
  const signal = AbortSignal.any([requestSignal(event), AbortSignal.timeout(5000)])
  const bytes = await readBytes(Readable.toWeb(event.node.req) as ReadableStream<Uint8Array>, 256 * 1024, signal)
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown } catch { throw new InvoiceNinjaError('invalid_input') }
}
export function invoiceQuery(event: H3Event) {
  const query = getQuery(event)
  if (Object.keys(query).some(k => !['limit', 'cursor'].includes(k)) || (query.limit !== undefined && (typeof query.limit !== 'string' || !/^[1-9]\d{0,2}$/.test(query.limit))) || (query.cursor !== undefined && typeof query.cursor !== 'string')) throw new InvoiceNinjaError('invalid_input')
  return { ...(query.limit !== undefined ? { limit: Number(query.limit) } : {}), ...(query.cursor !== undefined ? { cursor: query.cursor } : {}) }
}
export async function invoiceHttp(event: H3Event, action: () => Promise<unknown>) {
  setHeader(event, 'Cache-Control', 'no-store')
  try { const value = await action(); if (Buffer.byteLength(JSON.stringify(value)) > 256 * 1024) throw new InvoiceNinjaError('limit_exceeded'); return value }
  catch (error) { const safe = safeError(error); setResponseStatus(event, safe.statusCode); return { error: safe.toJSON() } }
}
