import { createJobsBoss, resolveJobsConfig } from '../modules/jobs/runtime/server/boss'
import { defineQueues, registerWorkers, sendRegisteredJob } from '../modules/jobs/runtime/server/client'
import { jobRegistry } from '../server/jobs/registry'

const config = resolveJobsConfig()
const boss = createJobsBoss(config)
const expected = `smoke-${crypto.randomUUID()}`

try {
  await boss.start()
  await defineQueues(boss, jobRegistry)
  await registerWorkers(boss, jobRegistry, 1)
  const id = await sendRegisteredJob(boss, jobRegistry, 'starter.echo', { message: expected })
  const deadline = Date.now() + 15_000

  while (Date.now() < deadline) {
    const job = await boss.getJobById<{ message: string }>('starter.echo', id)
    if (job?.state === 'failed') throw new Error(`Smoke job ${id} failed: ${JSON.stringify(job.output)}`)
    if (job?.state === 'completed') {
      const output = job.output as { echoed?: string }
      if (output.echoed !== expected) {
        throw new Error(`Smoke job ${id} returned unexpected output: ${JSON.stringify(job.output)}`)
      }
      console.info(`[jobs] smoke job ${id} completed with verified output`)
      break
    }
    await new Promise(resolve => setTimeout(resolve, 100))
  }

  const completed = await boss.getJobById('starter.echo', id)
  if (completed?.state !== 'completed') throw new Error(`Smoke job ${id} did not complete within 15 seconds`)
}
finally {
  await boss.stop({ graceful: true, timeout: 30_000 })
}
