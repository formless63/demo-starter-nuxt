import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const root = resolve(import.meta.dir, '../..')
const catalog = JSON.parse(readFileSync(resolve(root, 'capabilities/catalog.json'), 'utf8'))
const completed = ['jobs', 'api-platform', 'observability', 'object-storage', 'email', 'webhooks', 'audit-log', 'cache-coordination', 'realtime', 'notifications', 'search', 'ai']

test('completed packages match the generic matrix and explicit reference modules', () => {
  const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
  const nuxt = readFileSync(resolve(root, 'nuxt.config.ts'), 'utf8')
  const done = catalog.capabilities.filter((entry: { status: string }) => entry.status === 'done')
  const selected = catalog.capabilities.filter((entry: { packageName?: string, status: string }) => entry.packageName && manifest.dependencies[entry.packageName] && entry.status === 'done')
  for (const id of completed) expect(done.some((entry: { id: string }) => entry.id === id)).toBe(true)
  expect([...catalog.referenceApplication.enabledCapabilities].sort()).toEqual(selected.map((entry: { id: string }) => entry.id).sort())
  for (const id of selected.map((entry: { id: string }) => entry.id)) {
    const entry = catalog.capabilities.find((candidate: { id: string }) => candidate.id === id)
    expect(entry.defaultInstalled).toBe(false)
    expect(manifest.dependencies[entry.packageName]).toBe('workspace:*')
    expect(nuxt).toContain(`'${entry.packageName}'`)
  }
  const result = spawnSync('bun', ['scripts/packages.ts', 'matrix'], { cwd: root, encoding: 'utf8' })
  expect(result.status).toBe(0)
  const testable = catalog.capabilities.filter((entry: { status: string, packageTest?: unknown }) => ['done', 'in-progress'].includes(entry.status) && entry.packageTest)
  expect(JSON.parse(result.stdout).capability.sort()).toEqual(testable.map((entry: { id: string }) => entry.id).sort())
})

test('Webhooks and Notifications require Jobs; Audit, Cache and Realtime fixtures remain independent', () => {
  expect(catalog.capabilities.find((entry: { id: string }) => entry.id === 'webhooks').requires).toEqual(['jobs'])
  expect(catalog.capabilities.find((entry: { id: string }) => entry.id === 'notifications').requires).toEqual(['jobs'])
  for (const id of ['audit-log', 'cache-coordination', 'realtime', 'search', 'ai']) {
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
