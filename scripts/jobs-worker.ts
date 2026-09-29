import { runJobsWorker } from '@repo/nuxt-jobs/cli'
import { jobRegistry } from '../server/jobs/registry'

await runJobsWorker(jobRegistry)
