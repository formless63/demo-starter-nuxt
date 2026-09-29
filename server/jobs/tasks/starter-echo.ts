import { z } from 'zod'
import { defineJob } from '../../../modules/jobs/runtime/server/registry'

/** Demonstration task. Remove this when the application adds its first real job. */
export const starterEchoJob = defineJob({
  name: 'starter.echo',
  payload: z.object({ message: z.string().trim().min(1).max(500) }).strict(),
  queue: { retryLimit: 0, deleteAfterSeconds: 3600 },
  handler: payload => ({ echoed: payload.message }),
})
