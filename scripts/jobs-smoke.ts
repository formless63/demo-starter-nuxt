import { runJobsSmoke } from '@repo/nuxt-jobs/cli'
import { jobRegistry } from '../server/jobs/registry'
import { shutdownObservability } from '@repo/nuxt-observability/server'

const expected = `smoke-${crypto.randomUUID()}`

try {
  await runJobsSmoke(jobRegistry, 'starter.echo', { message: expected }, (output) => {
    const result = output as { echoed?: string }
    if (result.echoed !== expected) {
      throw new Error(`Smoke job returned unexpected output: ${JSON.stringify(output)}`)
    }
  })
}
finally { await shutdownObservability() }
