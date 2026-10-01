// Proof-only temporary copies; no application installer or provider cleanup.
import assert from 'node:assert/strict'
import { cp, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { createServer } from 'node:net'
const root = process.cwd()
const original = await readFile(join(root, 'server/ops/application.ts'), 'utf8')
const ids = ['jobs', 'storage', 'cache', 'audit', 'webhooks', 'observability']
for (const removed of [...ids, 'all', 'ops']) {
  const directory = await mkdtemp(join(tmpdir(), 'ops-reference-removal-'))
  async function run(command: string[]) {
    const process = Bun.spawn(command, { cwd: directory, env: Bun.env, stdout: 'inherit', stderr: 'inherit' })
    assert.equal(await process.exited, 0, command.join(' '))
  }
  try {
    for (const entry of await readdir(root)) {
      if (['.git', 'node_modules', '.nuxt', '.output', '.data', 'test-results', 'playwright-report', '.env', '.env.local'].includes(entry)) continue
      await cp(join(root, entry), join(directory, entry), { recursive: true, filter: path => !['node_modules', '.nuxt', '.output', '.env', '.env.local'].includes(basename(path)) })
    }
    await symlink(join(root, 'node_modules'), join(directory, 'node_modules'), 'dir')
    let source = original
    const excluded = removed === 'all' ? ids : [removed]
    for (const id of excluded) source = source.replace(new RegExp(`    \\{ id: '${id}',[\\s\\S]*? },?\\n`, 'u'), '')
    if (excluded.includes('storage')) source = source.replace("import { inspectOpsStorage } from './storage'\n", '')
    if (excluded.includes('cache')) source = source.replace("import { getCache } from '@repo/nuxt-cache/server'\n", '')
    if (excluded.includes('jobs') && excluded.includes('webhooks')) source = source.replace("import { inspectOpsJobs } from './jobs'\n", '')
    if (removed === 'ops') {
      await rm(join(directory, 'server/ops'), { recursive: true })
      await rm(join(directory, 'server/plugins/ops-admin.ts'))
      const config = join(directory, 'nuxt.config.ts')
      await writeFile(config, (await readFile(config, 'utf8')).replace(/,?\s*'@repo\/nuxt-ops-admin'/u, '').replace(/\s*opsAdmin: \{[^}]*\},?/u, ''))
      const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'))
      delete manifest.dependencies['@repo/nuxt-ops-admin']
      await writeFile(join(directory, 'package.json'), JSON.stringify(manifest))
    }
    else await writeFile(join(directory, 'server/ops/application.ts'), source)
    await run(['bun', 'run', 'typecheck'])
    await run(['bun', 'run', 'build'])
    const reservation = createServer(); await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve))
    const port = (reservation.address() as { port: number }).port; await new Promise<void>(resolve => reservation.close(() => resolve()))
    const base = `http://127.0.0.1:${port}`
    const app = Bun.spawn(['node', '.output/server/index.mjs'], { cwd: directory, env: { ...Bun.env, NITRO_PORT: String(port), NITRO_HOST: '127.0.0.1', NUXT_DATABASE_URL: Bun.env.DATABASE_URL, NUXT_PUBLIC_APP_BASE_URL: base, OPS_ADMIN_USER_IDS: '' }, stdout: 'ignore', stderr: 'ignore' })
    try {
      let ready = false
      for (let i = 0; i < 100; i++) { assert.equal(app.exitCode, null); try { if ((await fetch(`${base}/api/health`)).ok) { ready = true; break } } catch { /* bounded startup */ } await Bun.sleep(100) }
      assert(ready)
      assert.equal((await fetch(base)).status, 200)
      assert.equal((await fetch(`${base}/api/auth/get-session`)).status, 200)
      assert.equal((await fetch(`${base}/api/ops/summary`)).status, removed === 'ops' ? 404 : 401)
      if (removed === 'ops') assert.equal((await fetch(`${base}/admin/ops`)).status, 404)
      console.info(`[ops-admin] ${removed} removal: typecheck/build/login/session/health passed`)
    }
    finally { app.kill('SIGTERM'); await app.exited }
  }
  finally { await rm(directory, { recursive: true, force: true }) }
}
