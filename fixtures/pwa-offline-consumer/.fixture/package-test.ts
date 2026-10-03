import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, type Page } from '@playwright/test'
import { publicAssets } from '@repo/nuxt-pwa-offline/constants'
import { assetPaths, buildConsumer, chromium, launchOptions, naturallyActivate, observe, outputFile, runCommand, sha256, startConsumer, stateDirectory, statePath, verifyLiveHttp, workerFilename, type LifecycleState } from './harness'
import { waitForPwa, waitForWorker } from './wait'

let pollingAttempts = 0
await waitForPwa(async () => { pollingAttempts++; await Promise.resolve(); return pollingAttempts >= 3 }, 'await resolved false before readiness')
assert.equal(pollingAttempts, 3, 'Regression: false, false, true requires three awaited predicate calls')

assert.deepEqual(assetPaths, [...publicAssets], 'Fixture reviewed allowlist matches packed constants')

const originalConfig = await readFile('nuxt.config.ts', 'utf8')
const moduleEntry = import.meta.resolve('@repo/nuxt-pwa-offline')
const templatePath = resolve(dirname(fileURLToPath(moduleEntry)), 'runtime/worker-template.txt')
const originalTemplate = await readFile(templatePath, 'utf8')
await mkdir(stateDirectory, { recursive: true })
let server = await startConsumer()
const { origin, port } = server
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
let returning: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | undefined
const profile = resolve(stateDirectory, 'returning-client')

async function enabled(page: Page) {
  const enable = page.getByRole('button', { name: 'Enable offline notice' })
  await expect(enable).toBeEnabled()
  await enable.click()
}

async function controlled(page: Page) {
  await waitForWorker(page, 'worker active', async () => !!(await navigator.serviceWorker.getRegistration())?.active)
  await page.reload()
  await waitForWorker(page, 'controlled reload', () => !!navigator.serviceWorker.controller)
}

async function cacheEntries(page: Page) {
  return page.evaluate(async () => {
    const result: string[] = []
    for (const key of await caches.keys()) {
      if (!key.startsWith('pwa-offline:')) continue
      for (const entry of await (await caches.open(key)).keys()) result.push(entry.url)
    }
    return result.sort()
  })
}

async function cacheSnapshot(page: Page) {
  return page.evaluate(async () => {
    const rows: { cache: string, url: string, sha256: string }[] = []
    for (const name of (await caches.keys()).filter(key => key.startsWith('pwa-offline:')).sort()) {
      const cache = await caches.open(name)
      for (const entry of await cache.keys()) {
        const response = await cache.match(entry)
        if (!response) throw new Error('Missing cache entry')
        const digest = await crypto.subtle.digest('SHA-256', await response.arrayBuffer())
        rows.push({ cache: name, url: entry.url, sha256: [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('') })
      }
    }
    return rows.sort((left, right) => left.url.localeCompare(right.url))
  })
}

async function rebuild(config = originalConfig) {
  await server.close()
  await writeFile('nuxt.config.ts', config)
  await buildConsumer()
  server = await startConsumer(port)
}

try {
  const liveWorker = await verifyLiveHttp(origin)
  assert.notDeepEqual(liveWorker, await readFile(`public/${workerFilename}`), 'Native live build replaces copied tombstone rather than serving it')
  if (process.env.CI) {
    assert.equal(await runCommand(['bunx', 'playwright', 'install', '--with-deps', 'chromium']), 0, 'Official pinned Chromium installation succeeds')
  }
  // Failure to find/launch a real browser is a hard failure. CI installs Chromium;
  // never turn browser unavailability into a passing runtime check.
  browser = await chromium.launch(launchOptions())
  const context = await browser.newContext({ serviceWorkers: 'allow' })
  observe(context, 'default')
  let page = await context.newPage()
  await page.goto(`${origin}/pwa-test`)
  await page.evaluate(() => { (window as typeof window & { pwaReadinessCalls: number }).pwaReadinessCalls = 0 })
  await waitForWorker(page, 'browser false, false, true readiness regression', async () => {
    await Promise.resolve()
    const state = window as typeof window & { pwaReadinessCalls: number }
    state.pwaReadinessCalls++
    return state.pwaReadinessCalls >= 3
  })
  assert.equal(await page.evaluate(() => (window as typeof window & { pwaReadinessCalls: number }).pwaReadinessCalls), 3)
  await expect(page.getByRole('button', { name: 'Enable offline notice' })).toBeEnabled()
  assert.deepEqual(await page.evaluate(async () => ({ registrations: (await navigator.serviceWorker.getRegistrations()).length, caches: (await caches.keys()).length })), { registrations: 0, caches: 0 }, 'Hydration does not register or cache automatically')
  await page.evaluate(() => fetch('/api/login', { method: 'POST' }))
  const signedIn = await page.evaluate(async () => (await (await fetch('/api/private')).json()) as { session: string, nonce: number })
  assert.equal(signedIn.session, 'private-user', 'Real ordinary browser requests carry the HttpOnly session cookie')
  server.trace.length = 0
  await enabled(page)
  await waitForWorker(page, 'default first activation', async () => !!(await navigator.serviceWorker.getRegistration())?.active)
  assert.equal(await page.evaluate(() => navigator.serviceWorker.controller), null, 'Activation does not claim/reload the existing document')
  const installRequests = server.trace.filter(entry => entry.path.startsWith('/pwa-offline/') && entry.destination === 'empty')
  // Chromium may omit Sec-Fetch-Dest in older builds; an empty header has the same
  // meaning for these observed non-document, non-image worker fetches.
  const observedInstall = installRequests.length ? installRequests : server.trace.filter(entry => entry.path.startsWith('/pwa-offline/') && entry.destination === '')
  assert.deepEqual([...new Set(observedInstall.map(entry => entry.path))].sort(), assetPaths.map(path => `/${path}`).sort())
  assert(observedInstall.every(entry => !entry.cookie && !entry.authorization), 'All three native worker precache requests omit credentials')
  console.info('[pwa precache transport]', JSON.stringify(observedInstall))
  await controlled(page)
  assert.deepEqual(await cacheEntries(page), assetPaths.map(path => `${origin}/${path}`).sort())
  const beforeLogout = await page.evaluate(async () => (await (await fetch('/api/private')).json()) as { session: string, nonce: number })
  await page.evaluate(() => fetch('/api/logout', { method: 'POST' }))
  const afterLogout = await page.evaluate(async () => (await (await fetch('/api/private')).json()) as { session: string, nonce: number })
  assert.equal(afterLogout.session, 'anonymous')
  assert(afterLogout.nonce > beforeLogout.nonce, 'Private responses always hit the actual server across login/logout')
  assert(server.trace.some(entry => entry.path === '/api/private' && entry.cookie))
  assert(server.trace.some(entry => entry.path === '/api/private' && !entry.cookie))
  assert.deepEqual(await cacheEntries(page), assetPaths.map(path => `${origin}/${path}`).sort(), 'Private responses never enter CacheStorage')
  const syntheticInstall = await page.evaluate(async () => {
    const install = [...document.querySelectorAll('button')].find(button => button.textContent === 'Install app')!
    const before = { disabled: install.disabled, status: document.querySelector('[role="status"]')?.textContent }
    window.dispatchEvent(new Event('beforeinstallprompt'))
    window.dispatchEvent(new Event('appinstalled'))
    await Promise.resolve()
    return { before, after: { disabled: install.disabled, status: document.querySelector('[role="status"]')?.textContent } }
  })
  assert.deepEqual(syntheticInstall.after, syntheticInstall.before, 'Synthetic install events do not change browser eligibility or installation state')
  await page.getByRole('button', { name: 'Toggle panel' }).click()
  await page.getByRole('button', { name: 'Toggle panel' }).click()
  await enabled(page)
  assert.equal(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length), 1, 'Remount reuses the one owned registration')
  await page.getByRole('link', { name: 'Another route' }).click()
  await expect(page.getByRole('heading', { name: 'Another native route' })).toBeVisible()
  await page.goBack()
  await expect(page.getByRole('heading', { name: 'Public offline demonstration' })).toBeVisible()
  await enabled(page)
  await page.goForward()
  await expect(page.getByRole('heading', { name: 'Another native route' })).toBeVisible()
  await page.goBack()
  await enabled(page)
  await context.setOffline(true)
  await assert.rejects(() => page.goto(`${origin}/pwa-test`), 'Default configuration leaves publicOfflinePaths empty')
  await context.setOffline(false)
  await page.goto(`${origin}/pwa-test`)
  await enabled(page)

  // Persist a truly returning live client before deploying any retirement bytes.
  returning = await chromium.launchPersistentContext(profile, { ...launchOptions(), serviceWorkers: 'allow' })
  observe(returning, 'returning')
  const returningPage = returning.pages()[0] ?? await returning.newPage()
  await returningPage.goto(`${origin}/pwa-test`)
  await enabled(returningPage)
  await controlled(returningPage)
  await returningPage.evaluate(async () => { await (await caches.open('unrelated-owner')).put('/keep', new Response('keep unrelated cache')) })
  const returningCaches = await returningPage.evaluate(() => caches.keys())
  assert(returningCaches.some(key => key.startsWith('pwa-offline:')))
  await returning.close()
  returning = undefined

  // Different worker bytes, same embedded content version. Reuse the existing
  // complete cache read-only, even when refetching would now be unsafe.
  const priorCaches = await page.evaluate(() => caches.keys())
  const priorSnapshot = await cacheSnapshot(page)
  // Deliberate deployment transform: Nitro embeds file sizes/etags, so changing
  // its output file alone would truncate the response rather than deploy bytes.
  server.options.workerSuffix = '\n// same-version deployment replacement\n'
  const transformed = await fetch(`${origin}/${workerFilename}`)
  const transformedBytes = Buffer.from(await transformed.arrayBuffer())
  assert.deepEqual(transformedBytes, Buffer.concat([liveWorker, Buffer.from(server.options.workerSuffix)]))
  assert.equal(Number(transformed.headers.get('content-length')), transformedBytes.length)
  server.trace.length = 0
  server.options.mode = 'deny-png'
  const sameVersionEvent = context.waitForEvent('serviceworker', { timeout: 20000 })
  await page.getByRole('button', { name: 'Check for updates' }).click()
  const sameVersion = await sameVersionEvent
  await waitForWorker(page, 'same-version worker waiting', async () => !!(await navigator.serviceWorker.getRegistration())?.waiting)
  assert.equal(server.trace.filter(entry => entry.path.startsWith('/pwa-offline/')).length, 0, 'Same-version cache verification performs no network refetch')
  assert.deepEqual(await page.evaluate(() => caches.keys()), priorCaches)
  assert.deepEqual(await cacheSnapshot(page), priorSnapshot, 'Same-version replacement leaves every cached byte unchanged')
  await naturallyActivate(context, sameVersion)
  page = await context.newPage()
  await page.goto(`${origin}/pwa-test`)
  await enabled(page)
  assert.deepEqual(await page.evaluate(() => caches.keys()), priorCaches)
  // Open both controlled tabs while the deployed worker is still unchanged.
  // Opening a new tab after a failed build could race the explicit retry with
  // Chromium's navigation-triggered automatic update.
  const second = await context.newPage()
  await second.goto(`${origin}/pwa-test`)
  await waitForWorker(second, 'second tab controlled', () => !!navigator.serviceWorker.controller)

  // A native new build changes the content version. Failure on a late PNG must
  // remove only its new partial cache and retain the old usable complete cache.
  await writeFile(templatePath, `${originalTemplate}\n// fixture version two\n`)
  await rebuild()
  server.options.mode = 'deny-png'
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration()
    if (!registration) throw new Error('Missing original worker')
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Failed update timed out')), 20000)
      registration.addEventListener('updatefound', () => {
        const installing = registration.installing
        installing?.addEventListener('statechange', () => {
          if (installing.state === 'redundant') { clearTimeout(timer); resolve() }
        })
      }, { once: true })
      void registration.update().catch(reject)
    })
  })
  assert.deepEqual(await page.evaluate(() => caches.keys()), priorCaches, 'Failed new install preserves old cache names')
  assert.deepEqual(await cacheSnapshot(page), priorSnapshot, 'Failed new install preserves all previous cache bytes')
  assert.deepEqual(await cacheEntries(page), assetPaths.map(path => `${origin}/${path}`).sort(), 'Failed new install preserves all original cached bytes')

  await page.getByLabel('Unsaved draft').fill('Do not lose this draft')
  server.options.mode = ''
  const updateEvent = context.waitForEvent('serviceworker', { timeout: 20000 })
  await page.getByRole('button', { name: 'Check for updates' }).click()
  const updateWorker = await updateEvent
  await waitForWorker(page, 'new version waiting for all tabs', async () => !!(await navigator.serviceWorker.getRegistration())?.waiting)
  await expect(page.getByRole('button', { name: 'Later' })).toBeVisible()
  await page.getByRole('button', { name: 'Later' }).click()
  await expect(page.getByLabel('Unsaved draft')).toHaveValue('Do not lose this draft')
  await page.getByRole('button', { name: 'Toggle panel' }).click()
  await page.getByRole('button', { name: 'Toggle panel' }).click()
  await enabled(page)
  await expect(page.getByLabel('Unsaved draft')).toHaveValue('Do not lose this draft')
  await page.close()
  assert.equal(await second.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())?.waiting), true, 'A second open tab prevents activation')
  await naturallyActivate(context, updateWorker)
  page = await context.newPage()
  await page.goto(`${origin}/pwa-test`)
  await waitForWorker(page, 'new version naturally active', async () => { const registration = await navigator.serviceWorker.getRegistration(); return !!registration?.active && !registration.waiting })
  await enabled(page)
  assert.notDeepEqual(await page.evaluate(() => caches.keys()), priorCaches, 'Successful activation replaces only the owned old version')
  await page.evaluate(async () => { await (await caches.open('unrelated-owner')).put('/keep', new Response('keep unrelated cache')) })

  // Phase one retirement is a native module build at precisely the live URL and
  // scope. Its exact bytes become the retained deployment tombstone.
  await rebuild(`export default defineNuxtConfig({ compatibilityDate: '2026-01-01', modules: ['@repo/nuxt-pwa-offline'], pwaOffline: { retired: true }, typescript: { strict: true }, nitro: { preset: 'node-server' } })\n`)
  const tombstone = await readFile(outputFile(workerFilename))
  assert.notEqual(sha256(tombstone), sha256(liveWorker))
  const retiredHttp = await fetch(`${origin}/${workerFilename}`)
  assert.equal(retiredHttp.status, 200)
  assert.match(retiredHttp.headers.get('content-type') ?? '', /javascript/u)
  assert.deepEqual(Buffer.from(await retiredHttp.arrayBuffer()), tombstone)
  const retirementEvent = context.waitForEvent('serviceworker', { timeout: 20000 })
  await page.getByRole('button', { name: 'Check for updates' }).click()
  const retirementWorker = await retirementEvent
  await waitForWorker(page, 'same-URL retirement waiting', async () => !!(await navigator.serviceWorker.getRegistration())?.waiting)
  await naturallyActivate(context, retirementWorker)
  page = await context.newPage()
  await page.goto(origin)
  await waitForWorker(page, 'phase-one retirement unregistered', async () => !(await navigator.serviceWorker.getRegistration()))
  assert.deepEqual(await page.evaluate(() => caches.keys()), ['unrelated-owner'], 'Retirement retains unrelated CacheStorage')
  await context.close()
  await writeFile(`public/${workerFilename}`, tombstone)
  const state: LifecycleState = { origin, port, profile, tombstoneHash: sha256(tombstone), liveWorkerHash: sha256(liveWorker), cacheNames: returningCaches }
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`)

  await writeFile(templatePath, originalTemplate)
  await rebuild()
  await verifyLiveHttp(origin)
  for (const mode of ['private', 'no-store', 'no-cache', 'vary:Cookie', 'vary:Authorization', 'vary:*', 'cache:public, public, immutable', 'cache:note="x,public,immutable,z"', 'redirect', 'status', 'content-type', 'tamper']) {
    server.options.mode = mode
    const rejected = await browser.newContext({ serviceWorkers: 'allow' })
    observe(rejected, mode)
    const tab = await rejected.newPage()
    await tab.goto(`${origin}/pwa-test`)
    await enabled(tab)
    await expect(tab.getByRole('status').first()).toContainText('error')
    assert.equal(await tab.evaluate(async () => (await caches.keys()).filter(key => key.startsWith('pwa-offline:')).length), 0, `Rejected ${mode} leaves no partial owned cache`)
    await rejected.close()
  }
  server.options.mode = ''
  const conflicted = await browser.newContext({ serviceWorkers: 'allow' })
  const conflictPage = await conflicted.newPage()
  await conflictPage.goto(`${origin}/pwa-test`)
  await conflictPage.evaluate(() => navigator.serviceWorker.register('/foreign-sw.js', { scope: '/' }))
  await waitForWorker(conflictPage, 'unrelated worker active', async () => !!(await navigator.serviceWorker.getRegistration())?.active)
  await enabled(conflictPage)
  await expect(conflictPage.getByRole('status').first()).toContainText('error')
  assert.equal(await conflictPage.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.active?.scriptURL), `${origin}/foreign-sw.js`, 'Owned controller never replaces an unrelated worker')
  assert.deepEqual(await conflictPage.evaluate(() => caches.keys()), [])
  await conflicted.close()

  await rebuild(`export default defineNuxtConfig({ compatibilityDate: '2026-01-01', modules: ['@repo/nuxt-pwa-offline'], app: { baseURL: '/demo/' }, pwaOffline: { base: '/demo/', publicOfflinePaths: ['pwa-test'] }, typescript: { strict: true }, nitro: { preset: 'node-server' } })\n`)
  await verifyLiveHttp(origin, '/demo/')
  const scoped = await browser.newContext({ serviceWorkers: 'allow' })
  observe(scoped, 'scoped')
  const tab = await scoped.newPage()
  await tab.goto(`${origin}/demo/pwa-test`)
  await enabled(tab)
  await controlled(tab)
  assert.equal(await tab.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.scope), `${origin}/demo/`)
  assert.deepEqual(await cacheEntries(tab), assetPaths.map(path => `${origin}/demo/${path}`).sort())
  server.options.errorPage = true
  const unavailable = await tab.goto(`${origin}/demo/pwa-test`)
  assert.equal(unavailable?.status(), 503, 'A real HTTP error is not converted to an offline success')
  await expect(tab.locator('body')).toContainText('Real server failure')
  server.options.errorPage = false
  await tab.goto(`${origin}/demo/pwa-test`)
  await scoped.setOffline(true)
  await tab.goto(`${origin}/demo/pwa-test`)
  await expect(tab.getByRole('heading', { name: 'You are offline' })).toBeVisible()
  assert.equal(await tab.evaluate(() => fetch('/demo/api/private').then(() => true, () => false)), false, 'Private API fetches never receive the notice')
  for (const path of ['/demo/private', '/demo/pwa-test?private=1', '/pwa-test']) await assert.rejects(() => tab.goto(`${origin}${path}`), `No fallback outside exact configured public path: ${path}`)
  await scoped.close()
  console.info('[pwa fixture] Native Nuxt/Nitro HTTP, explicit registration, credential omission, malicious responses, default/scoped fallback, remount/history, same-version reuse, failed update, multi-tab drafts and phase-one retirement passed')
}
finally {
  await returning?.close()
  await browser?.close()
  await server.close()
  await writeFile('nuxt.config.ts', originalConfig)
  await writeFile(templatePath, originalTemplate)
}
