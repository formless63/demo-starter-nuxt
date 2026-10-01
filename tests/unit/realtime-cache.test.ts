// @vitest-environment node
import { execFileSync } from 'node:child_process'
import { expect, it, vi } from 'vitest'
import { createCache, closeCache } from '@repo/nuxt-cache/server'
import { closeRealtime, createRealtimeEvent, createRealtimeHub, parseRealtimeEvent } from '@repo/nuxt-realtime/server'
import { applicationRealtime, closeApplicationRealtime, publishApplicationRealtime, realtimeEvents } from '../../server/realtime/application'

it('optional app-owned Cache fanout uses one path with no duplicate local events or replay', async () => {
  const name = `realtime-cache-${crypto.randomUUID().slice(0, 8)}`
  let cache: ReturnType<typeof createCache> | undefined
  const previous = { CACHE_URL: process.env.CACHE_URL, CACHE_KEY_PREFIX: process.env.CACHE_KEY_PREFIX }
  try {
    execFileSync('docker', ['run', '-d', '--name', name, '-p', '127.0.0.1::6379', 'valkey/valkey:9.1.2-alpine', '--save', '', '--appendonly', 'no'], { stdio: 'pipe' })
    const port = execFileSync('docker', ['port', name, '6379/tcp'], { encoding: 'utf8' }).trim()
    process.env.CACHE_URL = `redis://${port}`; process.env.CACHE_KEY_PREFIX = `rt-${crypto.randomUUID()}`
    cache = createCache({ env: process.env })
    for (let i = 0; i < 50; i++) { try { await cache.checkCache(); break } catch { await new Promise(r => setTimeout(r, 100)) } }
    const remote = createRealtimeHub(), remoteReceive = vi.fn(), localReceive = vi.fn()
    const subscription = await cache.subscribe('realtime:notifications', (bytes) => {
      const value = JSON.parse(bytes.toString())
      remote.publish(value.channel, parseRealtimeEvent(value.event, realtimeEvents))
    })
    remote.subscribe(['user:fixture'], remoteReceive)
    const hub = await applicationRealtime()
    const unlisten = hub.subscribe(['user:fixture'], localReceive)
    await publishApplicationRealtime('user:fixture', createRealtimeEvent(realtimeEvents, 'notifications.created', { notificationId: crypto.randomUUID() }))
    await vi.waitFor(() => { expect(localReceive).toHaveBeenCalledTimes(1); expect(remoteReceive).toHaveBeenCalledTimes(1) })
    expect(localReceive.mock.calls[0]![0]).toEqual(remoteReceive.mock.calls[0]![0])
    unlisten(); await subscription.unsubscribe(); remote.close()
    const reconnect = vi.fn(); hub.subscribe(['user:fixture'], reconnect)
    expect(reconnect).not.toHaveBeenCalled()
  }
  finally {
    await closeApplicationRealtime(); await closeCache(); await cache?.close(); closeRealtime()
    execFileSync('docker', ['rm', '-f', name], { stdio: 'pipe' })
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) Reflect.deleteProperty(process.env, key); else process.env[key] = value }
  }
}, 30_000)
