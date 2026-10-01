import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const root = resolve(import.meta.dir, '../..')
const catalog = JSON.parse(readFileSync(resolve(root, 'capabilities/catalog.json'), 'utf8'))
const completed = ['jobs', 'api-platform', 'observability', 'object-storage', 'email', 'webhooks', 'audit-log', 'cache-coordination', 'ai']

test('all completed packages are explicitly enabled and discovered by the generic matrix', () => {
  const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
  const nuxt = readFileSync(resolve(root, 'nuxt.config.ts'), 'utf8')
  expect(catalog.capabilities.filter((entry: { status: string }) => entry.status === 'done').map((entry: { id: string }) => entry.id).sort()).toEqual([...completed].sort())
  expect([...catalog.referenceApplication.enabledCapabilities].sort()).toEqual([...completed].sort())
  for (const id of completed) {
    const entry = catalog.capabilities.find((candidate: { id: string }) => candidate.id === id)
    expect(entry.defaultInstalled).toBe(false)
    expect(manifest.dependencies[entry.packageName]).toBe('workspace:*')
    expect(nuxt).toContain(`'${entry.packageName}'`)
  }
  const result = spawnSync('bun', ['scripts/packages.ts', 'matrix'], { cwd: root, encoding: 'utf8' })
  expect(result.status).toBe(0)
  expect(JSON.parse(result.stdout).capability.sort()).toEqual([...completed].sort())
})

test('only Webhooks requires Jobs; Audit, Cache and AI fixtures remain independent', () => {
  expect(catalog.capabilities.find((entry: { id: string }) => entry.id === 'webhooks').requires).toEqual(['jobs'])
  for (const id of ['audit-log', 'cache-coordination', 'ai']) {
    const entry = catalog.capabilities.find((candidate: { id: string }) => candidate.id === id)
    expect(entry.requires).toEqual([])
    const fixture = JSON.parse(readFileSync(resolve(root, entry.fixturePath, 'package.json'), 'utf8'))
    expect(Object.keys(fixture.dependencies).filter(name => name.startsWith('@repo/'))).toEqual([entry.packageName])
  }
})
