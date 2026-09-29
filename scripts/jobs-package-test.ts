import { access, cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'

const root = process.cwd()
const packageRoot = resolve(root, 'packages/nuxt-jobs')
const fixtureRoot = resolve(root, 'fixtures/jobs-consumer')
const temporaryRoot = await mkdtemp(join(tmpdir(), 'nuxt-jobs-install-'))
const packRoot = join(temporaryRoot, 'package')
const consumerRoot = join(temporaryRoot, 'consumer')

async function run(command: string[], cwd: string, environment: Record<string, string> = {}) {
  console.info(`[jobs package] ${command.join(' ')}`)
  const process = Bun.spawn(command, {
    cwd,
    env: { ...Bun.env, ...environment },
    stdin: 'ignore',
    stdout: 'inherit',
    stderr: 'inherit',
  })
  const exitCode = await process.exited
  if (exitCode !== 0) throw new Error(`${command.join(' ')} exited with ${exitCode}`)
}

async function exists(path: string) {
  try {
    await access(path)
    return true
  }
  catch {
    return false
  }
}

try {
  await mkdir(packRoot)
  await run(['bun', 'pm', 'pack', '--destination', packRoot], packageRoot)
  const archiveName = (await readdir(packRoot)).find(file => file.endsWith('.tgz'))
  if (!archiveName) throw new Error('Jobs package build did not produce a tarball')
  const archivePath = join(packRoot, archiveName)

  await cp(fixtureRoot, consumerRoot, {
    recursive: true,
    filter: source => !['node_modules', '.nuxt', '.output'].includes(basename(source)),
  })

  const manifestPath = join(consumerRoot, 'package.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  manifest.dependencies['@wicaso/nuxt-jobs'] = `file:${archivePath}`
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

  await run(['bun', 'install'], consumerRoot)
  if (!await exists(join(consumerRoot, 'node_modules/@wicaso/nuxt-jobs/dist/module.mjs'))) {
    throw new Error('Packed Jobs Nuxt module was not installed')
  }
  if (!await exists(join(consumerRoot, 'node_modules/pg-boss/package.json'))) {
    throw new Error('pg-boss did not arrive with the Jobs package')
  }

  await run([
    'bun', '-e',
    "const { jobRegistry } = await import('./server/jobs/registry.ts'); if (!jobRegistry['fixture.echo']) process.exit(1)",
  ], consumerRoot)
  await run(['bun', 'run', 'typecheck'], consumerRoot)
  await run(['bun', 'run', 'build'], consumerRoot)

  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) throw new Error('DATABASE_URL is required for the Jobs package integration test')
  const jobsEnvironment = {
    DATABASE_URL: databaseUrl,
    PGBOSS_SCHEMA: `fixture_${crypto.randomUUID().replaceAll('-', '')}`,
  }
  await run(['bun', 'run', 'jobs:migrate'], consumerRoot, jobsEnvironment)
  await run(['bun', 'run', 'jobs:doctor'], consumerRoot, jobsEnvironment)

  const worker = Bun.spawn(['bun', 'run', 'jobs:worker'], {
    cwd: consumerRoot,
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
  if (workerExitCode !== 0 || !workerOutput.includes('[jobs] worker started') || !workerOutput.includes('[jobs] worker stopped')) {
    throw new Error(`Standalone worker did not start and stop cleanly:\n${workerOutput}${workerErrors}`)
  }

  await run(['bun', 'run', 'jobs:smoke'], consumerRoot, jobsEnvironment)

  await run(['bun', 'remove', '@wicaso/nuxt-jobs'], consumerRoot)
  const removedManifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  const removedScripts = new Set(['jobs:migrate', 'jobs:doctor', 'jobs:worker', 'jobs:smoke'])
  removedManifest.scripts = Object.fromEntries(
    Object.entries(removedManifest.scripts).filter(([script]) => !removedScripts.has(script)),
  )
  await writeFile(manifestPath, `${JSON.stringify(removedManifest, null, 2)}\n`)
  await cp(join(consumerRoot, '.fixture/base-nuxt.config.ts'), join(consumerRoot, 'nuxt.config.ts'))
  await rm(join(consumerRoot, 'server/jobs'), { recursive: true, force: true })
  await rm(join(consumerRoot, 'server/api/jobs.post.ts'), { force: true })
  await rm(join(consumerRoot, '.nuxt'), { recursive: true, force: true })
  await rm(join(consumerRoot, '.output'), { recursive: true, force: true })
  await rm(join(consumerRoot, 'node_modules'), { recursive: true, force: true })
  await run(['bun', 'install', '--frozen-lockfile'], consumerRoot)

  if (await exists(join(consumerRoot, 'node_modules/@wicaso/nuxt-jobs'))) {
    throw new Error('Jobs package remained after removal')
  }
  if (await exists(join(consumerRoot, 'node_modules/pg-boss'))) {
    throw new Error('Capability-owned pg-boss dependency remained after removal')
  }
  await run(['bun', 'run', 'typecheck'], consumerRoot)
  await run(['bun', 'run', 'build'], consumerRoot)

  console.info('[jobs package] clean install, runtime, and removal verification passed')
}
finally {
  await rm(temporaryRoot, { recursive: true, force: true })
}
