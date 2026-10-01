import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { createJobsBoss, parseJobsConcurrency, resolveJobsConfig, assertJobsTransactionDatabase } from '../../packages/nuxt-jobs/src/runtime/server/boss'
import { createJobsClient } from '../../packages/nuxt-jobs/src/runtime/server/lifecycle'
import { defineJob, defineJobRegistry } from '../../packages/nuxt-jobs/src/runtime/server/registry'
import { registerWorkers, sendRegisteredJobInTransaction } from '../../packages/nuxt-jobs/src/runtime/server/client'

const mocks = vi.hoisted(() => ({ constructor: vi.fn(), start: vi.fn(), stop: vi.fn(), createQueue: vi.fn(), work: vi.fn(), send: vi.fn() }))
vi.mock('pg-boss', async (original) => ({
  ...await original<typeof import('pg-boss')>(),
  PgBoss: class {
    constructor(config: unknown) { mocks.constructor(config) }
    on = vi.fn()
    start = mocks.start
    stop = mocks.stop
    createQueue = mocks.createQueue
    work = mocks.work
    send = mocks.send
  },
}))
afterEach(() => { vi.clearAllMocks(); vi.unstubAllEnvs() })
const config = { databaseUrl: 'postgres://producer:pass@db.example.test/app', schema: 'pgboss', concurrency: 4, useListenNotify: false }
const registry = defineJobRegistry(defineJob({ name: 'test.echo', payload: z.object({ message: z.string() }), handler: value => value }))

describe('canonical Jobs runtime', () => {
  it('defaults to four and accepts only bounded decimal integers', () => {
    for (const value of [undefined, '']) expect(parseJobsConcurrency(value)).toBe(4)
    for (const value of ['1', '4', '100', '004']) expect(parseJobsConcurrency(value)).toBe(Number(value))
    for (const value of ['0', '101', '-1', '+4', '4.0', '4.5', '1e1', ' 4', '4 ', 'Infinity', '0x10', 'NaN']) {
      expect(() => parseJobsConcurrency(value)).toThrow('1 to 100')
    }
    vi.stubEnv('DATABASE_URL', config.databaseUrl); vi.stubEnv('PGBOSS_DATABASE_URL', '')
    vi.stubEnv('JOBS_CONCURRENCY', '')
    expect(resolveJobsConfig().concurrency).toBe(4)
    expect(() => parseJobsConcurrency(101)).toThrow()
  })

  it('separates producers/readers, workers and explicit migration authority', () => {
    for (const role of ['producer', 'reader', 'worker', 'migration'] as const) {
      createJobsBoss(config, role)
      expect(mocks.constructor).toHaveBeenLastCalledWith(expect.objectContaining({ migrate: role === 'migration', supervise: role === 'worker', schedule: role === 'worker' }))
    }
    createJobsBoss(config, true)
    expect(mocks.constructor).toHaveBeenLastCalledWith(expect.objectContaining({ migrate: true, supervise: false, schedule: false }))
  })

  it('compares host/effective port/database while allowing different roles and URL scheme aliases', async () => {
    const boss = createJobsBoss(config)
    expect(() => assertJobsTransactionDatabase(boss, 'postgresql://app:other@DB.EXAMPLE.TEST:5432/app')).not.toThrow()
    for (const url of ['postgres://app@db.example.test/other', 'postgres://app@other.example.test/app', 'postgres://app@db.example.test:5433/app', 'postgres://app@db.example.test/app?host=other']) {
      await expect(sendRegisteredJobInTransaction(boss, registry, {} as never, 'test.echo', { message: 'refused' }, url)).rejects.toThrow()
    }
    expect(mocks.send).not.toHaveBeenCalled()
  })

  it('passes native metadata and cancellation signal without deriving retry policy from the registry', async () => {
    const handler = vi.fn()
    const native = { id: 'native-id', data: { message: 'native' }, signal: new AbortController().signal, retryCount: 2, retryLimit: 7 }
    mocks.work.mockImplementationOnce(async (_name, options, callback) => {
      expect(options.includeMetadata).toBe(true)
      await callback([native])
    })
    const jobs = defineJobRegistry(defineJob({ ...registry['test.echo'], queue: { retryLimit: 1 }, handler }))
    await registerWorkers(createJobsBoss(config, 'worker'), jobs, 4)
    expect(handler).toHaveBeenCalledWith(native.data, { id: native.id, signal: native.signal, retryCount: 2, retryLimit: 7 })
  })

  it('recovers after initialization failure and drains a pending initialization exactly once', async () => {
    mocks.start.mockRejectedValueOnce(new Error('database unavailable'))
    const client = createJobsClient(registry, () => config)
    await expect(client.use()).rejects.toThrow('database unavailable')
    expect(mocks.stop).toHaveBeenCalledWith({ graceful: false })
    let started!: () => void
    mocks.start.mockImplementationOnce(() => new Promise<void>(resolve => { started = resolve }))
    const first = client.use()
    expect(client.use()).toBe(first)
    const stopping = client.stop()
    expect(client.stop()).toBe(stopping)
    started()
    await first; await stopping
    expect(mocks.stop).toHaveBeenLastCalledWith({ graceful: true, timeout: 30_000 })
    await client.use(); await client.stop()
    expect(mocks.constructor).toHaveBeenCalledTimes(3)
  })
})
