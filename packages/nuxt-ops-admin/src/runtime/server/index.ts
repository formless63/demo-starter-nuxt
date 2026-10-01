import type { H3Event } from 'h3'

export const opsCodes = ['unavailable', 'timeout', 'not-configured', 'invalid-result', 'sample-unknown', 'bounded-window', 'capability-present'] as const
export type OpsCode = typeof opsCodes[number]
export type OpsStatus = 'ok' | 'degraded' | 'unavailable' | 'not-configured' | 'timeout'
export interface Inspection {
  status: OpsStatus
  counts?: Record<string, number>
  code?: OpsCode
  checkedAt?: string
}
export interface OpsAdapter {
  id: string
  title: string
  countNames?: readonly string[]
  isConfigured: () => boolean
  inspect: (context: { signal: AbortSignal }) => Promise<Inspection>
}
export interface OpsCard extends Inspection { id: string, title: string, checkedAt: string, durationMs?: number }
export interface OpsSummary { checkedAt: string, adapters: OpsCard[] }
export interface OpsApplication {
  resolveSession: (event: H3Event) => Promise<{ user: { id: string } } | null | undefined>
  service: ReturnType<typeof createOpsService>
  guard?: (context: { userId: string, event: H3Event }) => Promise<boolean>
  guardPolicy?: 'narrow' | 'replace'
}
const messages = {
  unauthenticated: 'Authentication required', forbidden: 'Access denied',
  configuration: 'Operations unavailable', unavailable: 'Operations unavailable', limit: 'Operations unavailable',
} as const
export class OpsError extends Error {
  constructor(readonly code: keyof typeof messages) { super(messages[code]); this.name = 'OpsError' }
  get retryable() { return this.code === 'unavailable' }
  get statusCode() { return { unauthenticated: 401, forbidden: 403, configuration: 503, unavailable: 503, limit: 413 }[this.code] }
  toJSON() { return { code: this.code, message: this.message, retryable: this.retryable } }
}
export function validOpsUserId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 128 && !/\p{Cc}/u.test(value)
}
export function parseOpsAllowlist(value = ''): Set<string> {
  if (typeof value !== 'string' || value.length > 12900) throw new OpsError('configuration')
  const entries = value.split(',').map(id => id.trim()).filter(Boolean)
  if (entries.length > 100 || entries.some(id => !validOpsUserId(id))) throw new OpsError('configuration')
  return new Set(entries)
}
export async function authorizeOps(application: OpsApplication, event: H3Event, allowlist = process.env.OPS_ADMIN_USER_IDS ?? '') {
  let session
  try { session = await application.resolveSession(event) }
  catch { throw new OpsError('unavailable') }
  if (!session?.user || !validOpsUserId(session.user.id)) throw new OpsError('unauthenticated')
  const members = parseOpsAllowlist(allowlist)
  const policy = application.guardPolicy ?? 'narrow'
  if (!['narrow', 'replace'].includes(policy)) throw new OpsError('configuration')
  if (policy === 'replace' && !application.guard) throw new OpsError('forbidden')
  if (policy === 'narrow' && !members.has(session.user.id)) throw new OpsError('forbidden')
  if (application.guard) {
    let allowed: boolean
    try { allowed = await application.guard({ userId: session.user.id, event }) === true }
    catch { throw new OpsError('unavailable') }
    if (!allowed) throw new OpsError('forbidden')
  }
}
const machine = /^[a-z][a-z0-9-]{0,63}$/u
const timestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u
function cleanResult(value: Inspection, names: readonly string[]): Inspection {
  if (!value || !['ok', 'degraded', 'unavailable', 'not-configured', 'timeout'].includes(value.status)
    || (value.code !== undefined && !opsCodes.includes(value.code))) throw new OpsError('configuration')
  const result: Inspection = { status: value.status }
  if (value.code !== undefined) result.code = value.code
  if (value.checkedAt !== undefined) {
    if (!timestamp.test(value.checkedAt) || !Number.isFinite(Date.parse(value.checkedAt)) || new Date(value.checkedAt).toISOString() !== value.checkedAt) throw new OpsError('configuration')
    result.checkedAt = value.checkedAt
  }
  if (value.counts !== undefined) {
    if (!value.counts || Object.getPrototypeOf(value.counts) !== Object.prototype || Object.keys(value.counts).length > 8) throw new OpsError('configuration')
    result.counts = {}
    for (const [key, count] of Object.entries(value.counts)) {
      if (!names.includes(key) || !Number.isSafeInteger(count) || count < 0) throw new OpsError('configuration')
      result.counts[key] = count
    }
  }
  return result
}
// One service per static application registry, shared only for pending read-only work.
// No sessions, user context or settled personalized summaries are retained.
export function createOpsService(registry: readonly OpsAdapter[]) {
  let valid = Array.isArray(registry) && registry.length <= 16
  const ids = new Set<string>()
  let adapters: (OpsAdapter & { countNames: string[] })[] = []
  try { adapters = valid ? registry.map((adapter) => {
    const names = [...(adapter.countNames ?? [])]
    if (!machine.test(adapter.id) || ids.has(adapter.id) || typeof adapter.title !== 'string' || !adapter.title.trim()
      || adapter.title.length > 80 || /[<>]|\p{Cc}/u.test(adapter.title)
      || typeof adapter.isConfigured !== 'function' || typeof adapter.inspect !== 'function'
      || names.length > 8 || new Set(names).size !== names.length || names.some(name => !machine.test(name))) valid = false
    ids.add(adapter.id)
    return { ...adapter, countNames: names }
  }) : [] }
  catch { valid = false; adapters = [] }
  const pending = new Map<string, Promise<Inspection>>()
  let active = 0
  const capacity = new Set<() => void>()
  async function acquire(signal: AbortSignal) {
    while (active >= 3) {
      if (signal.aborted) throw new OpsError('unavailable')
      await new Promise<void>((resolve) => {
        const wake = () => { capacity.delete(wake); signal.removeEventListener('abort', wake); resolve() }
        capacity.add(wake); signal.addEventListener('abort', wake, { once: true })
        if (signal.aborted) wake()
      })
    }
    signal.throwIfAborted()
    active++
  }
  function inspect(adapter: typeof adapters[number], signal: AbortSignal) {
    const existing = pending.get(adapter.id)
    if (existing) return existing
    const work = (async () => {
      await acquire(signal)
      try { return cleanResult(await adapter.inspect({ signal }), adapter.countNames) }
      finally { active--; for (const wake of [...capacity]) wake() }
    })().catch((): Inspection => ({ status: 'unavailable', code: 'unavailable' }))
    pending.set(adapter.id, work)
    void work.finally(() => { if (pending.get(adapter.id) === work) pending.delete(adapter.id) })
    return work
  }
  async function summary(signal?: AbortSignal): Promise<OpsSummary> {
    if (!valid) throw new OpsError('configuration')
    const total = AbortSignal.timeout(5000)
    const overall = signal ? AbortSignal.any([signal, total]) : total
    const checkedAt = new Date().toISOString()
    const cards = await Promise.all(adapters.map(async (adapter): Promise<OpsCard> => {
      const start = performance.now()
      const card = { id: adapter.id, title: adapter.title, checkedAt }
      let configured: boolean
      try { configured = adapter.isConfigured() === true }
      catch { return { ...card, status: 'unavailable', code: 'not-configured' } }
      if (!configured) return { ...card, status: 'not-configured', code: 'not-configured' }
      const controller = new AbortController()
      const deadline = setTimeout(() => controller.abort(), 3000)
      const scoped = AbortSignal.any([overall, controller.signal])
      try {
        if (scoped.aborted) return { ...card, status: 'timeout', code: 'timeout' }
        const result = await new Promise<Inspection>((resolve) => {
          const abort = () => resolve({ status: 'timeout', code: 'timeout' })
          scoped.addEventListener('abort', abort, { once: true })
          void inspect(adapter, scoped).then((result) => { scoped.removeEventListener('abort', abort); resolve(result) })
          if (scoped.aborted) abort()
        })
        return { ...card, ...result, durationMs: Math.max(0, Math.round(performance.now() - start)) }
      }
      finally { clearTimeout(deadline) }
    }))
    const result = { checkedAt, adapters: cards }
    if (Buffer.byteLength(JSON.stringify(result), 'utf8') > 65536) throw new OpsError('limit')
    return result
  }
  return { summary }
}
