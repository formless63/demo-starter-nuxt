import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium, expect } from '@playwright/test'

for (const runtime of ['bun', 'node']) {
  const child = Bun.spawn([runtime, '.fixture/contract.ts'], { stdout: 'inherit', stderr: 'inherit' })
  assert.equal(await child.exited, 0, `Shipped parser and Vue SSR contract on ${runtime}`)
}
const dom = Bun.spawn(['bun', '.fixture/dom.ts'], { stdout: 'inherit', stderr: 'inherit' })
assert.equal(await dom.exited, 0, 'Shipped Vue interrupted clipboard states')
async function inspect(directory: string): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) await inspect(path)
    else {
      assert(!/\.wasm$/.test(path), 'No client WASM')
      if (!path.endsWith('.js')) continue
      const content = await readFile(path, 'utf8')
      for (const marker of ['createHighlighterCore', 'onig.wasm', 'github-light.json', 'markdown-it', 'class StateBlock', 'function StateBlock']) assert(!content.includes(marker), `Server parser/grammar absent: ${marker}`)
    }
  }
}
await inspect('.output/public')
const reservation = createServer()
await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve))
const port = (reservation.address() as { port: number }).port
await new Promise<void>(resolve => reservation.close(() => resolve()))
const server = Bun.spawn(['node', '.output/server/index.mjs'], { env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), NITRO_HOST: '127.0.0.1', NITRO_PORT: String(port) }, stdout: 'inherit', stderr: 'inherit' })
try {
  const url = `http://127.0.0.1:${port}`
  let ready = false
  const deadline = Date.now() + 30000
  while (Date.now() < deadline) {
    assert.equal(server.exitCode, null)
    try { if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) { ready = true; break } }
    catch { /* Bounded server readiness. */ }
    await Bun.sleep(100)
  }
  assert(ready, 'Backendless Node server starts')
  const ssr = await (await fetch(`${url}/markdown`)).text()
  assert(ssr.includes('<h1>Markdown reference</h1>'))
  assert(ssr.includes('Copy typescript code'))
  assert(!ssr.includes('<script>unsafe()'))
  if (process.env.CI) {
    const install = Bun.spawn(['bunx', 'playwright', 'install', '--with-deps', 'chromium'], { stdout: 'inherit', stderr: 'inherit' })
    assert.equal(await install.exited, 0, 'Install mandatory browser gate')
  }
  const browser = await chromium.launch()
  try {
    const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] })
    const page = await context.newPage()
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(`${url}/markdown`)
    await expect(page.locator('html')).toHaveAttribute('data-fixture-ready', 'true', { timeout: 30000 })
    await expect(page.getByRole('heading', { name: 'Markdown reference' })).toBeVisible()
    await expect(page.locator('.markdown-content img')).toHaveCount(0)
    await expect(page.locator('.markdown-content a[href^="javascript:"]')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Copy typescript code' })).toBeEnabled()
    await page.getByRole('button', { name: 'Copy typescript code' }).click()
    await expect(page.locator('output').first()).toHaveText('Copied')
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'const greeting = "<script>"\n')
    await page.getByRole('button', { name: 'Copy typescript code' }).click()
    await expect(page.locator('output').first()).toHaveText('Copied')
    await page.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('Denied') } } }) })
    await page.getByRole('button', { name: 'Copy typescript code' }).click()
    await expect(page.locator('output').first()).toContainText('Could not copy')
    await page.evaluate(() => document.documentElement.classList.add('dark'))
    await expect(page.locator('.markdown-code-block pre').first()).toHaveCSS('background-color', 'rgb(36, 41, 46)')
    const hydrationWarnings: string[] = []
    page.on('console', message => { if (/hydration|mismatch/i.test(message.text())) hydrationWarnings.push(message.text()) })
    await page.goto(`${url}/malformed`)
    await expect(page.locator('html')).toHaveAttribute('data-fixture-ready', 'true', { timeout: 30000 })
    await expect(page.getByRole('button', { name: 'Copy text code' })).toBeEnabled()
    await expect(page.locator('.markdown-content')).not.toContainText('drop ')
    await expect(page.locator('table > thead > tr > th')).toHaveText('Head')
    await expect(page.locator('table > tbody > tr > td')).toHaveText('Cell')
    await expect(page.locator('.markdown-content > p').first()).toHaveText('beforeafter')
    assert.deepEqual(hydrationWarnings, [], 'Real browser SSR parse/hydration preserves validated grammar')
    assert.deepEqual(errors, [])
  }
  finally { await browser.close() }
}
finally { server.kill('SIGTERM'); await server.exited }
console.info('Packed Markdown consumer: strict types/build, shipped SSR, browser hydration/copy/security/theme, and client boundary passed')
