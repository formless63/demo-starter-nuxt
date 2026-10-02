import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Official multi-architecture manifest for 5.13.43, resolved from Docker Hub.
// Its application VERSION.txt is checked again before exercising the API.
const image = 'invoiceninja/invoiceninja-debian@sha256:c052414958dce9bb186f3da83c8066c84d419092e7a55025b5a7c201eff75387'
const suffix = randomUUID().replaceAll('-', '')
const network = `invoice-native-${suffix}`, database = `${network}-db`, app = `${network}-app`
const token = randomBytes(32).toString('hex')
const temporary = await mkdtemp(join(tmpdir(), 'invoice-native-wire-'))
function docker(args: string[], timeout = 180_000) {
  const result = spawnSync('docker', args, { encoding: 'utf8', timeout, maxBuffer: 4 * 1024 * 1024 })
  // Never echo command arguments, environment values, provider bodies or tokens.
  if (result.status !== 0) throw new Error(`Native Invoice Ninja fixture Docker ${args[0]} failed (exit ${result.status ?? 'unavailable'})`)
  return result.stdout.trim()
}
async function waitFor(check: () => boolean | Promise<boolean>, label: string, milliseconds = 120_000) {
  const end = Date.now() + milliseconds
  while (Date.now() < end) {
    try { if (await check()) return } catch { /* startup readiness only */ }
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  throw new Error(`Native Invoice Ninja fixture ${label} did not become ready`)
}
try {
  docker(['version', '--format', '{{.Server.Version}}'], 15_000)
  docker(['pull', image], 300_000)
  docker(['pull', 'mariadb:11.8'], 300_000)
  docker(['pull', 'node:24-alpine'], 300_000)
  docker(['network', 'create', '--internal', network])
  docker(['run', '-d', '--name', database, '--network', network,
    '-e', 'MARIADB_ROOT_PASSWORD=disposable-root', '-e', 'MARIADB_DATABASE=ninja',
    '-e', 'MARIADB_USER=ninja', '-e', 'MARIADB_PASSWORD=disposable-database', 'mariadb:11.8'])
  await waitFor(() => {
    const r = spawnSync('docker', ['exec', database, 'mariadb-admin', 'ping', '-h', '127.0.0.1', '-uninja', '-pdisposable-database', '--silent'], { stdio: 'ignore', timeout: 5000 })
    return r.status === 0
  }, 'database')
  const environment: Record<string, string> = {
    APP_ENV: 'testing', APP_DEBUG: 'false', APP_URL: 'http://127.0.0.1:8000',
    APP_KEY: `base64:${randomBytes(32).toString('base64')}`,
    DB_CONNECTION: 'mysql', DB_HOST: database, DB_PORT: '3306', DB_DATABASE: 'ninja',
    DB_USERNAME: 'ninja', DB_PASSWORD: 'disposable-database',
    DB_HOST1: database, DB_PORT1: '3306', DB_DATABASE1: 'ninja', DB_USERNAME1: 'ninja', DB_PASSWORD1: 'disposable-database',
    MULTI_DB_ENABLED: 'false', CACHE_DRIVER: 'file', CACHE_STORE: 'file', SESSION_DRIVER: 'file',
    QUEUE_CONNECTION: 'sync', MAIL_MAILER: 'log', BROADCAST_DRIVER: 'log',
    NINJA_ENVIRONMENT: 'selfhost', REQUIRE_HTTPS: 'false', GS_DISPOSABLE_PROVIDER: '1', GS_FIXTURE_TOKEN: token,
  }
  docker(['run', '-d', '--name', app, '--network', network,
    ...Object.entries(environment).flatMap(([key, value]) => ['-e', `${key}=${value}`]),
    '--entrypoint', 'sh', image, '-c', 'sleep infinity'])
  const version = docker(['exec', app, 'cat', '/var/www/html/VERSION.txt'])
  assert.equal(version.replace(/^v/, ''), '5.13.43')
  docker(['exec', app, 'sh', '-c', 'mkdir -p public storage/framework/cache storage/framework/sessions storage/framework/views storage/logs; if [ ! -f public/index.php ]; then cp -a /tmp/public/. public/; fi'])
  docker(['exec', app, 'php', 'artisan', 'config:clear'])
  docker(['exec', app, 'php', 'artisan', 'migrate', '--force'], 300_000)
  docker(['exec', app, 'php', 'artisan', 'db:seed', '--force'], 300_000)
  for (const name of ['provider-seed.php', 'provider-proof.php']) docker(['cp', fileURLToPath(new URL(name, import.meta.url)), `${app}:/var/www/html/${name}`])
  const seeded = JSON.parse(docker(['exec', app, 'php', '/var/www/html/provider-seed.php'])) as { clientId: string }
  assert.equal(typeof seeded.clientId, 'string')
  docker(['exec', '-d', app, 'php', 'artisan', 'serve', '--host=127.0.0.1', '--port=8000', '--no-reload'])
  await waitFor(() => {
    const r = spawnSync('docker', ['exec', app, 'php', '-r', "exit(@file_get_contents('http://127.0.0.1:8000/health') === false ? 1 : 0);"], { stdio: 'ignore', timeout: 5000 })
    return r.status === 0
  }, 'API')
  const bundle = join(temporary, 'wire.mjs')
  const built = spawnSync('bun', ['build', fileURLToPath(new URL('provider-wire.ts', import.meta.url)), '--target=node', '--outfile', bundle], { stdio: 'pipe', timeout: 60_000 })
  assert.equal(built.status, 0, 'Native provider wire bundle builds')
  docker(['run', '--rm', '--network', `container:${app}`, '-v', `${bundle}:/fixture.mjs:ro`,
    '-e', 'NODE_ENV=test', '-e', `GS_CLIENT_ID=${seeded.clientId}`, '-e', `GS_FIXTURE_TOKEN=${token}`,
    'node:24-alpine', 'node', '/fixture.mjs'])
  const proof = JSON.parse(docker(['exec', app, 'php', '/var/www/html/provider-proof.php']))
  assert.deepEqual(proof, { unsent: true, numericStringsAccepted: true, invoices: 1, payments: 0 })
  console.info('Actual Invoice Ninja 5.13.43: numeric-string native draft/GET and isolated unsent zero-tax/discount policy passed; no remote account or payment certification')
}
finally {
  for (const name of [app, database]) spawnSync('docker', ['rm', '-f', '-v', name], { stdio: 'ignore', timeout: 30_000 })
  spawnSync('docker', ['network', 'rm', network], { stdio: 'ignore', timeout: 30_000 })
  await rm(temporary, { recursive: true, force: true })
}
