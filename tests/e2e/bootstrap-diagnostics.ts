import type { Page, Request } from '@playwright/test'

/** Bounded synthetic startup evidence. Never log payloads, headers or arbitrary URL values. */
export function bootstrapDiagnostics(page: Page) {
  const started = Date.now()
  const pending = new Map<Request, { file: string, hash: string, at: number }>()
  const finished: Array<{ file: string, hash: string, at: number, ended: number }> = []
  const failures: Array<{ file: string, hash: string, code: string, at: number }> = []
  const source = (request: Request) => {
    const url = new URL(request.url())
    if (request.resourceType() !== 'script' && !url.pathname.includes('/_nuxt/')) return null
    const hash = url.searchParams.get('v') ?? ''
    return { file: url.pathname.split('/').at(-1)!.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0,160), hash: /^[a-f0-9]{1,16}$/i.test(hash) ? hash : '', at: Date.now() - started }
  }
  page.on('request', request => { const item = source(request); if (item && pending.size < 200) pending.set(request, item) })
  page.on('requestfinished', request => {
    const item = pending.get(request)
    if (item) { finished.push({ ...item, ended: Date.now() - started }); if (finished.length > 80) finished.shift() }
    pending.delete(request)
  })
  page.on('requestfailed', request => {
    const item = source(request)
    const error = request.failure()?.errorText ?? ''
    if (item && failures.length < 80) failures.push({ ...item, code: /net::ERR_[A-Z_]+/.exec(error)?.[0] ?? 'request_failed' })
    pending.delete(request)
  })
  page.on('response', response => {
    const item = source(response.request())
    if (item && response.status() >= 400 && failures.length < 80) failures.push({ ...item, code: `http_${response.status()}` })
  })
  return async () => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const snapshot = await Promise.race([
      page.evaluate(() => ({ ready: document.readyState, hydrated: document.documentElement.dataset.appHydrated ?? null, stages: document.documentElement.dataset.nuxtE2eStages ?? null, at: Math.round(performance.now()) })).catch(() => null),
      new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), 1000) }),
    ]).finally(() => clearTimeout(timer))
    console.info(`[bootstrap-diagnostics] ${JSON.stringify({ elapsed: Date.now() - started, pending: [...pending.values()].slice(-40), finished, failures, snapshot })}`)
  }
}
