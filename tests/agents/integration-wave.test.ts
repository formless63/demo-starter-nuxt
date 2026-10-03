import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const root = resolve(import.meta.dir, '../..')
const catalog = JSON.parse(readFileSync(resolve(root, 'capabilities/catalog.json'), 'utf8'))
const completed = ['jobs', 'api-platform', 'observability', 'object-storage', 'email', 'webhooks', 'audit-log', 'cache-coordination', 'realtime', 'notifications', 'search', 'ai', 'import-export', 'ops-admin', 'invoice-ninja', 'stripe', 'medusa', 'data-table', 'charts-visualization', 'command-system', 'markdown-code', 'rich-text', 'file-ui', 'flow-canvas', 'internationalization']

test('all twenty-five completed packages are explicitly enabled and discovered by the generic matrix', () => {
  const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
  const nuxt = readFileSync(resolve(root, 'nuxt.config.ts'), 'utf8')
  expect(catalog.capabilities.filter((entry: { status: string }) => entry.status === 'done').map((entry: { id: string }) => entry.id).sort()).toEqual([...completed].sort())
  expect(completed).toHaveLength(25)
  expect([...catalog.referenceApplication.enabledCapabilities].sort()).toEqual([...completed].sort())
  for (const id of [...completed]) {
    const entry = catalog.capabilities.find((candidate: { id: string }) => candidate.id === id)
    expect(entry.defaultInstalled).toBe(false)
    expect(manifest.dependencies[entry.packageName]).toBe('workspace:*')
    expect(nuxt).toContain(`'${entry.packageName}'`)
  }
  const result = spawnSync('bun', ['scripts/packages.ts', 'matrix'], { cwd: root, encoding: 'utf8' })
  expect(result.status).toBe(0)
  const authored = catalog.capabilities.filter((entry: { status: string, packageTest?: unknown, packagePath?: string }) => ['done', 'in-progress'].includes(entry.status) && entry.packagePath && entry.packageTest).map((entry: { id: string }) => entry.id)
  expect(JSON.parse(result.stdout).capability.sort()).toEqual(authored.sort())
  expect(authored.sort()).toEqual([...completed].sort())
})

test('Webhooks and Notifications require Jobs; Audit, Cache and Realtime fixtures remain independent', () => {
  expect(catalog.capabilities.find((entry: { id: string }) => entry.id === 'webhooks').requires).toEqual(['jobs'])
  expect(catalog.capabilities.find((entry: { id: string }) => entry.id === 'notifications').requires).toEqual(['jobs'])
  for (const id of ['audit-log', 'cache-coordination', 'realtime', 'search', 'ai', 'ops-admin']) {
    const entry = catalog.capabilities.find((candidate: { id: string }) => candidate.id === id)
    expect(entry.requires).toEqual([])
    const fixture = JSON.parse(readFileSync(resolve(root, entry.fixturePath, 'package.json'), 'utf8'))
    expect(Object.keys(fixture.dependencies).filter(name => name.startsWith('@repo/'))).toEqual([entry.packageName])
  }
})


test('Realtime and Notifications keep optional integrations out of core package dependencies', () => {
  for (const id of ['realtime', 'notifications']) {
    const entry = catalog.capabilities.find((candidate: { id: string }) => candidate.id === id)
    const manifest = JSON.parse(readFileSync(resolve(root, entry.packagePath, 'package.json'), 'utf8'))
    const peers = Object.keys(manifest.peerDependencies).filter(name => name.startsWith('@repo/'))
    expect(peers).toEqual(id === 'notifications' ? ['@repo/nuxt-jobs'] : [])
    expect(Object.keys(manifest.dependencies).filter(name => name.startsWith('@repo/'))).toEqual([])
    expect(readFileSync(resolve(root, entry.evaluationDocument), 'utf8')).toContain('## Cross-framework v1 contract')
  }
})


test('standalone worker closes every provider-owned producer and database pool', () => {
  const source = readFileSync(resolve(root, 'scripts/jobs-worker.ts'), 'utf8')
  for (const closer of ['closeInvoiceNinjaResources', 'closeStripeResources', 'closeMedusaResources']) {
    expect(source).toContain(`await ${closer}()`)
  }
})

test('production Compose passes every optional provider variable to app and worker', () => {
  const compose = Bun.YAML.parse(readFileSync(resolve(root, 'compose.yaml'), 'utf8')) as {
    services: Record<string, { environment: Record<string, string> }>
  }
  const example = readFileSync(resolve(root, '.env.example'), 'utf8')
  const providerKeys = [...example.matchAll(/^((?:INVOICE_NINJA|STRIPE|MEDUSA)_[A-Z_]+)=/gm)].map(match => match[1]!)
  expect(providerKeys).toHaveLength(17)
  for (const service of ['app', 'worker']) {
    for (const key of providerKeys) {
      expect(compose.services[service]!.environment[key]).toStartWith('${' + key + ':-')
    }
  }
})


test('Command is completed and reference-enabled while preserving its packed browser lifecycle', () => {
  const entry = catalog.capabilities.find((candidate: { id: string }) => candidate.id === 'command-system')
  expect(entry.status).toBe('done')
  expect(entry.defaultInstalled).toBe(false)
  expect(catalog.referenceApplication.enabledCapabilities).toContain('command-system')
  expect(entry.packageTest.runtimeScript).toBe('package:test:runtime')
  const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
  expect(manifest.dependencies[entry.packageName]).toBe('workspace:*')
  expect(readFileSync(resolve(root, 'nuxt.config.ts'), 'utf8')).toContain(`'${entry.packageName}'`)
})


test('root application browser discovery includes Rich Text, File UI, Flow and Internationalization', () => {
  const result = spawnSync('bun', ['x', 'playwright', 'test', '--list'], { cwd: root, encoding: 'utf8' })
  expect(result.status).toBe(0)
  expect(result.stdout).toContain('[application] › rich-text.e2e.ts')
  expect(result.stdout).toContain('[application] › file-ui.e2e.ts')
  expect(result.stdout).toContain('[application] › internationalization.e2e.ts')
  expect(result.stdout).toContain('[application] › flow-canvas.e2e.ts')
})


test('Internationalization is completed from hosted source evidence and remains independent', () => {
  const entry = catalog.capabilities.find((candidate: { id: string }) => candidate.id === 'internationalization')
  expect(entry.status).toBe('done')
  expect(entry.defaultInstalled).toBe(false)
  expect(entry.requires).toEqual([])
  expect(entry.packageTest.runtimeScript).toBe('package:test:runtime')
  expect(catalog.referenceApplication.enabledCapabilities).toContain('internationalization')
})


test('failed browser diagnostics keep precise synthetic-test artifacts for three days', () => {
  const workflow = Bun.YAML.parse(readFileSync(resolve(root, '.github/workflows/ci.yml'), 'utf8')) as {
    jobs: { check: { env: Record<string, string>, steps: Array<{ name?: string, if?: string, uses?: string, env?: Record<string, string>, with?: Record<string, string | number> }> } }
  }
  const check = workflow.jobs.check
  const capture = check.steps.find(step => step.name === 'Preserve failed browser request traces')!
  expect(capture.if).toBe('failure()')
  expect(capture.uses).toBe('actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a')
  expect(capture.with?.path).toBe('test-results/**/trace.zip\ntest-results/**/error-context.md\n')
  expect(capture.with?.['retention-days']).toBe(3)
  expect(capture.with?.['if-no-files-found']).toBe('ignore')
  expect(check.env.DATABASE_URL).toBe('postgres://postgres:postgres@localhost:5432/nuxt_starter')
  expect(check.env.NUXT_AUTH_SECRET).toBe('ci-secret-that-is-at-least-thirty-two-characters')
  expect(check.env.NUXT_PUBLIC_APP_BASE_URL).toBe('http://127.0.0.1:3001')
  expect(check.steps.find(step => step.name === 'Verify authenticated production HTTP and browser contracts')?.env?.PLAYWRIGHT_BASE_URL).toBe('http://127.0.0.1:3001')
})
