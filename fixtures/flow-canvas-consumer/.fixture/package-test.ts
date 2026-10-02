import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import { chromium } from '@playwright/test'
import { checkFlowCanvas } from './browser'

for (const runtime of ['bun', 'node']) {
  const child = Bun.spawn(runtime === 'bun' ? ['bun', 'test', './.fixture/graph-contract.test.ts'] : ['node', '.fixture/graph-contract.test.ts'], { stdout: 'inherit', stderr: 'inherit' })
  assert.equal(await child.exited, 0, `Pure shipped graph contract on ${runtime}`)
}
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
    catch { /* Bounded readiness */ }
    await Bun.sleep(100)
  }
  assert(ready, 'Independent backendless Node consumer starts')
  const response = await fetch(`${url}/flow-test`)
  assert.match(response.headers.get('content-type') ?? '', /text\/html.*charset=utf-8/i)
  const ssr = new TextDecoder('utf-8', { fatal: true }).decode(await response.arrayBuffer())
  assert.match(ssr, /<meta[^>]+charset="utf-8"/i)
  for (const marker of ['Primary diagram', 'Independent diagram', 'Alpha café 🧭 (alpha)', 'Beta (beta)', 'Graph nodes', 'Graph connections', 'Interactive canvas loads after hydration']) assert(ssr.includes(marker), `Meaningful deterministic SSR: ${marker}`)
  assert(!ssr.includes('class="vue-flow__node'), 'Native canvas enhances only on client')
  if (process.env.CI) {
    const install = Bun.spawn(['bunx', 'playwright', 'install', '--with-deps', 'chromium'], { stdout: 'inherit', stderr: 'inherit' })
    assert.equal(await install.exited, 0)
  }
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => { if (/hydration.*mismatch/i.test(message.text())) errors.push(message.text()) })
    await page.goto(`${url}/flow-test`)
    await page.locator('html[data-fixture-ready="true"]').waitFor({ timeout: 30000 })
    await checkFlowCanvas(page)
    assert.deepEqual(errors, [], 'No hydration mismatch or browser errors')
  }
  finally { await browser.close() }
}
finally { server.kill('SIGTERM'); await server.exited }
console.info('Flow packed graph/SSR/hydration/native controlled interactions/persistence/isolation passed')
