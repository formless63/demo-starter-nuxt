import { spawnSync } from 'node:child_process'
import { createServer, type ServerResponse } from 'node:http'
import type { Browser } from '@playwright/test'

/** Synthetic fixture network events only; omit labels, addresses and container identities. */
export function reportFixtureNetworkEvents(project: string, since: number) {
  const command = process.env.STORAGE_DOCKER_SUDO === 'true' ? 'sudo' : 'docker'
  const prefix = command === 'sudo' ? ['-n', 'docker'] : []
  const result = spawnSync(command, [...prefix, 'events', '--since', String(Math.floor(since / 1000)), '--until', String(Math.ceil(Date.now() / 1000)), '--filter', 'type=network', '--filter', `network=${project}_default`, '--format', '{{json .}}'], { encoding: 'utf8', timeout: 10_000, maxBuffer: 262144 })
  if (result.status !== 0) { console.info('[network-diagnostics] unavailable'); return }
  const allowed = new Set(['create', 'connect', 'disconnect', 'destroy'])
  const events: Array<{ action: string, epochMs: number }> = []
  for (const line of result.stdout.split('\n').filter(Boolean).slice(-80)) {
    try {
      const item = JSON.parse(line) as { Type?: string, Action?: string, time?: number, timeNano?: number }
      if (item.Type === 'network' && allowed.has(item.Action ?? '')) events.push({ action: item.Action!, epochMs: item.timeNano ? Math.floor(item.timeNano / 1e6) : (item.time ?? 0) * 1000 })
    }
    catch { /* Never print raw external output. */ }
  }
  console.info(`[network-diagnostics] ${JSON.stringify({ since, events })}`)
}


/** Keep a small HTTP/1 module graph pending over the existing Docker startup. */
export async function startFixtureNetworkProbe(browser: Browser) {
  const started = Date.now()
  const failures: Array<{ epochMs: number, code: string }> = []
  const held: ServerResponse[] = []
  let requested = 0
  let requestedCount = 0
  let releasedAt = 0
  let signalRequested: () => void = () => {}
  const moduleRequested = new Promise<void>(resolve => { signalRequested = resolve })
  const server = createServer((request, response) => {
    if (/^\/hold\/[0-7]\.js$/.test(request.url ?? '')) {
      requested ||= Date.now()
      response.setHeader('content-type', 'text/javascript')
      if (releasedAt) response.end('export const marker = true')
      else held.push(response)
      if (held.length >= 6) signalRequested()
    }
    else {
      response.setHeader('content-type', 'text/html')
      const imports = Array.from({ length: 8 }, (_, index) => `import '/hold/${index}.js';`).join('')
      response.end(`<!doctype html><html><body><script type="module">${imports}document.documentElement.dataset.probeLoaded='true'</script></body></html>`)
    }
  })
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Diagnostic loopback port unavailable')
  const context = await browser.newContext()
  const page = await context.newPage()
  const isProbe = (url: string) => /^\/hold\/[0-7]\.js$/.test(new URL(url).pathname)
  page.on('request', request => { if (isProbe(request.url())) requestedCount++ })
  page.on('requestfailed', request => {
    if (!isProbe(request.url())) return
    const code = /net::ERR_[A-Z_]+/.exec(request.failure()?.errorText ?? '')?.[0] ?? 'request_failed'
    failures.push({ epochMs: Date.now(), code })
  })
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await page.goto(`http://127.0.0.1:${address.port}`, { waitUntil: 'commit', timeout: 5000 })
    await Promise.race([moduleRequested, new Promise<void>(resolve => { timer = setTimeout(resolve, 5000) })]).finally(() => clearTimeout(timer))
  }
  catch (error) { await context.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); throw error }
  const acceptedBeforeStartup = held.length
  const requestedBeforeStartup = requestedCount
  return async () => {
    const released = Date.now()
    releasedAt = released
    for (const response of held) if (!response.destroyed) response.end('export const marker = true')
    let loaded = false
    try { await page.waitForFunction(() => document.documentElement.dataset.probeLoaded === 'true', { }, { timeout: 3000 }); loaded = true }
    catch { /* Diagnostic outcome only; application assertions remain unchanged. */ }
    const report = { browserVersion: browser.version(), started, requested, requestedBeforeStartup, acceptedBeforeStartup, released, captured: Date.now(), loaded, failures: failures.slice(0, 10) }
    console.info(`[network-probe] ${JSON.stringify(report)}`)
    await context.close()
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
}
