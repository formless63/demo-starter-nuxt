import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { chromium } from '@playwright/test'
import { startApp } from './app'
import { runBrowser } from './browser'
import { runNative } from './native'
import { runProtocol, startProtocol } from './protocol'
import { runProviders } from './provider-runtime'

// All gates are mandatory. Missing Docker, Chromium or allowed Nitro sockets is
// an unavailable hosted gate, never a successful "skip" or mock substitute.
const unit = Bun.spawn(['bun', 'test', './.fixture/workflow.test.ts'], { stdout: 'inherit', stderr: 'inherit' })
assert.equal(await unit.exited, 0, 'Packed lifecycle/race/memory-capacity contracts')

const backendless = await startApp()
try {
  const html = await (await fetch(`${backendless.base}/files`)).text()
  assert.match(html, /NON-DURABLE/)
  assert.match(html, /Choose a file/)
  assert.match(html, /Loading files/)
  assert.equal((await fetch(`${backendless.base}/api/files/list`)).status, 401)
  console.info('[file-ui] backendless production boot/SSR passed without Storage credentials or connection')
}
finally { await backendless.stop() }

if (process.env.CI && !process.env.PLAYWRIGHT_CHROMIUM_PATH) {
  const install = Bun.spawn(['bun', 'x', 'playwright', 'install', '--with-deps', 'chromium'], { stdout: 'inherit', stderr: 'inherit' })
  assert.equal(await install.exited, 0, 'Required hosted Chromium installation')
}
const protocol = await startProtocol()
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
let app: Awaited<ReturnType<typeof startApp>> | undefined
try {
  await runProtocol(protocol)
  const alice = randomUUID()
  const bob = randomUUID()
  const env = {
    STORAGE_BUCKET: protocol.config.bucket, STORAGE_REGION: protocol.config.region,
    STORAGE_ENDPOINT: protocol.config.endpoint, STORAGE_ACCESS_KEY_ID: protocol.config.accessKeyId,
    STORAGE_SECRET_ACCESS_KEY: protocol.config.secretAccessKey,
    FILE_UI_FIXTURE_ALICE: alice, FILE_UI_FIXTURE_BOB: bob,
  }
  app = await startApp(env)
  browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined })
  await runBrowser(browser, app.base)
  const retained = await runNative(app.base, alice, bob, protocol, browser)
  const puts = protocol.puts()
  await app.stop()
  app = undefined
  app = await startApp(env)
  const headers = { cookie: `file-fixture-session=${alice}` }
  assert.deepEqual(await (await fetch(`${app.base}/api/files/list`, { headers })).json(), [])
  assert.equal((await fetch(`${app.base}/api/files/download?id=${retained.id}`, { headers })).status, 404)
  assert.equal(protocol.objects.size, 1, 'Restart loses memory receipts but never deletes provider bytes')
  assert.equal(protocol.puts(), puts, 'Restart must not start uploads or background reconciliation')
  assert.equal([...protocol.objects.values()][0]?.body.toString(), 'retained across process restart')
  console.info('[file-ui] actual Node process restart: NON-DURABLE memory loses receipts; object bytes remain; no startup storage writes')
}
finally {
  await browser?.close()
  await app?.stop()
  await protocol.close()
}

// Projects and objects survive until the generic uninstall/typecheck/rebuild and
// postRemoval hook have completed. Only cleanup tears down this disposable state.
await runProviders()
console.info('[file-ui] packed runtime gates passed; provider witnesses retained for uninstall/rebuild')
