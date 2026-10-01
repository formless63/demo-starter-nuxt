async function run(command: string[], environment: Record<string, string>) {
  console.info(`[jobs fixture] ${command.join(' ')}`)
  const child = Bun.spawn(command, {
    cwd: process.cwd(),
    env: { ...Bun.env, ...environment },
    stdin: 'ignore',
    stdout: 'inherit',
    stderr: 'inherit',
  })
  const exitCode = await child.exited
  if (exitCode !== 0) throw new Error(`${command.join(' ')} exited with ${exitCode}`)
}

const { jobRegistry } = await import('../server/jobs/registry.ts')
if (!jobRegistry['fixture.echo']) throw new Error('Fixture registry extension was not loaded')

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is required for the Jobs package runtime test')
const { verifyJobsContracts } = await import('./contracts')
await verifyJobsContracts(databaseUrl)

const jobsEnvironment = {
  DATABASE_URL: databaseUrl,
  PGBOSS_SCHEMA: `fixture_${crypto.randomUUID().replaceAll('-', '')}`,
}

await run(['bun', 'run', 'jobs:migrate'], jobsEnvironment)
await run(['bun', 'run', 'jobs:doctor'], jobsEnvironment)

const worker = Bun.spawn(['bun', 'run', 'jobs:worker'], {
  cwd: process.cwd(),
  env: { ...Bun.env, ...jobsEnvironment },
  stdin: 'ignore',
  stdout: 'pipe',
  stderr: 'pipe',
})
await Bun.sleep(1_500)
if (worker.exitCode !== null) {
  const output = await new Response(worker.stdout).text()
  const errors = await new Response(worker.stderr).text()
  throw new Error(`Standalone worker exited before readiness:\n${output}${errors}`)
}

worker.kill('SIGTERM')
const [workerExitCode, workerOutput, workerErrors] = await Promise.all([
  worker.exited,
  new Response(worker.stdout).text(),
  new Response(worker.stderr).text(),
])
if (
  workerExitCode !== 0
  || !workerOutput.includes('[jobs] worker started')
  || !workerOutput.includes('[jobs] worker stopped')
) {
  throw new Error(`Standalone worker did not start and stop cleanly:\n${workerOutput}${workerErrors}`)
}

await run(['bun', 'run', 'jobs:smoke'], jobsEnvironment)
console.info('[jobs fixture] registry, migrations, worker, and smoke verification passed')
