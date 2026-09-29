import { defineJob } from '@wicaso/nuxt-jobs/server'
import { z } from 'zod'

export const fixtureEchoJob = defineJob({
  name: 'fixture.echo',
  payload: z.object({ message: z.string().min(1) }).strict(),
  queue: { retryLimit: 0, deleteAfterSeconds: 60 },
  handler: payload => ({ echoed: payload.message }),
})
