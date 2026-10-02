import type { Page, Request } from '@playwright/test'
/** Closed diagnostics only: no raw console, request headers, bodies or URL queries. */
export function browserDiagnostics(page: Page) {
  const started = Date.now()
  const filename = (url: string) => new URL(url).pathname.split('/').at(-1)!.replace(/[^a-zA-Z0-9_.-]/g, '_')
  const pending = new Map<Request, { file: string, at: number }>()
  const finished: Array<{ file: string, started: number, finished: number }> = []
  page.on('request', request => {
    if (request.resourceType() === 'script') pending.set(request, { file: filename(request.url()), at: Date.now() - started })
  })
  page.on('requestfinished', request => {
    const entry = pending.get(request)
    if (entry) {
      finished.push({ file: entry.file, started: entry.at, finished: Date.now() - started })
      if (finished.length > 40) finished.shift()
      pending.delete(request)
    }
  })
  page.on('requestfailed', request => {
    if (pending.has(request)) console.info(`[browser-diagnostic] script_request_failed file=${filename(request.url())}`)
    pending.delete(request)
  })
  page.on('pageerror', error => {
    const message = error.message
    const code = message.includes('Failed to fetch dynamically imported module') ? 'dynamic_import_failed'
      : message.includes('does not provide an export named') ? 'missing_module_export'
        : message.includes('Cannot access') ? 'module_initialization_failed' : 'unclassified_page_error'
    const match = /https?:\/\/[^\s]+/.exec(message)
    let filename = 'unknown'
    if (match) { try { filename = new URL(match[0]!).pathname.split('/').at(-1)!.replace(/[^a-zA-Z0-9_.-]/g, '_') } catch { /* no raw message */ } }
    console.info(`[browser-diagnostic] ${code} file=${filename}`)
  })
  page.on('response', response => {
    if (response.request().resourceType() !== 'script' || response.status() < 400) return
    const path = new URL(response.url()).pathname
    const category = path.includes('/.vite/') ? 'vite_dependency' : path.includes('/_nuxt/') ? 'nuxt_script' : 'other_script'
    console.info(`[browser-diagnostic] script_failure category=${category} status=${response.status()} file=${path.split('/').at(-1)!.replace(/[^a-zA-Z0-9_.-]/g, '_')}`)
  })
  return async () => ({
    elapsed: Date.now() - started,
    pendingScripts: [...pending.values()].slice(-40),
    finishedScripts: finished,
    document: await Promise.race([page.evaluate(() => ({
      ready: document.readyState,
      hydrated: document.documentElement.getAttribute('data-app-hydrated'),
      stages: document.documentElement.dataset.nuxtE2eStages?.slice(0, 4000) ?? null,
    })).catch(() => null), new Promise<null>(resolve => setTimeout(() => resolve(null), 1000))]),
  })

}
