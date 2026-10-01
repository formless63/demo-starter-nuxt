// @vitest-environment node
import { execFileSync } from 'node:child_process'
import { expect, it } from 'vitest'

function renderedCompose(concurrency?: string) {
  // Ignore local .env and provide only disposable render-time configuration.
  const env = { PATH: process.env.PATH, NUXT_AUTH_SECRET: 'compose-render-test-secret-thirty-two-characters', ...(concurrency === undefined ? {} : { JOBS_CONCURRENCY: concurrency }) }
  return JSON.parse(execFileSync('docker', ['compose', '--env-file', '/dev/null', '-f', 'compose.yaml', 'config', '--format', 'json'], { env, encoding: 'utf8' }))
}
it('renders canonical worker concurrency with unset environment and preserves explicit override', () => {
  expect(renderedCompose().services.worker.environment.JOBS_CONCURRENCY).toBe('4')
  expect(renderedCompose('7').services.worker.environment.JOBS_CONCURRENCY).toBe('7')
})
