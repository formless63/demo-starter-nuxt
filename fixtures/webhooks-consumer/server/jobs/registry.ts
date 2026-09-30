import { defineJob, defineJobRegistry } from '@repo/nuxt-jobs/server'
import { z } from 'zod'

export const retainedJob = defineJob({ name: 'fixture.retained', payload: z.object({ message: z.string() }), handler: data => data })
export const jobRegistry = defineJobRegistry(retainedJob)
