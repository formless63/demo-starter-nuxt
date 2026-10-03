import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { expect } from '@playwright/test'
import { chromium, closeTabs, launchOptions, observe, outputFile, sha256, startConsumer, statePath, workerFilename, type LifecycleState } from './harness'
import { waitForPwa, waitForWorker } from './wait'

const state = JSON.parse(await readFile(statePath, 'utf8')) as LifecycleState
const server = await startConsumer(state.port)
let context: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | undefined
try {
  assert.equal(server.origin, state.origin, 'Returning browser keeps the exact original origin')
  const response = await fetch(`${server.origin}/${workerFilename}`)
  assert.equal(response.status, 200, 'Lean deployment retains an HTTP 200 tombstone at the original URL')
  assert.match(response.headers.get('content-type') ?? '', /javascript/u)
  assert.match(response.headers.get('cache-control') ?? '', /no-cache/u)
  const bytes = Buffer.from(await response.arrayBuffer())
  assert.equal(sha256(bytes), state.tombstoneHash, 'Lean HTTP serves exact phase-one retirement bytes')
  assert.notEqual(sha256(bytes), state.liveWorkerHash, 'Retirement must not accidentally serve the original live worker')
  assert.deepEqual(bytes, await readFile(outputFile(workerFilename)))
  const html = await (await fetch(server.origin)).text()
  assert(!html.includes('rel="manifest"'), 'Removed module no longer injects an SSR manifest link')
  assert(!html.includes('Enable offline notice'), 'Removed UI does not register new clients')
  assert(!(await readFile('package.json', 'utf8')).includes('@repo/nuxt-pwa-offline'), 'No removed capability dependency remains')
  assert(!(await readFile('nuxt.config.ts', 'utf8')).includes('@repo/nuxt-pwa-offline'), 'No removed module reference remains')
  context = await chromium.launchPersistentContext(state.profile, { ...launchOptions(), serviceWorkers: 'allow' })
  observe(context, 'post-removal')
  const page = context.pages()[0] ?? await context.newPage()
  await page.goto(server.origin)
  await expect(page.getByRole('heading', { name: 'Independent Nuxt consumer' })).toBeVisible()
  const retained = await page.evaluate(async () => ({ registrations: (await navigator.serviceWorker.getRegistrations()).map(registration => registration.scope), caches: await caches.keys() }))
  assert(retained.caches.includes('unrelated-owner'), 'Returning profile preserves the unrelated cache')
  if (retained.registrations.length) {
    assert.deepEqual(retained.registrations, [`${server.origin}/`], 'Returning profile keeps the original scope')
    // Chromium can finish automatic retirement between these asynchronous reads.
    // Require the exact saved live set or the fully retired owned-cache state.
    const actual = retained.caches.sort()
    assert(JSON.stringify(actual) === JSON.stringify([...state.cacheNames].sort()) || JSON.stringify(actual) === JSON.stringify(['unrelated-owner']))
  }
  else assert.deepEqual(retained.caches, ['unrelated-owner'], 'Automatic startup retirement completed owned cleanup')
  // An already-open returning document retains the live worker until all tabs
  // close, so explicitly checking for its same-URL update is safe and bounded.
  await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration())?.update() })
  await waitForWorker(page, 'returning client receives retirement update', async () => {
    const registration = await navigator.serviceWorker.getRegistration()
    return !registration || !!registration.waiting
  })
  await closeTabs(context)
  // Do not capture workers by URL: on restored profiles that can select the old
  // active instance. Brief probes close between polls, permitting natural
  // retirement without evaluating a worker that may have been destroyed.
  const returningContext = context
  await waitForPwa(async () => {
    const probe = await returningContext.newPage()
    try {
      await probe.goto(server.origin)
      return await probe.evaluate(async () => !(await navigator.serviceWorker.getRegistration()))
    }
    finally { await probe.close() }
  }, 'same-URL tombstone naturally retires between closed probes')
  const returned = await context.newPage()
  await returned.goto(server.origin)
  await waitForWorker(returned, 'post-removal returning client unregisters', async () => !(await navigator.serviceWorker.getRegistration()))
  assert.deepEqual(await returned.evaluate(() => caches.keys()), ['unrelated-owner'], 'Post-removal returning client clears owned caches only')
  assert.equal(await returned.evaluate(async () => await (await (await caches.open('unrelated-owner')).match('/keep'))?.text()), 'keep unrelated cache')
  console.info('[pwa fixture] Complete package/source removal preserves exact HTTP tombstone; persisted returning browser unregisters and retains unrelated cache')
}
finally {
  await context?.close()
  await server.close()
}
