import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

interface Service {
  image: string
  build?: unknown
  environment: Record<string, string>
  depends_on: Record<string, { condition: string }>
  volumes?: string[]
  ports: string[]
}
interface Step { uses?: string, run?: string, with: Record<string, string | boolean> }
interface Job { if: string, needs: string[], permissions: Record<string, string>, steps: Step[] }
interface Catalog { capabilities: Array<{ status: string, defaultInstalled: boolean }>, referenceApplication: { enabledCapabilities: string[] } }

const compose = Bun.YAML.parse(readFileSync('compose.preview.yaml', 'utf8')) as { services: Record<string, Service> }
const workflow = Bun.YAML.parse(readFileSync('.github/workflows/ci.yml', 'utf8')) as { jobs: Record<string, Job> }
const catalog = JSON.parse(readFileSync('capabilities/catalog.json', 'utf8')) as Catalog

test('preview uses one published image for app, worker and explicit migrations', () => {
  for (const service of ['app', 'worker', 'migrate']) {
    expect(compose.services[service]!.image).toBe(compose.services.app!.image)
    expect(compose.services[service]!.build).toBeUndefined()
    expect(compose.services[service]!.environment.DATABASE_URL).toContain('PREVIEW_DB_PASSWORD:?')
  }
  for (const service of ['app', 'worker']) {
    expect(compose.services[service]!.depends_on.migrate!.condition).toBe('service_completed_successfully')
  }
  expect(compose.services.migrate!.command.join(' ')).toContain('&&')
  expect(compose.services.postgres!.volumes).toContain('postgres-data:/var/lib/postgresql')
  expect(compose.services.postgres!.ports).toBeUndefined()
  for (const service of ['app', 'mailpit']) expect(compose.services[service]!.ports[0]).toContain('PREVIEW_BIND:-127.0.0.1')
  expect(compose.services.mailpit!.ports).toHaveLength(1)
  const auth = compose.services.app!.environment.BETTER_AUTH_SECRET ?? compose.services.app!.environment.NUXT_AUTH_SECRET
  expect(auth).toContain('PREVIEW_AUTH_SECRET:?')
  expect(compose.services.app!.environment.SMTP_HOST).toBe('mailpit')
  expect(catalog.capabilities).toHaveLength(29)
  expect(catalog.referenceApplication.enabledCapabilities.length).toBe(29)
  expect(catalog.capabilities.every(entry => entry.status === 'done' && entry.defaultInstalled === false)).toBe(true)
})

test('GHCR publishing is main-push-only and waits for every existing acceptance job', () => {
  const job = workflow.jobs['publish-preview']!
  expect(job.if).toBe("github.event_name == 'push' && github.ref == 'refs/heads/main'")
  expect(job.needs).toEqual(workflow.jobs.verify ? ['verify', 'custom-add-ons'] : ['check', 'package-test'])
  expect(job.permissions).toEqual({ contents: 'read', packages: 'write' })
  const build = job.steps.find(step => step.uses?.startsWith('docker/build-push-action@'))!
  expect(build.with.platforms).toBe('linux/amd64')
  expect(build.with.push).toBe(true)
  expect(build.with.tags).toContain(':sha-${{ github.sha }}')
  expect(build.with.labels).toContain('org.opencontainers.image.source=')
  const verify = (workflow.jobs.verify ?? workflow.jobs.check)!
  expect(verify.steps.some(step => step.run === 'node scripts/preview-smoke.mjs')).toBe(true)
  for (const step of job.steps.filter(step => step.uses?.startsWith('docker/'))) expect(step.uses).toMatch(/@[a-f0-9]{40}$/)
})
