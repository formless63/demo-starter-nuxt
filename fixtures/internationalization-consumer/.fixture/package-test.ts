import { strict as assert } from 'node:assert'
import { chromium, expect } from '@playwright/test'
import { verifyInternationalization } from './browser'
const mounted = Bun.spawn(['bun', '.fixture/provider.ts'], { stdout: 'inherit', stderr: 'inherit' })
assert.equal(await mounted.exited, 0)
for (const runtime of ['bun', 'node']) {
  const child = Bun.spawn([runtime, '.fixture/transport.ts'], { stdout: 'inherit', stderr: 'inherit' })
  assert.equal(await child.exited, 0)
}
const port = 4331
const server = Bun.spawn(['bun', 'run', 'start'], { env: { ...Bun.env, PORT: String(port) }, stdout: 'ignore', stderr: 'inherit' })
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
try {
  let response: Response | undefined
  for (let i = 0; i < 100; i++) { try { response = await fetch(`http://127.0.0.1:${port}/i18n-test`) } catch { /* startup */ }; if (response) break; await Bun.sleep(200) }
  assert.equal(response?.status, 200)
  const html = new TextDecoder('utf-8', { fatal: true }).decode(await response!.arrayBuffer())
  assert.match(html, /Hello Ada/); assert.match(html, /&lt;img/); assert.doesNotMatch(html, /<img src=x/)
  const payloads = await Promise.all(['en', 'de', 'ar'].map(async locale => (await fetch(`http://127.0.0.1:${port}/api/i18n-reference?locale=${locale}`)).json()))
  assert.deepEqual(payloads.map(payload => payload.locale), ['en', 'de', 'ar'])
  if (process.env.CI) { const install = Bun.spawn(['bun', 'x', 'playwright', 'install', '--with-deps', 'chromium'], { stdout: 'inherit', stderr: 'inherit' }); assert.equal(await install.exited, 0) }
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error' || (message.type() === 'warning' && /hydration/i.test(message.text()))) errors.push(message.text()) })
  // Deliberately different browser formatting proves the first render uses server strings.
  await page.addInitScript(() => {
    Object.defineProperty(Intl.NumberFormat.prototype, 'format', { configurable: true, get: () => () => 'different-browser-ICU' })
    Object.defineProperty(Intl.DateTimeFormat.prototype, 'format', { configurable: true, get: () => () => 'different-browser-ICU' })
  })
  await page.goto(`http://127.0.0.1:${port}/i18n-test`)
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true')
  await expect(page.locator('[data-price]')).toHaveText(payloads[0].formatted.price)
  await expect(page.locator('[data-date]')).toHaveText(payloads[0].formatted.date)
  await verifyInternationalization(page)
  assert.deepEqual(errors, [])
} finally { await browser?.close(); server.kill(); await server.exited }
