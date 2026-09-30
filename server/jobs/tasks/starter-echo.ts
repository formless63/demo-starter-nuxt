import { z } from 'zod'
import { defineJob } from '@repo/nuxt-jobs/server'
import { observeOperation } from '@repo/nuxt-observability/server'

/** Demonstration task. Remove this when the application adds its first real job. */
export const starterEchoJob = defineJob({
  name: 'starter.echo',
  payload: z.object({ message: z.string().trim().min(1).max(500) }).strict(),
  queue: { retryLimit: 0, deleteAfterSeconds: 3600 },
  handler: (payload, context) => observeOperation('job', 'starter.echo',
    () => ({ echoed: payload.message }), { jobId: context.id }),
})
