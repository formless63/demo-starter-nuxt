import { useRuntimeConfig } from '#imports'
import type { DrizzleTransactionLike } from 'pg-boss'
import { jobRegistry } from '#jobs-registry'
import { resolveJobsConfig } from './boss'
import { sendRegisteredJob, sendRegisteredJobInTransaction } from './client'
import { createJobsClient } from './lifecycle'
import type { JobName, JobPayload } from './types'

const client = createJobsClient(jobRegistry, () => resolveJobsConfig(useRuntimeConfig().jobs))
export const useJobsBoss = client.use
export const stopJobsBoss = client.stop

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
