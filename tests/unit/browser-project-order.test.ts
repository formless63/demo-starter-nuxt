// @vitest-environment node
import { spawnSync } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import config from '../../playwright.config'

type ListedSuite = { suites?: ListedSuite[], specs?: { file: string, tests: { projectName: string }[] }[] }
function discover(...args: string[]) {
  const result = spawnSync(process.execPath, [join(process.cwd(), 'node_modules/@playwright/test/cli.js'), 'test', '--list', '--reporter=json', ...args], { cwd: process.cwd(), encoding: 'utf8', timeout: 20_000, maxBuffer: 4 * 1024 * 1024 })
  expect(result.status, result.stderr).toBe(0)
  const report = JSON.parse(result.stdout) as { suites: ListedSuite[], errors: unknown[] }
  expect(report.errors).toEqual([])
  const files = new Map<string, Set<string>>()
  function visit(suite: ListedSuite) {
    for (const spec of suite.specs ?? []) for (const test of spec.tests) {
      const set = files.get(test.projectName) ?? new Set<string>()
      set.add(spec.file.replaceAll('\\', '/'))
      files.set(test.projectName, set)
    }
    for (const child of suite.suites ?? []) visit(child)
  }
  for (const suite of report.suites) visit(suite)
  return files
}

it('runs infrastructure-mutating Import/Export only after ordinary application tests', () => {
  const projects = config.projects ?? []
  expect(projects.map(project => project.name)).toEqual(['application', 'import-export'])
  expect(projects[0]?.dependencies ?? []).toEqual([])
  expect(projects[1]?.dependencies).toEqual(['application'])
  for (const project of projects) {
    expect(project.use).toBeUndefined() // Both inherit the same dev/production target.
    expect(project.retries).toBeUndefined()
    expect(project.timeout).toBeUndefined()
  }
})

it('discovers disjoint complete test sets and preserves explicit project selection', async () => {
  const expected = (await readdir(join(process.cwd(), 'tests/e2e'), { recursive: true })).filter(file => file.endsWith('.e2e.ts')).map(file => file.replaceAll('\\', '/')).sort()
  const all = discover()
  const application = [...(all.get('application') ?? [])].sort()
  const infrastructure = [...(all.get('import-export') ?? [])].sort()
  expect(infrastructure).toEqual(['import-export.e2e.ts'])
  expect(application).toEqual(expected.filter(file => file !== 'import-export.e2e.ts'))
  expect([...application, ...infrastructure].sort()).toEqual(expected)
  expect([...discover('--project=application').keys()]).toEqual(['application'])
  expect([...discover('--project=import-export').keys()].sort()).toEqual(['application', 'import-export'])
  expect([...(discover('--project=application', `tests/e2e/${application[0]}`).get('application') ?? [])]).toEqual([application[0]])
  expect([...discover('--project=import-export', '--no-deps').keys()]).toEqual(['import-export'])
}, 30_000)
