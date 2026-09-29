import { runJobsWorker } from '@wicaso/nuxt-jobs/cli'
import { jobRegistry } from '../server/jobs/registry'

await runJobsWorker(jobRegistry)
