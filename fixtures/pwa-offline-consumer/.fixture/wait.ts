import { expect, type Page } from '@playwright/test'

// Playwright 1.63 waitForFunction(async () => false) can accept the Promise's
// truthiness before settlement. Poll the awaited, serialized boolean instead.
export async function waitForPwa(predicate: () => boolean | Promise<boolean>, label: string) {
  await expect.poll(predicate, { timeout: 20000, message: label }).toBe(true)
}

export async function waitForWorker(page: Page, label: string, predicate: () => boolean | Promise<boolean>) {
  try {
    await waitForPwa(() => page.evaluate(predicate), label)
    console.info(`[pwa fixture] ${label}`)
  }
  catch (error) {
    const diagnostics = await page.evaluate(async () => ({
      path: location.pathname,
      online: navigator.onLine,
      controller: navigator.serviceWorker.controller?.scriptURL,
      registrations: (await navigator.serviceWorker.getRegistrations()).map(registration => ({
        scope: registration.scope,
        active: registration.active?.state,
        installing: registration.installing?.state,
        waiting: registration.waiting?.state,
      })),
      caches: await caches.keys(),
      status: Array.from(document.querySelectorAll('[role="status"]')).map(element => element.textContent),
    })).catch(() => ({ unavailable: true }))
    console.error(`[pwa fixture] ${label}`, JSON.stringify(diagnostics))
    throw error
  }
}
