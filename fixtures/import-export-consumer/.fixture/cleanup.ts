import assert from 'node:assert/strict'
import { readFile, unlink } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
// Builtin-only cleanup survives a failed package reinstall (including registry outages).
const statePath = '.fixture/transfer-survival.json'
let state: { databaseName: string, providers: { project: string }[] } | undefined
try { state = JSON.parse(await readFile(statePath, 'utf8')) }
catch (error) { if ((error as { code?: string }).code !== 'ENOENT') throw error }
async function command(args: string[]) {
  const child = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] })
  const output: Buffer[] = []
  child.stdout.on('data', value => output.push(value)); child.stderr.resume()
  const exit = await new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('exit', resolve) })
  assert.equal(exit, 0, 'Disposable fixture cleanup failed')
  return Buffer.concat(output).toString()
}
if (state) {
  assert.match(state.databaseName, /^transfer_fixture_[a-f0-9]{32}$/)
  for (const fixture of state.providers) {
    assert.match(fixture.project, /^transfer-test-(?:rustfs|garage)-[a-f0-9]{8}$/)
    await command(['compose', '-p', fixture.project, '-f', fileURLToPath(new URL('./compose.yaml', import.meta.url)), '--profile', 'rustfs', '--profile', 'garage', 'down', '--volumes', '--remove-orphans'])
  }
  const admin = new URL(process.env.DATABASE_URL!)
  assert(['localhost', '127.0.0.1', '[::1]'].includes(admin.hostname), 'Fixture PostgreSQL must be local')
  const port = admin.port || '5432'
  const containers = (await command(['ps', '--format', '{{.ID}}|{{.Ports}}'])).trim().split('\n')
  const matching = containers.filter(line => line.includes(`:${port}->5432/tcp`))
  assert.equal(matching.length, 1, 'Identify the exact local PostgreSQL fixture server')
  await command(['exec', matching[0]!.split('|')[0]!, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', decodeURIComponent(admin.username), '-d', 'postgres', '-c', `DROP DATABASE "${state.databaseName}" WITH (FORCE)`])
  await unlink(statePath)
}
