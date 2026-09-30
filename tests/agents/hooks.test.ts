import { afterEach, describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { contextResponse, gateResponse, guardResponse, projectRoot, type Client, type Runner } from '../../.agents/hooks/common.ts'
import { sessionContext } from '../../.agents/hooks/session-context.ts'
import { toolDecision } from '../../.agents/hooks/tool-guard.ts'
import { qualityGate } from '../../.agents/hooks/quality-gate.ts'

const temporary: string[] = []
afterEach(() => { for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true }) })
function repository() {
  const root = mkdtempSync(join(tmpdir(), 'agent-hooks-'))
  temporary.push(root)
  const git = (...args: string[]) => {
    const child = spawnSync('git', args, { cwd: root, encoding: 'utf8' })
    expect(child.status).toBe(0)
  }
  git('init', '-q', '-b', 'fixture')
  writeFileSync(join(root, 'source.txt'), 'initial\n')
  git('add', 'source.txt')
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture')
  return { root, git }
}
function runner(calls: string[], capabilitiesOk = true): Runner {
  return (args, root) => {
    calls.push(args.join(' '))
    if (args[0] === 'bun') return { ok: capabilitiesOk, text: '' }
    const result = spawnSync(args[0]!, args.slice(1), { cwd: root, encoding: 'utf8' })
    return { ok: result.status === 0, text: result.stdout }
  }
}

describe('session context', () => {
  test('clean/dirty Git context survives unavailable status without exposing files or environment', () => {
    const { root } = repository()
    const calls: string[] = []
    const execute = runner(calls, false)
    expect(sessionContext(root, execute)).toContain('Branch: fixture; worktree: clean')
    writeFileSync(join(root, '.env.local'), 'PRIVATE_SENTINEL=value\n')
    const context = sessionContext(root, execute)
    expect(context).toContain('worktree: dirty')
    expect(context).toContain('Capability status unavailable')
    expect(context).toContain('Read AGENTS.md')
    expect(context).not.toContain('PRIVATE_SENTINEL')
    expect(context).not.toContain('.env.local')
    expect(calls.every(call => call.startsWith('git ') || call === 'bun run capabilities:status')).toBe(true)
  })
  test('summarizes only known status fields, omitting arbitrary status output', () => {
    const execute: Runner = (args) => ({ ok: true, text: args[0] === 'bun'
      ? 'Capability status\n\njobs — Jobs\n  status: done\n  enabled in reference app: yes\n  secret: PRIVATE_SENTINEL\n\nemail — Email\n  status: planned\n'
      : args[1] === 'branch' ? 'main\n' : '' })
    const context = sessionContext('/fixture/project', execute)
    expect(context).toContain('jobs=done (reference enabled); email=planned')
    expect(context).not.toContain('PRIVATE_SENTINEL')
  })
})

const clients: Client[] = ['claude', 'codex', 'gemini']
for (const client of clients) {
  describe(`${client} safety payloads`, () => {
    const tool = client === 'gemini' ? 'run_shell_command' : 'Bash'
    const shell = (command: string, cwd = projectRoot) => toolDecision({ tool_name: tool, cwd, tool_input: { command } }, projectRoot)
    test.each(['git status', 'bun run check', 'rm -rf .nuxt .output', 'rm -rf /tmp/disposable-fixture', 'docker compose down --volumes --remove-orphans', 'echo "git reset --hard"'])('allows benign command: %s', command => {
      expect(shell(command).reason).toBeUndefined()
    })
    test.each(['git reset --hard', 'git -C /tmp/fixture reset --hard', 'git --no-pager reset --hard', 'git clean -fd', 'git clean -fdx', 'git clean --force -d', 'git push --force', 'git push --force-with-lease=main', 'git push -f origin main', 'git push origin +main', 'rm -rf .', 'rm -rf ..', 'rm -r .git', 'rm -rf .git/*', `rm -rf "${projectRoot}"`, 'cd ..; rm -rf demo-starter-nuxt'])('denies clear destructive command: %s', command => {
      const decision = shell(command)
      expect(decision.reason).toBeTruthy()
      const response = guardResponse(client, decision.reason)
      if (client === 'gemini') expect(response).toHaveProperty('decision', 'deny')
      else expect(response).toHaveProperty('hookSpecificOutput.permissionDecision', 'deny')
    })
    test('resolves shell cwd and direct secret writes; templates and reads remain editable', () => {
      const writeTool = client === 'gemini' ? 'write_file' : 'Write'
      for (const path of ['.env', '.env.local', '.env.production', 'server/.env.production.local']) {
        expect(toolDecision({ tool_name: writeTool, cwd: projectRoot, tool_input: { file_path: path } }, projectRoot).reason).toBeTruthy()
      }
      for (const path of ['.env.example', '.env.sample', '.env.production.example', 'docs/AGENT-AUTOMATION.md']) {
        expect(toolDecision({ tool_name: writeTool, cwd: projectRoot, tool_input: { file_path: path } }, projectRoot).reason).toBeUndefined()
      }
      expect(toolDecision({ tool_name: 'Read', tool_input: { file_path: '.env' } }, projectRoot).reason).toBeUndefined()
      expect(shell('rm -rf ../.git', resolve(projectRoot, 'server')).reason).toBeTruthy()
    })
    test('uncertain shell grammar fails open with a fixed warning', () => {
      const decision = shell('rm -rf "$TARGET"')
      expect(decision.reason).toBeUndefined()
      expect(guardResponse(client, decision.reason, decision.warning)).toHaveProperty('systemMessage')
      expect(JSON.stringify(decision)).not.toContain('$TARGET')
    })
  })
}

test('Codex patches and Gemini replace respect secret/template paths, including symlinks', () => {
  const { root } = repository()
  writeFileSync(join(root, '.env'), 'secret\n')
  symlinkSync('.env', join(root, 'config-alias'))
  for (const path of ['.env', 'config-alias']) {
    expect(toolDecision({ tool_name: 'apply_patch', tool_input: { command: `*** Begin Patch\n*** Update File: ${path}\n@@\n-a\n+b\n*** End Patch\n` } }, root).reason).toBeTruthy()
    expect(toolDecision({ tool_name: 'replace', tool_input: { file_path: path } }, root).reason).toBeTruthy()
  }
  expect(toolDecision({ tool_name: 'apply_patch', tool_input: { command: '*** Begin Patch\n*** Add File: .env.example\n+template\n*** End Patch\n' } }, root).reason).toBeUndefined()
  rmSync(join(root, '.env'))
  symlinkSync('/tmp/external-secret-store', join(root, '.env'))
  expect(toolDecision({ tool_name: 'Write', tool_input: { file_path: '.env' } }, root).reason).toBeTruthy()
})

test('shell path checks honor Codex workdir and Gemini workspace-relative dir_path', () => {
  expect(toolDecision({ tool_name: 'Bash', cwd: projectRoot, tool_input: { command: 'rm -rf ../.git', workdir: 'server' } }, projectRoot).reason).toBeTruthy()
  expect(toolDecision({ tool_name: 'run_shell_command', cwd: join(projectRoot, 'app'), tool_input: { command: 'rm -rf ../.git', dir_path: 'server' } }, projectRoot).reason).toBeTruthy()
  expect(toolDecision({ tool_name: 'run_shell_command', tool_input: { command: 'rm -rf .nuxt', dir_path: '/tmp/disposable-fixture' } }, projectRoot).reason).toBeUndefined()
})

describe('quality gate', () => {
  test('clean worktree exits after status only', () => {
    const { root } = repository()
    const calls: string[] = []
    expect(qualityGate(root, runner(calls))).toBeUndefined()
    expect(calls).toHaveLength(1)
  })
  test('checks unstaged and staged whitespace and gives retry feedback for every client', () => {
    const { root, git } = repository()
    writeFileSync(join(root, 'source.txt'), 'bad trailing space \n')
    for (const staged of [false, true]) {
      if (staged) git('add', 'source.txt')
      const calls: string[] = []
      const reason = qualityGate(root, runner(calls))
      expect(reason).toContain(staged ? 'git diff --cached --check' : 'git diff --check')
      expect(calls).toContain('git diff --check')
      expect(calls).toContain('git diff --cached --check')
      for (const client of clients) expect(gateResponse(client, reason)).toHaveProperty('decision', client === 'gemini' ? 'deny' : 'block')
      expect(calls.some(call => call.startsWith('bun '))).toBe(false)
    }
  })
  test('governance changes invoke only the cheap checker; untracked and renamed paths are included', () => {
    const { root, git } = repository()
    mkdirSync(join(root, '.agents'), { recursive: true })
    writeFileSync(join(root, '.agents', 'new.md'), 'policy\n')
    const calls: string[] = []
    expect(qualityGate(root, runner(calls, false))).toContain('bun run capabilities:check')
    expect(calls.filter(call => call.startsWith('bun '))).toEqual(['bun run capabilities:check'])
    rmSync(join(root, '.agents'), { recursive: true })
    git('mv', 'source.txt', 'ROADMAP.md')
    expect(qualityGate(root, runner([], false))).toContain('capabilities:check')
  })
  test('unrelated edits do not invoke capability, network, Docker or full verification', () => {
    const { root } = repository()
    mkdirSync(join(root, 'docs'))
    writeFileSync(join(root, 'docs', 'unrelated.md'), 'docs\n')
    writeFileSync(join(root, 'source.txt'), 'updated\n')
    const calls: string[] = []
    expect(qualityGate(root, runner(calls))).toBeUndefined()
    expect(calls).toHaveLength(3)
    expect(calls.every(call => call.startsWith('git '))).toBe(true)
  })
  test('active retry is checked again, but successful checks do not perpetuate retries', () => {
    for (const client of clients) expect(gateResponse(client)).toEqual({})
  })
})

describe('JSON entrypoints', () => {
  test('session launcher falls back to Node 24 when Bun is absent from PATH', () => {
    const bin = mkdtempSync(join(tmpdir(), 'hook-node-fallback-'))
    temporary.push(bin)
    const node = spawnSync('which', ['node'], { encoding: 'utf8' }).stdout.trim()
    symlinkSync(node, join(bin, 'node'))
    const result = spawnSync('sh', [join(projectRoot, '.agents/hooks/session-context.sh'), 'codex'], {
      input: JSON.stringify({ hook_event_name: 'SessionStart', source: 'compact' }), encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}:/usr/bin:/bin` },
    })
    expect(result.status).toBe(0)
    const context = JSON.parse(result.stdout).hookSpecificOutput.additionalContext
    expect(context).toContain('Branch:')
    expect(context).toContain('Capability status unavailable')
  })
  for (const client of clients) {
    test(`${client} fixture stdin produces supported responses without leaking input`, () => {
      function invoke(script: string, payload: object) {
        const result = spawnSync(process.execPath, [join(projectRoot, '.agents/hooks', script), client], {
          cwd: join(projectRoot, 'server'), input: JSON.stringify(payload), encoding: 'utf8',
          env: { ...process.env, PRIVATE_SENTINEL: 'do-not-output' },
        })
        expect(result.status).toBe(0)
        expect(result.stdout).not.toContain('do-not-output')
        return JSON.parse(result.stdout)
      }
      const context = invoke('session-context.ts', { hook_event_name: 'SessionStart', source: 'resume', cwd: projectRoot })
      expect(context).toHaveProperty('hookSpecificOutput.additionalContext')
      expect(context).toEqual(contextResponse(client, context.hookSpecificOutput.additionalContext))
      const guard = invoke('tool-guard.ts', { hook_event_name: client === 'gemini' ? 'BeforeTool' : 'PreToolUse', tool_name: client === 'gemini' ? 'run_shell_command' : 'Bash', cwd: projectRoot, tool_input: { command: 'git reset --hard' } })
      expect(client === 'gemini' ? guard.decision : guard.hookSpecificOutput.permissionDecision).toBe('deny')
      const gate = invoke('quality-gate.ts', { hook_event_name: client === 'gemini' ? 'AfterAgent' : 'Stop', stop_hook_active: true, cwd: projectRoot })
      expect(gate).toEqual({})
    })
  }
})
