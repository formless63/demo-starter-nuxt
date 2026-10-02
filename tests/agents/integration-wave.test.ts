import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const root = resolve(import.meta.dir, '../..')
const catalog = JSON.parse(readFileSync(resolve(root, 'capabilities/catalog.json'), 'utf8'))
const completed = ['jobs', 'api-platform', 'observability', 'object-storage', 'email', 'webhooks', 'audit-log', 'cache-coordination', 'realtime', 'notifications', 'search', 'ai', 'import-export', 'ops-admin']

test('completed packages and authored provider fixtures are explicitly enabled and discovered by the generic matrix', () => {
  const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
  const nuxt = readFileSync(resolve(root, 'nuxt.config.ts'), 'utf8')
  expect(catalog.capabilities.filter((entry: { status: string }) => entry.status === 'done').map((entry: { id: string }) => entry.id).sort()).toEqual([...completed].sort())
  const verifyingProviders = catalog.capabilities.filter((entry: { id: string, status: string }) => ['invoice-ninja', 'stripe', 'medusa'].includes(entry.id) && entry.status === 'in-progress').map((entry: { id: string }) => entry.id)
  expect([...catalog.referenceApplication.enabledCapabilities].sort()).toEqual([...completed, ...verifyingProviders].sort())
  for (const id of [...completed, ...verifyingProviders]) {
    const entry = catalog.capabilities.find((candidate: { id: string }) => candidate.id === id)
    expect(entry.defaultInstalled).toBe(false)
    expect(manifest.dependencies[entry.packageName]).toBe('workspace:*')
    expect(nuxt).toContain(`'${entry.packageName}'`)
  }
  const result = spawnSync('bun', ['scripts/packages.ts', 'matrix'], { cwd: root, encoding: 'utf8' })
  expect(result.status).toBe(0)
  const authored = catalog.capabilities.filter((entry: { status: string, packageTest?: unknown, packagePath?: string }) => ['done', 'in-progress'].includes(entry.status) && entry.packagePath && entry.packageTest).map((entry: { id: string }) => entry.id)
  expect(JSON.parse(result.stdout).capability.sort()).toEqual(authored.sort())
  expect(authored).toEqual(expect.arrayContaining(['invoice-ninja', 'stripe', 'medusa']))
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
