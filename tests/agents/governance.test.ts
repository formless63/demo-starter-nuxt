import { afterEach, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { checkAgents } from '../../scripts/agents-check.ts'
import { projectRoot } from '../../.agents/hooks/common.ts'

const temporary: string[] = []
afterEach(() => { for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true }) })
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'agent-governance-'))
  temporary.push(root)
  return root
}
function write(root: string, path: string, value: object | string) {
  mkdirSync(dirname(join(root, path)), { recursive: true })
  writeFileSync(join(root, path), typeof value === 'string' ? value : JSON.stringify(value))
}

test('harness validates canonical trees and adapters without client executables', async () => {
  expect(await checkAgents(projectRoot)).toEqual([])
  const root = fixture()
  for (const path of ['.agents', '.claude', '.codex', '.gemini', 'AGENTS.md', 'CLAUDE.md', 'capabilities/catalog.json']) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    cpSync(join(projectRoot, path), join(root, path), { recursive: true, verbatimSymlinks: true })
  }
  expect(await checkAgents(root)).toEqual([])
  unlinkSync(join(root, '.claude/skills'))
  write(root, '.agents/skills/incomplete/notes.md', 'not a skill')
  write(root, '.gemini/settings.json', '{invalid')
  write(root, '.codex/hooks.json', { hooks: { Stop: [{ hooks: [{ type: 'command', command: '/home/alice/check.sh' }] }] } })
  const errors = (await checkAgents(root)).join('\n')
  expect(errors).toContain('incomplete/SKILL.md')
  expect(errors).toContain('Canonical Claude')
  expect(errors).toContain('.gemini/settings.json')
  expect(errors).toContain('portable adapter')
})

test('done governance requires evaluation, complete lifecycle metadata and implemented reference integrations; skills stay optional', () => {
  const root = fixture()
  cpSync(join(projectRoot, 'capabilities/catalog.schema.json'), join(root, 'schema.json'))
  mkdirSync(join(root, 'capabilities'))
  cpSync(join(root, 'schema.json'), join(root, 'capabilities/catalog.schema.json'))
  const capability = {
    id: 'demo', displayName: 'Demo', kind: 'foundational-backend', status: 'done', defaultInstalled: false,
    requires: [], integratesWith: [], externalRequirements: [], summary: 'fixture',
    documentationPath: 'capabilities/demo/CAPABILITY.md', evaluationDocument: 'EVALUATION.md',
    packageName: '@fixture/demo', packagePath: 'packages/demo', fixturePath: 'fixtures/demo',
    packageTest: { ownedDependencies: [], removal: { scripts: [], paths: [], replacementNuxtConfig: 'base.ts' } },
  }
  const catalog = { schemaVersion: 1, baseline: [], referenceApplication: { enabledCapabilities: ['demo'] }, capabilities: [capability] }
  write(root, 'package.json', { dependencies: { '@fixture/demo': 'workspace:*' } })
  write(root, 'nuxt.config.ts', "export default { modules: ['@fixture/demo'] }")
  write(root, capability.documentationPath, 'contract')
  write(root, capability.evaluationDocument, 'evaluation')
  write(root, 'packages/demo/package.json', { name: '@fixture/demo' })
  write(root, 'packages/demo/src/module.ts', 'export default {}')
  write(root, 'fixtures/demo/package.json', { scripts: { typecheck: 'tsc', build: 'nuxt build' } })
  write(root, 'fixtures/demo/nuxt.config.ts', 'export default {}')
  write(root, 'fixtures/demo/base.ts', 'export default {}')
  function check(overrides: object) {
    write(root, 'capabilities/catalog.json', { ...catalog, capabilities: [{ ...capability, ...overrides }] })
    return spawnSync(process.execPath, [join(projectRoot, 'scripts/capabilities-check.ts')], { cwd: root, encoding: 'utf8' })
  }
  expect(check({}).status).toBe(0)
  expect(check({ evaluationDocument: undefined }).status).toBe(1)
  expect(check({ evaluationDocument: 'missing.md' }).stderr).toContain('does not exist')
  expect(check({ agentSkill: '.agents/skills/missing/SKILL.md' }).stderr).toContain('agent skill')
  expect(check({ packageTest: undefined }).stderr).toContain('packageTest is required')
  expect(check({ packageTest: { ...capability.packageTest, postRemovalScript: 'missing' } }).stderr).toContain('missing postRemovalScript')
  expect(check({ packageTest: { ...capability.packageTest, cleanupScript: 'missing' } }).stderr).toContain('missing cleanupScript')
  write(root, 'fixtures/demo/package.json', { scripts: { typecheck: 'tsc', build: 'nuxt build', survival: 'verify', cleanup: 'cleanup' } })
  const hooks = { ...capability.packageTest, postRemovalScript: 'survival', cleanupScript: 'cleanup' }
  expect(check({ packageTest: hooks }).status).toBe(0)
  expect(check({ packageTest: { ...hooks, removal: { ...hooks.removal, scripts: ['survival', 'cleanup'] } } }).stderr).toContain('must remain after removal')
  expect(check({ fixturePath: undefined }).stderr).toContain('fixturePath is required')
  expect(check({ status: 'in-progress' }).status).toBe(0)
  expect(check({ status: 'planned' }).stderr).toContain('implemented, installed')
})
