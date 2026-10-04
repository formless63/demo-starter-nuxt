// Test-only application composition in the existing authenticated baseline fixture.
// Generic packages:test remains responsible for tarball installation/removal.
import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { createServer as createHttpServer } from 'node:http'
import { createHmac } from 'node:crypto'
import pg from 'pg'
import { jobRegistry } from '../../../server/jobs/registry'
import { webhookJobs } from '../../../server/webhooks/registry'

const root = process.cwd()
const fixture = join(root, 'fixtures/ops-admin-consumer')
const original = await readFile(join(root, 'server/ops/application.ts'), 'utf8')
const secret = 'ops-removal-disposable-auth-secret-32-characters'
const user = `ops_removal_${crypto.randomUUID()}`, token = crypto.randomUUID()
const sql = new pg.Pool({ connectionString: Bun.env.DATABASE_URL!, max: 1 })
sql.on('error', () => {})
await sql.query(`INSERT INTO "user" (id,name,email) VALUES ($1,'Removal fixture',$2)`, [user, user + '@example.test'])
await sql.query(`INSERT INTO session (id,token,user_id,expires_at) VALUES ($1,$2,$3,now()+interval '1 hour')`, [crypto.randomUUID(), token, user])
const signature = createHmac('sha256', secret).update(token).digest('base64')
const headers = { cookie: `better-auth.session_token=${encodeURIComponent(`${token}.${signature}`)}` }
const providers = {
  jobs: '@repo/nuxt-jobs', storage: '@repo/nuxt-storage', cache: '@repo/nuxt-cache',
  audit: '@repo/nuxt-audit-log', webhooks: '@repo/nuxt-webhooks', observability: '@repo/nuxt-observability',
}
const ids = Object.keys(providers) as (keyof typeof providers)[]
let collectorCalls = 0
const collector = createHttpServer((_request, response) => { collectorCalls++; response.writeHead(204); response.end() })
await new Promise<void>(resolve => collector.listen(0, '127.0.0.1', resolve))
const collectorUrl = `http://127.0.0.1:${(collector.address() as { port: number }).port}/private-fixture-collector`
try {
  for (const removed of [...ids, 'all', 'ops']) {
    const directory = await mkdtemp(join(tmpdir(), 'ops-provider-removal-'))
    async function run(command: string[]) {
      const child = Bun.spawn(command, { cwd: directory, env: Bun.env, stdout: 'inherit', stderr: 'inherit' })
      assert.equal(await child.exited, 0, command.join(' '))
    }
    try {
      await cp(fixture, directory, { recursive: true, filter: path => !['node_modules', '.nuxt', '.output', '.env', '.env.local'].includes(basename(path)) })
      // Copy the actual root Ops helpers and separate shutdown composition.
      await cp(join(root, 'server/ops'), join(directory, 'server/ops'), { recursive: true })
      await mkdir(join(directory, 'server/plugins'), { recursive: true })
      for (const name of ['ops-admin-jobs.ts', 'ops-admin-storage.ts']) await cp(join(root, 'server/plugins', name), join(directory, 'server/plugins', name))
      // App-owned registered metadata is copied without unrelated product handlers.
      // Values come from the actual root registrations, never provider discovery.
      await mkdir(join(directory, 'server/jobs'), { recursive: true })
      await mkdir(join(directory, 'server/webhooks'), { recursive: true })
      await writeFile(join(directory, 'server/jobs/registry.ts'), `export const jobRegistry = ${JSON.stringify(Object.fromEntries(Object.entries(jobRegistry).map(([key, job]) => [key, { name: job.name }])))}\n`)
      await writeFile(join(directory, 'server/webhooks/registry.ts'), `export const webhookJobs = { delivery: { name: ${JSON.stringify(webhookJobs.delivery.name)} } }\n`)

      // Removing Jobs also removes its hard-dependent Webhooks integration.
      const excluded = removed === 'all' || removed === 'ops' ? ids : removed === 'jobs' ? ['jobs', 'webhooks'] : [removed]
      const unavailable: string[] = excluded.map(id => providers[id as keyof typeof providers])
      if (removed === 'ops') unavailable.push('@repo/nuxt-ops-admin')
      const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'))
      for (const name of Object.values(providers)) if (!unavailable.includes(name)) manifest.dependencies[name] = 'workspace:*'
      manifest.dependencies = Object.fromEntries(Object.entries(manifest.dependencies).filter(([name]) => !unavailable.includes(name)))
      await writeFile(join(directory, 'package.json'), JSON.stringify(manifest))
      // Isolated dependency visibility: do not symlink the whole root node_modules.
      // Excluded packages cannot resolve from this app, even though the reference
      // checkout retains them. Public vendor deps remain ordinary shared tooling.
      await mkdir(join(directory, 'node_modules/@repo'), { recursive: true })
      for (const name of await readdir(join(root, 'node_modules'))) {
        if (['@repo', '.cache'].includes(name)) continue
        await symlink(join(root, 'node_modules', name), join(directory, 'node_modules', name), 'dir')
      }
      for (const name of ['@repo/nuxt-ops-admin', ...Object.values(providers)]) {
        if (unavailable.includes(name)) continue
        await symlink(join(root, 'node_modules', name), join(directory, 'node_modules', name), 'dir')
      }
      const requireFromApp = createRequire(join(directory, 'package.json'))
      for (const name of unavailable) assert.throws(() => requireFromApp.resolve(`${name}/server`), { code: 'MODULE_NOT_FOUND' })

      let source = original
      for (const id of excluded) source = source.replace(new RegExp(`    \\{ id: '${id}',[\\s\\S]*? \\},?\\n`, 'u'), '')
      if (excluded.includes('webhooks')) {
        source = source.replace("import { webhookJobs } from '../webhooks/registry'\n", '')
        await rm(join(directory, 'server/webhooks'), { recursive: true })
      }
      if (excluded.includes('storage')) {
        source = source.replace("import { inspectOpsStorage } from './storage'\n", '')
        await rm(join(directory, 'server/ops/storage.ts'))
        await rm(join(directory, 'server/plugins/ops-admin-storage.ts'))
      }
      if (excluded.includes('cache')) source = source.replace("import { getCache } from '@repo/nuxt-cache/server'\n", '')
      if (excluded.includes('observability')) source = source.replace("import { getObservabilityStatus } from '@repo/nuxt-observability/server'\n", '')
      if (excluded.includes('jobs')) {
        source = source.replace("import { inspectOpsJobs } from './jobs'\n", '')
        await rm(join(directory, 'server/ops/jobs.ts'))
        await rm(join(directory, 'server/plugins/ops-admin-jobs.ts'))
        await rm(join(directory, 'server/jobs'), { recursive: true })
      }
      if (removed === 'ops') {
        await rm(join(directory, 'server/ops'), { recursive: true })
        await rm(join(directory, 'server/plugins'), { recursive: true })
        await cp(join(fixture, '.fixture/base-nuxt.config.ts'), join(directory, 'nuxt.config.ts'))
      }
      else await writeFile(join(directory, 'server/ops/application.ts'), source)
      await run(['bun', 'run', 'typecheck'])
      await run(['bun', 'run', 'build'])
      const reservation = createServer(); await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve))
      const port = (reservation.address() as { port: number }).port; await new Promise<void>(resolve => reservation.close(() => resolve()))
      const base = `http://127.0.0.1:${port}`
      const app = Bun.spawn(['node', '.output/server/index.mjs'], { cwd: directory, env: { ...Bun.env, NITRO_PORT: String(port), NITRO_HOST: '127.0.0.1', DATABASE_URL: '', PGBOSS_DATABASE_URL: '', STORAGE_BUCKET: '', CACHE_URL: '', NUXT_DATABASE_URL: Bun.env.DATABASE_URL, NUXT_PUBLIC_APP_BASE_URL: base, NUXT_AUTH_SECRET: secret, OPS_ADMIN_USER_IDS: user, OTEL_SDK_DISABLED: 'true', OTEL_EXPORTER_OTLP_ENDPOINT: collectorUrl }, stdout: 'pipe', stderr: 'pipe' })
      try {
        let ready = false
        for (let i = 0; i < 100; i++) { assert.equal(app.exitCode, null); try { if ((await fetch(`${base}/api/health`)).ok) { ready = true; break } } catch { /* bounded startup */ } await Bun.sleep(100) }
        assert(ready)
        assert.equal((await fetch(base)).status, 200)
        const session = await fetch(`${base}/api/auth/get-session`, { headers })
        assert.equal(session.status, 200); assert.equal((await session.json()).user.id, user)
        assert.equal((await fetch(`${base}/api/ops/summary`)).status, removed === 'ops' ? 404 : 401)
        if (removed !== 'ops') {
          const response = await fetch(`${base}/api/ops/summary`, { headers }); assert.equal(response.status, 200)
          const summary = await response.json()
          assert.deepEqual(summary.adapters.map((card: { id: string }) => card.id), ids.filter(id => !excluded.includes(id)))
          if (!excluded.includes('observability')) assert.deepEqual(summary.adapters.find((card: { id: string }) => card.id === 'observability').counts, { enabled: 0 })
          assert(!JSON.stringify(summary).includes(collectorUrl)); assert(!JSON.stringify(summary).includes('exporting'))
          const html = await (await fetch(`${base}/admin/ops`, { headers })).text(); assert(!html.includes(collectorUrl))
        }
        else assert.equal((await fetch(`${base}/admin/ops`)).status, 404)
        assert.equal(collectorCalls, 0)
        console.info(`[ops-admin] ${removed} package unavailable: root Ops composition typecheck/build/access/baseline session/login/health passed; disabled instrumentation0/no collector contact`)
      }
      finally {
        app.kill('SIGTERM'); await app.exited
        const logs = await new Response(app.stdout).text() + await new Response(app.stderr).text()
        assert(!logs.includes(collectorUrl)); assert.equal(collectorCalls, 0)
      }
    }
    finally { await rm(directory, { recursive: true, force: true }) }
  }
}
finally {
  await new Promise<void>(resolve => collector.close(() => resolve()))
  await sql.query(`DELETE FROM "user" WHERE id=$1`, [user]); await sql.end()
}
