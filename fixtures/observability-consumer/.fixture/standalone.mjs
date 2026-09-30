import { captureException, getLogger, initializeObservability, observeOperation, shutdownObservability } from '@repo/nuxt-observability/server'

initializeObservability({ serviceName: 'fixture-worker', redactKeys: ['privateNote'] })
initializeObservability({ serviceName: 'must-not-reinitialize' })
await observeOperation('job', 'fixture.echo', () => {
  getLogger().info({ payload: { message: 'WORKER_PAYLOAD_SECRET' } }, 'worker.running')
}, { jobId: 'worker-job-id' })
try {
  await observeOperation('job', 'fixture.fail', () => {
    throw new Error('WORKER_ERROR_SECRET')
  }, { jobId: 'failed-job-id' })
}
catch { /* Original failure is deliberately preserved. */ }
captureException(new TypeError('STANDALONE_ERROR_SECRET'))
await shutdownObservability()
await shutdownObservability()
