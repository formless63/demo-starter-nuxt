import { defineJobRegistry } from '@repo/nuxt-jobs/server'
import { webhookJobs } from '../webhooks/registry'
import { starterEchoJob } from './tasks/starter-echo'

export const jobRegistry = defineJobRegistry(starterEchoJob, webhookJobs.delivery)
