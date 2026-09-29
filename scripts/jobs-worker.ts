import { createJobsBoss, resolveJobsConfig } from '../modules/jobs/runtime/server/boss'
import { defineQueues, registerWorkers } from '../modules/jobs/runtime/server/client'
import { jobRegistry } from '../server/jobs/registry'

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
  await defineQueues(boss, jobRegistry)
  await registerWorkers(boss, jobRegistry, config.concurrency)
  console.info(`[jobs] worker started (schema=${config.schema}, concurrency=${config.concurrency}, migrate=false)`)
}
catch (error) {
  fatal(error)
}
