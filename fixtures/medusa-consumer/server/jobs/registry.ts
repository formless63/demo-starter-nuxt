import { defineJob, defineJobRegistry } from '@repo/nuxt-jobs/server'
import { z } from 'zod'
export const jobRegistry = defineJobRegistry(defineJob({ name: 'fixture.echo', payload: z.object({ value: z.string() }).strict(), handler: payload => ({ value: payload.value }) }))
