import { runJobsWorker } from '@repo/nuxt-jobs/cli'
import { jobRegistry } from '../server/jobs/registry'
import { captureException, initializeObservability, shutdownObservability } from '@repo/nuxt-observability/server'

initializeObservability({ serviceName: 'nuxt-starter-worker' })
await runJobsWorker(jobRegistry, { onError: captureException, onShutdown: shutdownObservability })
