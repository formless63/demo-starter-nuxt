import { runJobsSmoke } from '@wicaso/nuxt-jobs/cli'
import { jobRegistry } from '../server/jobs/registry'

const expected = `smoke-${crypto.randomUUID()}`

await runJobsSmoke(jobRegistry, 'starter.echo', { message: expected }, (output) => {
  const result = output as { echoed?: string }
  if (result.echoed !== expected) {
    throw new Error(`Smoke job returned unexpected output: ${JSON.stringify(output)}`)
  }
})
