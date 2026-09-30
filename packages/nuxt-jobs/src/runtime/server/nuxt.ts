import { useRuntimeConfig } from '#imports'
import type { DrizzleTransactionLike } from 'pg-boss'
import { jobRegistry } from '#jobs-registry'
import { createJobsBoss, resolveJobsConfig } from './boss'
import { defineQueues, sendRegisteredJob, sendRegisteredJobInTransaction } from './client'
import type { JobName, JobPayload } from './types'

let clientPromise: ReturnType<typeof startClient> | undefined

async function startClient() {
  const runtime = useRuntimeConfig().jobs
  const boss = createJobsBoss(resolveJobsConfig(runtime))
  boss.on('error', error => console.error('[jobs] pg-boss error', error))
  await boss.start()
  await defineQueues(boss, jobRegistry)
  return boss
}

export function useJobsBoss() {
  clientPromise ??= startClient()
  return clientPromise
}

export async function stopJobsBoss() {
  if (!clientPromise) return
  const boss = await clientPromise
  clientPromise = undefined
  await boss.stop({ graceful: true, timeout: 30_000 })
}

export async function sendJob<Name extends JobName<typeof jobRegistry>>(
  name: Name,
  payload: JobPayload<typeof jobRegistry, Name>,
) {
  return sendRegisteredJob(await useJobsBoss(), jobRegistry, name, payload)
}

export async function sendJobInTransaction<Name extends JobName<typeof jobRegistry>>(
  transaction: DrizzleTransactionLike,
  name: Name,
  payload: JobPayload<typeof jobRegistry, Name>,
) {
  return sendRegisteredJobInTransaction(await useJobsBoss(), jobRegistry, transaction, name, payload)
}
