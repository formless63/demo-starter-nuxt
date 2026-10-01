import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import { startProvider } from './provider.ts'

const backendlessEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('AI_')))
async function boot(env: NodeJS.ProcessEnv = {}, check = false, fixture?: Awaited<ReturnType<typeof startProvider>>) {
  const reservation = createServer()
  await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve))
  const port = (reservation.address() as { port: number }).port
  await new Promise<void>(resolve => reservation.close(() => resolve()))
  const server = Bun.spawn(['node', '.output/server/index.mjs'], {
    env: { ...backendlessEnv, ...env, PORT: String(port), NITRO_PORT: String(port), HOST: '127.0.0.1', NITRO_HOST: '127.0.0.1' }, stdout: 'ignore', stderr: 'ignore',
  })
  try {
    const deadline = Date.now() + 15000
    let ready = false
    while (Date.now() < deadline) {
      assert.equal(server.exitCode, null)
      try { if ((await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1000) })).ok) { ready = true; break } }
      catch { /* Bounded readiness polling. */ }
      await Bun.sleep(100)
    }
    assert(ready, 'Backendless production Node boot')
    if (check) {
      assert.deepEqual(await (await fetch(`http://127.0.0.1:${port}/api/check`)).json(), { ok: true })
      const response = await fetch(`http://127.0.0.1:${port}/api/stream`)
      const reader = response.body!.getReader()
      assert(new TextDecoder().decode((await reader.read()).value).includes('text-delta'))
      await reader.cancel()
      const deadline = Date.now() + 2000
      while (!fixture!.disconnected.cancel && Date.now() < deadline) await Bun.sleep(10)
      assert(fixture!.disconnected.cancel, 'Nitro disconnect aborts actual provider work')
    }
  }
  finally {
    server.kill('SIGTERM')
    const stopped = await Promise.race([server.exited.then(() => true), Bun.sleep(5000).then(() => false)])
    if (!stopped) { server.kill('SIGKILL'); await server.exited }
    assert(stopped)
  }
}
await boot()
await boot({ NODE_ENV: 'test', AI_MODEL: 'fixture-model', AI_BASE_URL: 'http://127.0.0.1:1/v1' })
const version = Bun.spawnSync(['node', '--version'])
console.info(`[ai] Node runtime ${version.stdout.toString().trim()}`)
assert.match(version.stdout.toString(), /^v24\./u, 'Node 24 is required for adapter verification')
const node = Bun.spawn(['node', '--experimental-strip-types', '.fixture/contract.ts'], { stdout: 'inherit', stderr: 'inherit' })
assert.equal(await node.exited, 0, 'Full adapter contract on Node 24')
const bun = Bun.spawn(['bun', '.fixture/contract.ts'], { stdout: 'inherit', stderr: 'inherit' })
assert.equal(await bun.exited, 0, 'Full adapter contract on Bun tooling')
const fixture = await startProvider()
try { await boot({ NODE_ENV: 'test', AI_MODEL: 'fixture-model', AI_BASE_URL: fixture.baseUrl }, true, fixture) }
finally { await fixture.close() }
console.info('[ai] Backendless boot, server import and Nitro disconnect passed')
