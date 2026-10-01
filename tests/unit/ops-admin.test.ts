import { describe, expect, it } from 'vitest'
import { authorizeOps, createOpsService, parseOpsAllowlist } from '../../packages/nuxt-ops-admin/src/runtime/server'
import type { H3Event } from 'h3'
import type { OpsAdapter, OpsApplication } from '../../packages/nuxt-ops-admin/src/runtime/server'
const event = {} as H3Event
const app = (id: string | null): OpsApplication => ({ resolveSession: async () => id ? { user: { id } } : null, service: createOpsService([]) })
describe('Ops access and sanitized summary', () => {
  it('requires a human session, denies by default and preserves opaque IDs', async () => {
    await expect(authorizeOps(app(null), event, 'operator')).rejects.toMatchObject({ code: 'unauthenticated', statusCode: 401 })
    await expect(authorizeOps(app('operator'), event, '')).rejects.toMatchObject({ code: 'forbidden', statusCode: 403 })
    await authorizeOps(app('opaque:操作者'), event, 'opaque:操作者')
    await expect(authorizeOps(app('organization-owner'), event, 'operator')).rejects.toMatchObject({ code: 'forbidden' })
    expect([...parseOpsAllowlist(' a, ,a,b ')]).toEqual(['a', 'b'])
    expect(parseOpsAllowlist('x'.repeat(128)).size).toBe(1)
    expect(parseOpsAllowlist(Array(101).fill('x'.repeat(128)).join(',')).size).toBe(1)
    expect(parseOpsAllowlist(Array.from({ length: 100 }, (_, i) => `id${i}`).join(',')).size).toBe(100)
    for (const value of ['x'.repeat(129), 'unsafe\nvalue', 'unsafe\u0085value', Array.from({ length: 101 }, (_, i) => `id${i}`).join(',')]) expect(() => parseOpsAllowlist(value)).toThrow('Operations unavailable')
  })
  it('never widens access by OR and requires an explicit guard for replacement', async () => {
    await expect(authorizeOps({ ...app('outsider'), guard: async () => true }, event, 'operator')).rejects.toMatchObject({ code: 'forbidden' })
    await expect(authorizeOps({ ...app('operator'), guard: async () => false }, event, 'operator')).rejects.toMatchObject({ code: 'forbidden' })
    await expect(authorizeOps({ ...app('operator'), guardPolicy: 'replace' }, event, '')).rejects.toMatchObject({ code: 'forbidden' })
    await authorizeOps({ ...app('operator'), guardPolicy: 'replace', guard: async () => true }, event, '')
    await expect(authorizeOps({ ...app('operator'), guard: async () => { throw new Error('private cause') } }, event, 'operator')).rejects.toMatchObject({ message: 'Operations unavailable' })
  })
  it('does not inspect during setup or when unconfigured and drops all provider extras', async () => {
    let calls = 0
    const service = createOpsService([
      { id: 'disabled', title: 'Disabled', isConfigured: () => false, inspect: async () => { calls++; throw new Error('private') } },
      { id: 'healthy', title: 'Healthy', countNames: ['queued'], isConfigured: () => true, inspect: async () => ({ status: 'ok', counts: { queued: 3 }, secret: 'private credential' }) },
      { id: 'failed', title: 'Failed', isConfigured: () => true, inspect: async () => { throw new Error('postgres://private') } },
    ])
    expect(calls).toBe(0)
    const summary = await service.summary()
    expect(calls).toBe(0)
    expect(summary.adapters.map(card => card.status)).toEqual(['not-configured', 'ok', 'unavailable'])
    expect(JSON.stringify(summary)).not.toMatch(/private|postgres|credential|secret/u)
    expect(summary.adapters[1]?.counts).toEqual({ queued: 3 })
  })
  it('fails invalid registry locally and rejects unregistered unsafe counts', async () => {
    const adapter: OpsAdapter = { id: 'safe', title: 'Safe', isConfigured: () => true, inspect: async () => ({ status: 'ok', counts: { secret: -1 } }) }
    for (const registry of [[adapter, adapter], [{ ...adapter, id: 'bad id' }], [{ ...adapter, title: '<private>' }], Array.from({ length: 17 }, (_, i) => ({ ...adapter, id: `item-${i}` })), [null] as unknown as OpsAdapter[]]) {
      const service = createOpsService(registry)
      await expect(service.summary()).rejects.toMatchObject({ code: 'configuration' })
    }
    expect((await createOpsService([adapter]).summary()).adapters[0]?.status).toBe('unavailable')
  })
  it('caps actual concurrency, aborts supported work and isolates healthy siblings', async () => {
    let active = 0, peak = 0
    const adapters = Array.from({ length: 8 }, (_, i): OpsAdapter => ({ id: `item-${i}`, title: 'Item', isConfigured: () => true, inspect: async () => {
      active++; peak = Math.max(peak, active)
      await new Promise(resolve => setTimeout(resolve, 10)); active--
      return { status: 'ok' }
    } }))
    const service = createOpsService(adapters)
    await Promise.all([service.summary(), service.summary(), service.summary()])
    expect(peak).toBe(3)
    let aborted = false
    const slow = createOpsService([{ id: 'slow', title: 'Slow', isConfigured: () => true, inspect: ({ signal }) => new Promise(resolve => signal.addEventListener('abort', () => { aborted = true; resolve({ status: 'unavailable' }) }, { once: true })) }, adapters[0]!])
    const result = await slow.summary()
    expect(aborted).toBe(true)
    expect(result.adapters.map(card => card.status)).toEqual(['timeout', 'ok'])
  }, 10000)
  it('retains one hung noncancellable call across repeated refreshes', async () => {
    let calls = 0
    let finish!: (value: { status: 'ok' }) => void
    const service = createOpsService([{ id: 'hung', title: 'Hung', isConfigured: () => true, inspect: () => { calls++; return new Promise(resolve => { finish = resolve }) } }])
    const first = await service.summary()
    const second = await service.summary()
    expect(first.adapters[0]?.status).toBe('timeout'); expect(second.adapters[0]?.status).toBe('timeout'); expect(calls).toBe(1)
    finish({ status: 'ok' })
  }, 10000)
  it('retains closed size bounds even for all maximum-width cards', async () => {
    const names = Array.from({ length: 8 }, (_, i) => `n${i}${'a'.repeat(60)}`)
    const service = createOpsService(Array.from({ length: 16 }, (_, i) => ({ id: `i${i}${'a'.repeat(60)}`, title: 't'.repeat(80), countNames: names, isConfigured: () => true, inspect: async () => ({ status: 'ok' as const, counts: Object.fromEntries(names.map(name => [name, Number.MAX_SAFE_INTEGER])) }) })))
    expect(Buffer.byteLength(JSON.stringify(await service.summary()))).toBeLessThanOrEqual(65536)
  })
})
