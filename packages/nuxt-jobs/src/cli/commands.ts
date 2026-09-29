import { resolve } from 'node:path'
import { createJiti } from 'jiti'
import { createJobsBoss, resolveJobsConfig } from '../runtime/server/boss'
import { defineQueues, registerWorkers, sendRegisteredJob } from '../runtime/server/client'
import type { JobName, JobPayload, JobRegistry } from '../runtime/server/types'

export async function runJobsMigration() {
  const config = resolveJobsConfig()
  const boss = createJobsBoss(config, true)

  try {
    await boss.start()
    console.info(`[jobs] pg-boss schema ${config.schema} migrated successfully`)
  }
  finally {
    await boss.stop({ graceful: false })
  }
}

export async function runJobsDoctor() {
  const config = resolveJobsConfig()
  const boss = createJobsBoss(config)

  try {
    await boss.start()
    const report = await boss.detectSchemaDrift()
    if (!report.ok) {
      throw new Error(`pg-boss schema drift detected: ${JSON.stringify(report, null, 2)}`)
    }
    console.info(`[jobs] pg-boss schema ${config.schema} is current`)
  }
  finally {
    await boss.stop({ graceful: false })
  }
}

export async function runJobsWorker(registry: JobRegistry) {
  const config = resolveJobsConfig()
  const boss = createJobsBoss(config)
  let stopping = false

  boss.on('error', error => console.error('[jobs] pg-boss error', error))

  async function stop(signal: string) {
    if (stopping) return
    stopping = true
    console.info(`[jobs] ${signal} received; stopping worker`)
    await boss.stop({ graceful: true, timeout: 30_000 })
    console.info('[jobs] worker stopped')
  }

  function fatal(error: unknown): never {
    console.error('[jobs] fatal worker error', error)
    process.exit(1)
  }

  process.once('SIGTERM', () => void stop('SIGTERM').catch(fatal))
  process.once('SIGINT', () => void stop('SIGINT').catch(fatal))

  try {
    await boss.start()
    await defineQueues(boss, registry)
    await registerWorkers(boss, registry, config.concurrency)
    console.info(`[jobs] worker started (schema=${config.schema}, concurrency=${config.concurrency}, migrate=false)`)
  }
  catch (error) {
    fatal(error)
  }
}

export async function runJobsSmoke<Registry extends JobRegistry, Name extends JobName<Registry>>(
  registry: Registry,
  name: Name,
  payload: JobPayload<Registry, Name>,
  verifyOutput?: (output: unknown) => void | Promise<void>,
) {
  const config = resolveJobsConfig()
  const boss = createJobsBoss(config)
  const definition = registry[name]
  if (!definition) throw new Error(`Unknown smoke job: ${String(name)}`)

  try {
    await boss.start()
    await defineQueues(boss, registry)
    await registerWorkers(boss, registry, 1)
    const id = await sendRegisteredJob(boss, registry, name, payload)
    const deadline = Date.now() + 15_000

    while (Date.now() < deadline) {
      const job = await boss.getJobById(definition.name, id)
      if (job?.state === 'failed') throw new Error(`Smoke job ${id} failed: ${JSON.stringify(job.output)}`)
      if (job?.state === 'completed') {
        await verifyOutput?.(job.output)
        console.info(`[jobs] smoke job ${id} completed with verified execution`)
        return
      }
      await new Promise(resolve => setTimeout(resolve, 100))
    }

    throw new Error(`Smoke job ${id} did not complete within 15 seconds`)
  }
  finally {
    await boss.stop({ graceful: true, timeout: 30_000 })
  }
}

interface RegistryModule {
  default?: JobRegistry
  jobRegistry?: JobRegistry
}

async function loadRegistry(path: string) {
  const absolutePath = resolve(process.cwd(), path)
  const module = await createJiti(import.meta.url, { interopDefault: false }).import<RegistryModule>(absolutePath)
  const registry = module.jobRegistry ?? module.default
  if (!registry) throw new Error(`Jobs registry ${absolutePath} must export jobRegistry or a default registry`)
  return registry
}

function registryPath(args: string[]) {
  const index = args.indexOf('--registry')
  if (index >= 0 && args[index + 1]) return args[index + 1]
  const inline = args.find(argument => argument.startsWith('--registry='))
  return inline?.slice('--registry='.length) || process.env.JOBS_REGISTRY || 'server/jobs/registry.ts'
}

function option(args: string[], name: string) {
  const index = args.indexOf(name)
  if (index >= 0 && args[index + 1]) return args[index + 1]
  const inline = args.find(argument => argument.startsWith(`${name}=`))
  return inline?.slice(name.length + 1)
}

export async function runJobsCli(args = process.argv.slice(2)) {
  const [command] = args
  if (command === 'migrate') return runJobsMigration()
  if (command === 'doctor') return runJobsDoctor()
  if (command === 'worker') return runJobsWorker(await loadRegistry(registryPath(args)))
  if (command === 'smoke') {
    const registry = await loadRegistry(registryPath(args))
    const name = option(args, '--job')
    const payload = option(args, '--payload')
    if (!name || !payload) throw new Error('smoke requires --job and a JSON --payload')
    return runJobsSmoke(registry, name, JSON.parse(payload))
  }

  throw new Error('Usage: nuxt-jobs <worker|migrate|doctor|smoke> [--registry path] [--job name --payload JSON]')
}
