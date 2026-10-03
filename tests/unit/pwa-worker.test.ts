// @vitest-environment node
import { createHash, webcrypto } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { beforeAll, describe, expect, it } from 'vitest'
import { build } from 'vite'
import { publicAssets } from '../../packages/nuxt-pwa-offline/src/runtime/constants'

const runtime = resolve('packages/nuxt-pwa-offline/src/runtime')
const manifest = await Promise.all(publicAssets.map(async (url) => {
  const bytes = await readFile(resolve(runtime, 'public', url))
  return { url, revision: createHash('sha256').update(bytes).digest('hex'), integrity: `sha256-${createHash('sha256').update(bytes).digest('base64')}` }
}))
let bundled = ''

beforeAll(async () => {
  const entry = resolve(runtime, 'pwa-worker-unit.ts')
  const source = await readFile(resolve(runtime, 'worker-template.txt'), 'utf8')
  const result = await build({
    configFile: false,
    publicDir: false,
    logLevel: 'silent',
    plugins: [{ name: 'pwa-worker-template-test', resolveId: id => id === entry ? entry : undefined, load: id => id === entry ? source : undefined }],
    build: { write: false, minify: false, lib: { entry, formats: ['iife'], name: 'PwaWorkerUnit' } },
    define: { 'self.__WB_MANIFEST': JSON.stringify(manifest) },
  })
  const output = Array.isArray(result) ? result[0] : result
  if (!output || !('output' in output)) throw new Error('Worker bundle missing')
  const chunk = output.output.find(item => item.type === 'chunk')
  if (!chunk || chunk.type !== 'chunk') throw new Error('Worker JavaScript chunk missing')
  bundled = chunk.code
}, 20000)

class BrowserRequest {
  url: string
  credentials: string
  redirect: string
  integrity: string
  constructor(url: string, options: RequestInit = {}) {
    this.url = url
    this.credentials = options.credentials ?? 'same-origin'
    this.redirect = options.redirect ?? 'follow'
    this.integrity = options.integrity ?? ''
  }
}

function clone(response: Response) {
  const copy = response.clone()
  Object.defineProperty(copy, 'url', { value: response.url })
  Object.defineProperty(copy, 'type', { value: 'basic' })
  return copy
}

function fixture() {
  const entries = new Map<string, Map<string, Response>>()
  const requests: BrowserRequest[] = []
  const writes: string[] = []
  const deletions: string[] = []
  let denyPng = false
  let unregistered = false
  const caches = {
    has: async (name: string) => entries.has(name),
    keys: async () => [...entries.keys()],
    delete: async (name: string) => { deletions.push(name); return entries.delete(name) },
    open: async (name: string) => {
      let values = entries.get(name)
      if (!values) { values = new Map(); entries.set(name, values) }
      const cache = values
      return {
        keys: async () => [...cache.keys()].map(url => new Request(url)),
        match: async (url: string) => { const value = cache.get(url); return value ? clone(value) : undefined },
        put: async (url: string, response: Response) => { writes.push(url); cache.set(url, clone(response)) },
      }
    },
  }
  function worker(version: string, retired = false) {
    const events = new Map<string, (event: unknown) => void>()
    runInNewContext(bundled, {
      URL, Request: BrowserRequest, Response, AbortController, Uint8Array, btoa, crypto: webcrypto, setTimeout, clearTimeout, caches,
      __PWA_OFFLINE_VERSION__: version,
      __PWA_OFFLINE_CONFIG__: { base: '/', publicOfflinePaths: [], retired },
      self: {
        registration: { scope: 'https://fixture.test/', unregister: async () => { unregistered = true } },
        addEventListener: (name: string, callback: (event: unknown) => void) => events.set(name, callback),
      },
      fetch: async (request: BrowserRequest) => {
        requests.push(request)
        expect(request.credentials).toBe('omit')
        expect(request.redirect).toBe('error')
        expect(request.integrity).toMatch(/^sha256-/u)
        const url = new URL(request.url)
        const response = new Response(await readFile(resolve(runtime, 'public', url.pathname.slice(1))), {
          headers: { 'content-type': url.pathname.endsWith('.html') ? 'text/html' : 'image/png', 'cache-control': denyPng && url.pathname.endsWith('.png') ? 'private' : 'public, immutable' },
        })
        Object.defineProperty(response, 'url', { value: request.url })
        Object.defineProperty(response, 'type', { value: 'basic' })
        return response
      },
    })
    return async (name: string) => {
      let settled: Promise<unknown> = Promise.resolve()
      events.get(name)?.({ waitUntil: (promise: Promise<unknown>) => { settled = promise } })
      await settled
    }
  }
  return { entries, requests, writes, deletions, worker, denyPng: () => { denyPng = true }, isUnregistered: () => unregistered }
}

describe('bundled native PWA worker cache lifecycle', () => {
  it('reuses same-version bytes read-only and preserves old cache on late new-install failure', async () => {
    const env = fixture()
    await env.worker('one')('install')
    expect(env.entries.size).toBe(1)
    const cacheName = [...env.entries.keys()][0]!
    expect(env.entries.get(cacheName)?.size).toBe(3)
    const bytes = await Promise.all([...env.entries.get(cacheName)!.values()].map(response => response.clone().text()))
    env.denyPng()
    const fetchCount = env.requests.length
    const writeCount = env.writes.length
    await env.worker('one')('install')
    expect(env.requests.length).toBe(fetchCount)
    expect(env.writes.length).toBe(writeCount)
    expect(env.deletions).toEqual([])
    await expect(env.worker('two')('install')).rejects.toThrow('Unsafe public asset response')
    expect([...env.entries.keys()]).toEqual([cacheName])
    expect(await Promise.all([...env.entries.get(cacheName)!.values()].map(response => response.clone().text()))).toEqual(bytes)
    expect(env.deletions).toHaveLength(1)
    expect(env.deletions[0]).not.toBe(cacheName)
  })

  it('rejects incomplete or tampered existing caches without deleting or changing them', async () => {
    const env = fixture()
    await env.worker('one')('install')
    const cacheName = [...env.entries.keys()][0]!
    const cache = env.entries.get(cacheName)!
    const offline = 'https://fixture.test/pwa-offline/offline.html'
    const original = cache.get(offline)!
    cache.delete(offline)
    const writes = env.writes.length
    await expect(env.worker('one')('install')).rejects.toThrow('Existing owned cache is incomplete')
    expect(env.entries.get(cacheName)).toBe(cache)
    expect(cache.size).toBe(2)
    const tampered = new Response('private surprise', { headers: original.headers })
    Object.defineProperty(tampered, 'url', { value: offline })
    Object.defineProperty(tampered, 'type', { value: 'basic' })
    cache.set(offline, tampered)
    await expect(env.worker('one')('install')).rejects.toThrow('Existing cache integrity mismatch')
    expect(await cache.get(offline)?.clone().text()).toBe('private surprise')
    expect(env.writes.length).toBe(writes)
    expect(env.deletions).toEqual([])
  })

  it('retires only caches owned by the exact scope and unregisters without forced activation', async () => {
    const env = fixture()
    await env.worker('one')('install')
    env.entries.set('unrelated-owner', new Map())
    env.entries.set('pwa-offline:v1:https://fixture.test/demo/:one', new Map())
    await env.worker('retired', true)('activate')
    expect(env.isUnregistered()).toBe(true)
    expect([...env.entries.keys()]).toEqual(['unrelated-owner', 'pwa-offline:v1:https://fixture.test/demo/:one'])
    expect(bundled).not.toMatch(/\.(skipWaiting|claim|navigate)\(/u)
  })
})
