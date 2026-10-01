import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Explicit disposable loopback fixture only; never terminates any other actor's backend.
assert(Bun.argv.includes('--local-fixture'), 'Pass --local-fixture for a disposable PostgreSQL database')
assert(process.env.DATABASE_URL, 'A disposable PostgreSQL database is required')
assert(['localhost', '127.0.0.1', '[::1]'].includes(new URL(process.env.DATABASE_URL).hostname))
const driver = process.env.POSTGRES_PROBE_DRIVER_PATH
  ? resolve(process.env.POSTGRES_PROBE_DRIVER_PATH)
  : fileURLToPath(import.meta.resolve('postgres'))
const version = JSON.parse(await Bun.file(resolve(dirname(driver), '../package.json')).text()).version as string
const artifacts = await mkdtemp(resolve(tmpdir(), 'nuxt-postgres-driver-regressions-'))
const results = []
for (const runtime of ['bun', 'node']) for (const operation of ['backend-loss', 'commit-and-timeout', 'late-transaction']) {
  const child = Bun.spawn([runtime, resolve(import.meta.dirname, `${operation}.mjs`), driver], { env: process.env, stdout: 'pipe', stderr: 'pipe' })
  const stdout = new Response(child.stdout).text(), stderr = new Response(child.stderr).text()
  const deadline = setTimeout(() => child.kill('SIGTERM'), 10_000)
  let exit: number
  try { exit = await child.exited } finally { clearTimeout(deadline) }
  await writeFile(resolve(artifacts, `${runtime}-${operation}.log`), (await stdout) + (await stderr), { mode: 0o600 })
  const result = { version, runtime, operation, outcome: exit === 0 ? 'passed' : 'failed', exit }
  results.push(result)
  console.info(JSON.stringify(result))
}
await writeFile(resolve(artifacts, 'results.json'), JSON.stringify(results), { mode: 0o600 })
console.info(`Private fixture artifacts: ${artifacts}`)
assert(results.every(result => result.exit === 0), 'Official driver regression gate failed')
