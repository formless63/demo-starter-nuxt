import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const root = resolve(import.meta.dir, '../..')
const catalog = JSON.parse(readFileSync(resolve(root, 'capabilities/catalog.json'), 'utf8'))
const completed = ['jobs', 'api-platform', 'observability', 'object-storage', 'email', 'webhooks', 'audit-log', 'cache-coordination', 'realtime', 'notifications', 'search', 'ai', 'import-export', 'ops-admin', 'invoice-ninja', 'stripe', 'medusa', 'command-system']

test('all eighteen completed packages are explicitly enabled and discovered by the generic matrix', () => {
  const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
  const nuxt = readFileSync(resolve(root, 'nuxt.config.ts'), 'utf8')
  expect(catalog.capabilities.filter((entry: { status: string }) => entry.status === 'done').map((entry: { id: string }) => entry.id).sort()).toEqual([...completed].sort())
  expect(completed).toHaveLength(18)
  expect([...catalog.referenceApplication.enabledCapabilities].sort()).toEqual([...completed].sort())
  for (const id of completed) {
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
