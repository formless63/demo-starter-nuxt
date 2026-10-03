import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { readFile } from 'node:fs/promises'
import { createServer, request as httpRequest, type Server } from 'node:http'
import { join } from 'node:path'
import { chromium, type BrowserContext, type Worker } from '@playwright/test'
import { waitForPwa } from './wait'

export const statePath = '.fixture/pwa-state.json'
export const stateDirectory = '.fixture/pwa-browser-state'
export const assetPaths = ['pwa-offline/offline.html', 'pwa-offline/icon-192-c37f42e5e1e76c61.png', 'pwa-offline/icon-512-497feff41eb4e6db.png']
export const workerFilename = 'pwa-offline-sw.js'
export const sha256 = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex')
export const outputFile = (name: string) => join(process.cwd(), '.output/public', name)
export const launchOptions = () => ({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {}),
})

export interface LifecycleState {
  port: number
  origin: string
  profile: string
  tombstoneHash: string
  liveWorkerHash: string
  cacheNames: string[]
}

export interface Trace {
  path: string
  status: number
  type: string
  cache: string
  cookie: boolean
  authorization: boolean
  destination: string
}

async function listen(server: Server, port = 0) {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => { server.removeListener('error', reject); resolve() })
  })
  const address = server.address()
  assert(address && typeof address !== 'string')
  return address.port
}

async function closeServer(server: Server) {
  server.closeIdleConnections()
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
}

export async function runCommand(command: string[], env = process.env) {
  const child = spawn(command[0]!, command.slice(1), { stdio: 'inherit', env })
  return await new Promise<number>((resolve, reject) => {
    child.once('error', reject)
    child.once('close', code => resolve(code ?? 1))
  })
}

export async function buildConsumer() {
  assert.equal(await runCommand(['bun', 'run', 'build'], { ...process.env, NODE_ENV: 'production' }), 0, 'Native Nuxt production rebuild succeeds')
}

// All ordinary responses come from actual portable Nitro output. A transparent,
// fixture-only HTTP proxy injects hostile deployment responses and records real
// browser request headers without replacing Nuxt routing or static serving.
export async function startConsumer(port = 0) {
  const reservation = createServer()
  const backendPort = await listen(reservation)
  await closeServer(reservation)
  const child = spawn('node', ['.output/server/index.mjs'], {
    env: { ...process.env, NITRO_HOST: '127.0.0.1', HOST: '127.0.0.1', NITRO_PORT: String(backendPort), PORT: String(backendPort) },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let logs = ''
  let startupError: Error | undefined
  child.stdout.on('data', chunk => { logs += String(chunk) })
  child.stderr.on('data', chunk => { logs += String(chunk) })
  const exited = new Promise<void>(resolve => {
    child.once('error', error => { startupError = error; resolve() })
    child.once('close', () => resolve())
  })
  try {
    await waitForPwa(async () => {
      if (startupError) throw startupError
      if (child.exitCode !== null) throw new Error(`Nitro exited ${child.exitCode}`)
      try { return (await fetch(`http://127.0.0.1:${backendPort}`, { signal: AbortSignal.timeout(1000) })).status < 500 }
      catch { return false }
    }, 'Portable Nitro production server boots without external services')
  }
  catch (error) { child.kill(); await exited; console.error(logs); throw error }
  const options = { mode: '', errorPage: false, workerSuffix: '' }
  const trace: Trace[] = []
  const proxy = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://fixture').pathname
    const asset = path.includes('/pwa-offline/')
    if (options.errorPage && path.endsWith('/pwa-test')) {
      response.writeHead(503, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
      response.end('Real server failure')
      return
    }
    const forwarded = { ...request.headers }
    if (options.workerSuffix && path.endsWith(`/${workerFilename}`)) { delete forwarded['if-none-match']; delete forwarded['if-modified-since'] }
    const upstream = httpRequest({ hostname: '127.0.0.1', port: backendPort, path: request.url, method: request.method, headers: forwarded }, (source) => {
      const chunks: Buffer[] = []
      source.on('data', chunk => chunks.push(Buffer.from(chunk)))
      source.on('end', () => {
        const headers = { ...source.headers }
        let bytes = Buffer.concat(chunks)
        if (options.workerSuffix && path.endsWith(`/${workerFilename}`)) {
          bytes = Buffer.concat([bytes, Buffer.from(options.workerSuffix)])
          delete headers.etag
          delete headers['last-modified']
        }
        if (asset) {
          if (['private', 'no-store', 'no-cache'].includes(options.mode)) headers['cache-control'] = options.mode
          if (options.mode.startsWith('cache:')) headers['cache-control'] = options.mode.slice(6)
          if (options.mode.startsWith('vary:')) headers.vary = options.mode.slice(5)
          if (options.mode === 'deny-png' && path.endsWith('.png')) headers['cache-control'] = 'private, no-store'
          if (options.mode === 'content-type') headers['content-type'] = 'application/json'
          if (options.mode === 'tamper' && path.endsWith('/offline.html')) bytes = Buffer.from('Unreviewed private surprise')
        }
        delete headers['transfer-encoding']
        headers['content-length'] = String(bytes.length)
        let status = source.statusCode ?? 502
        if (asset && options.mode === 'redirect') { status = 302; headers.location = '/' }
        if (asset && options.mode === 'status') status = 401
        response.writeHead(status, headers)
        response.end(bytes)
        trace.push({ path, status, type: String(headers['content-type'] ?? ''), cache: String(headers['cache-control'] ?? ''), cookie: !!request.headers.cookie, authorization: !!request.headers.authorization, destination: String(request.headers['sec-fetch-dest'] ?? '') })
      })
    })
    upstream.on('error', (error) => { response.writeHead(502); response.end(String(error)) })
    request.pipe(upstream)
  })
  let listeningPort: number
  try { listeningPort = await listen(proxy, port) }
  catch (error) { child.kill(); await exited; throw error }
  let closed = false
  return {
    origin: `http://127.0.0.1:${listeningPort}`,
    port: listeningPort,
    options,
    trace,
    async close() {
      if (closed) return
      closed = true
      await closeServer(proxy)
      child.kill('SIGTERM')
      const stopped = await Promise.race([exited.then(() => true), delay(5000, undefined, { ref: false }).then(() => false)])
      if (!stopped) { child.kill('SIGKILL'); await exited }
      if (child.exitCode && child.exitCode !== 143) console.info(logs)
    },
  }
}

export function observe(context: BrowserContext, label: string) {
  context.on('console', message => { if (message.type() === 'error') console.info(`[pwa ${label} console] ${message.text()}`) })
  context.on('weberror', error => console.info(`[pwa ${label} page error] ${error.error().message}`))
}

export async function closeTabs(context: BrowserContext) {
  for (const page of context.pages()) await page.close()
}

export async function naturallyActivate(context: BrowserContext, worker: Worker) {
  await closeTabs(context)
  // Evaluate awaits the actual Promise; never force skipWaiting, claim or reload.
  await worker.evaluate(async () => {
    const registration = (self as unknown as { registration: ServiceWorkerRegistration }).registration
    const deadline = Date.now() + 20000
    while (registration.waiting && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25))
    if (registration.waiting) throw new Error('Natural worker activation timed out')
  })
}

export async function verifyLiveHttp(origin: string, base = '/') {
  const worker = await fetch(`${origin}${base}${workerFilename}`)
  assert.equal(worker.status, 200, 'Native worker response is HTTP 200, never a fallback HTML page')
  assert.match(worker.headers.get('content-type') ?? '', /javascript/u)
  const emitted = await readFile(outputFile(workerFilename))
  const returned = Buffer.from(await worker.arrayBuffer())
  assert.deepEqual(returned, emitted, 'HTTP serves exact live worker output')
  assert(!emitted.includes('FIXTURE_STALE_TOMBSTONE'), 'A copied tombstone must never masquerade as the live worker')
  assert(!emitted.includes('__WB_MANIFEST'), 'Native injectManifest completed')
  for (const path of assetPaths) {
    assert(emitted.includes(path), `Live worker includes exact allowlisted asset ${path}`)
    const response = await fetch(`${origin}${base}${path}`)
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('content-type')?.split(';')[0], path.endsWith('.png') ? 'image/png' : 'text/html')
    assert.equal(response.headers.get('cache-control'), path.endsWith('.png') ? 'public, max-age=31536000, immutable' : 'public, max-age=300')
    const bytes = Buffer.from(await response.arrayBuffer())
    assert.deepEqual(bytes, await readFile(outputFile(path)), 'HTTP asset byte identity')
    console.info('[pwa HTTP asset]', JSON.stringify({ path: `${base}${path}`, status: response.status, contentType: response.headers.get('content-type'), cacheControl: response.headers.get('cache-control'), sha256: sha256(bytes) }))
  }
  const manifestResponse = await fetch(`${origin}${base}manifest.webmanifest`)
  assert.equal(manifestResponse.status, 200)
  const manifest = await manifestResponse.json() as { id: string, scope: string, start_url: string }
  assert.equal(manifest.id, base)
  assert.equal(manifest.scope, base)
  assert.equal(manifest.start_url, base)
  const ssr = await (await fetch(`${origin}${base}pwa-test`)).text()
  assert.match(ssr, new RegExp(`<link(?=[^>]*rel="manifest")(?=[^>]*href="${base}manifest\\.webmanifest")[^>]*>`), 'Manifest link is present in SSR HTML')
  assert.match(ssr, /<button(?=[^>]*disabled)[^>]*>Enable offline notice<\/button>/u, 'Browser-dependent controls are disabled in SSR')
  assert.match(ssr, /charset=["']?utf-8/iu)
  console.info('[pwa HTTP worker]', JSON.stringify({ base, status: worker.status, contentType: worker.headers.get('content-type'), sha256: sha256(emitted) }))
  return emitted
}

export { chromium }
