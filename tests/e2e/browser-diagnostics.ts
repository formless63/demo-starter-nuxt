import type { Page } from '@playwright/test'
/** Closed diagnostics only: no raw console, request headers, bodies or URL queries. */
export function browserDiagnostics(page: Page) {
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
    console.info(`[browser-diagnostic] script_failure category=${category} status=${response.status()}`)
  })
}
