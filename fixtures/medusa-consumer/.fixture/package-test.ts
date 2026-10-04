import assert from 'node:assert/strict'
import { writeFile, unlink } from 'node:fs/promises'
import { createServer } from 'node:net'
import pg from 'pg'
import { runPinnedBackend } from './pinned-backend'
import { snapshot, statePath } from './lifecycle'
assert(process.env.DATABASE_URL, 'Disposable PostgreSQL required')
const pool = (connectionString: string, max: number) => { const value = new pg.Pool({ connectionString, max }); value.on('error', () => {}); return value }
const admin = pool(process.env.DATABASE_URL, 1)
const version = Bun.spawnSync(['node', '-e', "if (Number(process.versions.node.split('.')[0])!==24) process.exit(1); console.log(process.version)"], { stdout: 'pipe', stderr: 'pipe' })
assert.equal(version.exitCode, 0); console.info(`[medusa] actual Node ${version.stdout.toString().trim()} / Bun ${Bun.version}`)
const bundle = await Bun.build({ entrypoints: ['.fixture/runner.ts'], target: 'node', packages: 'external', outdir: '.fixture/compiled' })
assert(bundle.success)
try {
  for (const runtime of ['bun', 'node']) {
    const name = `medusa_fixture_${crypto.randomUUID().replaceAll('-', '')}`
    await admin.query(`CREATE DATABASE "${name}"`)
    const url = new URL(process.env.DATABASE_URL); url.pathname = `/${name}`
    await writeFile(statePath, JSON.stringify({ name, url: url.toString() }))
    const child = Bun.spawn([runtime, runtime === 'bun' ? '.fixture/runner.ts' : '.fixture/compiled/runner.js'], { env: { ...process.env, MEDUSA_FIXTURE_DATABASE_URL: url.toString() }, stdout: 'inherit', stderr: 'inherit' })
    assert.equal(await child.exited, 0, `${runtime} contract`)
    const client = pool(url.toString(), 1)
    try { await writeFile(statePath, JSON.stringify({ name, url: url.toString(), snapshot: JSON.parse(JSON.stringify(await snapshot(client))) })) }
    finally { await client.end() }
    if (runtime === 'bun') { await admin.query(`DROP DATABASE "${name}"`); await unlink(statePath) }
  }
  const retained = JSON.parse(await Bun.file(statePath).text())
  await runPinnedBackend(retained.url)
  const nativeClient = pool(retained.url, 1)
  try { await writeFile(statePath, JSON.stringify({ ...retained, snapshot: JSON.parse(JSON.stringify(await snapshot(nativeClient))) })) }
  finally { await nativeClient.end() }
  // Production Node consumer starts with provider configuration absent.
  const reservation = createServer(); await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve))
  const port = (reservation.address() as { port: number }).port; await new Promise<void>(resolve => reservation.close(() => resolve()))
  const app = Bun.spawn(['node', '.output/server/index.mjs'], { env: { ...process.env, NITRO_PORT: String(port), NITRO_HOST: '127.0.0.1', MEDUSA_BASE_URL: '', MEDUSA_SECRET_API_KEY: '' }, stdout: 'pipe', stderr: 'pipe' })
  const stdout = new Response(app.stdout).text(), stderr = new Response(app.stderr).text()
  try {
    let ready = false
    for (let i = 0; i < 100; i++) {
      assert.equal(app.exitCode, null)
      try {
        const result = await fetch(`http://127.0.0.1:${port}/api/probe`)
        if (result.status === 503) { assert.deepEqual(await result.json(), { code: 'unconfigured', message: 'Integration is not configured.', retryable: false }); assert.match(result.headers.get('cache-control')!, /no-store/); ready = true; break }
      }
      catch { /* Bounded startup polling. */ }
      await Bun.sleep(100)
    }
    assert(ready)
  }
  finally { app.kill('SIGTERM'); await app.exited; const logs = await stdout + await stderr; assert(!logs.includes('fixture-admin-key')); assert(!logs.includes('PRIVATE-')) }
}
finally { await admin.end() }
