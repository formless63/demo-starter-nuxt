import { access, readdir, realpath, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

interface Handler { type?: string, command?: string, timeout?: number }
interface Group { hooks?: Handler[], matcher?: string }
interface Settings { hooks?: Record<string, Group[]>, context?: { fileName?: string } }

export async function checkAgents(root: string): Promise<string[]> {
  const errors: string[] = []
  async function exists(path: string) {
    try { await access(resolve(root, path)); return true }
    catch { errors.push(`Missing ${path}`); return false }
  }
  for (const path of ['AGENTS.md', '.agents/context', '.agents/skills', '.agents/prompts', '.agents/hooks']) await exists(path)
  if (await exists('.agents/skills')) {
    for (const entry of await readdir(resolve(root, '.agents/skills'), { withFileTypes: true })) {
      if (entry.isDirectory()) await exists(`.agents/skills/${entry.name}/SKILL.md`)
    }
  }
  try {
    const catalog = JSON.parse(await readFile(resolve(root, 'capabilities/catalog.json'), 'utf8')) as {
      capabilities: Array<{ agentSkill?: string }>
    }
    for (const capability of catalog.capabilities) if (capability.agentSkill) await exists(capability.agentSkill)
  }
  catch { errors.push('Cannot read capability agentSkill declarations') }
  try {
    const canonical = await realpath(resolve(root, 'AGENTS.md'))
    const claude = resolve(root, 'CLAUDE.md')
    if (await realpath(claude) !== canonical && !/^@AGENTS\.md$/m.test(await readFile(claude, 'utf8'))) {
      errors.push('CLAUDE.md must link to or import AGENTS.md')
    }
    if (await realpath(resolve(root, '.claude/skills')) !== await realpath(resolve(root, '.agents/skills'))) {
      errors.push('.claude/skills must point to .agents/skills')
    }
  }
  catch { errors.push('Canonical Claude guidance/skills links are missing') }

  for (const client of ['claude', 'codex', 'gemini']) {
    const path = `.${client}/${client === 'codex' ? 'hooks.json' : 'settings.json'}`
    try {
      const config = JSON.parse(await readFile(resolve(root, path), 'utf8')) as Settings
      if (client === 'gemini' && config.context?.fileName !== 'AGENTS.md') errors.push('Gemini must use AGENTS.md')
      const expected = ['SessionStart', client === 'gemini' ? 'BeforeTool' : 'PreToolUse', client === 'gemini' ? 'AfterAgent' : 'Stop']
      const scripts = ['session-context.sh', 'tool-guard.ts', 'quality-gate.ts']
      const anchor = client === 'codex' ? '$(git rev-parse --show-toplevel)' : '${' + client.toUpperCase() + '_PROJECT_DIR}'
      for (const [index, event] of expected.entries()) {
        const groups = config.hooks?.[event]
        if (!Array.isArray(groups) || groups.length !== 1) { errors.push(`${path}: expected one ${event} adapter`); continue }
        const handlers = groups[0]?.hooks
        if (!Array.isArray(handlers) || handlers.length !== 1) { errors.push(`${path}: expected one ${event} handler`); continue }
        const handler = handlers[0]!
        const script = scripts[index]!
        const command = `${index === 0 ? 'sh' : 'bun'} "${anchor}/.agents/hooks/${script}" ${client}`
        // Restrict to the supported thin adapter subset rather than accepting
        // arbitrary commands, absolute user paths or client preference settings.
        if (handler.type !== 'command' || handler.command !== command || handler.timeout !== (client === 'gemini' ? 15000 : 15)) {
          errors.push(`${path}: ${event} must invoke the shared portable adapter with a bounded timeout`)
        }
        await exists(`.agents/hooks/${script}`)
      }
      if (Object.keys(config.hooks ?? {}).some(event => !expected.includes(event))) errors.push(`${path}: unexpected hook event`)
    }
    catch { errors.push(`${path} must be valid project hook JSON`) }
  }
  // This project intentionally uses Codex's supported hooks.json mechanism,
  // without a config.toml or duplicate Codex instruction/skill files.
  await exists('.agents/hooks/session-context.ts')
  await exists('.agents/hooks/common.ts')
  return errors
}

if (import.meta.main) {
  const errors = await checkAgents(process.cwd())
  if (errors.length) {
    console.error(`Agent harness checks failed:\n${errors.map(error => `- ${error}`).join('\n')}`)
    process.exitCode = 1
  }
  else console.info('Agent harness is valid (shared hooks; Claude, Codex and Gemini adapters)')
}
