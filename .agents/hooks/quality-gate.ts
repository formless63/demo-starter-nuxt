import { gateResponse, main, projectRoot, run, type Runner } from './common.ts'

export function governed(path: string) {
  return ['capabilities/', '.agents/', '.claude/', '.codex/', '.gemini/'].some(prefix => path.startsWith(prefix))
    || ['ROADMAP.md', 'docs/CAPABILITIES.md', 'docs/STARTING-A-PROJECT.md', 'AGENTS.md', 'CLAUDE.md'].includes(path)
    || /^scripts\/capabilities-[^/]+\.ts$/.test(path)
}

export function qualityGate(root: string, execute: Runner = run): string | undefined {
  const status = execute(['git', 'status', '--porcelain=v1', '-z', '--untracked-files=all'], root)
  if (!status.ok) return 'Project quality gate: git status failed; restore repository access and retry.'
  if (!status.text) return
  const failures: string[] = []
  for (const args of [['git', 'diff', '--check'], ['git', 'diff', '--cached', '--check']]) {
    if (!execute(args, root).ok) failures.push(args.join(' '))
  }
  // Porcelain -z emits destination first, then source for renames/copies.
  const paths: string[] = []
  const entries = status.text.split('\0').filter(Boolean)
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index]!
    paths.push(entry.slice(3))
    if (/[RC]/.test(entry.slice(0, 2)) && entries[index + 1]) paths.push(entries[++index]!)
  }
  if (paths.some(governed) && !execute(['bun', 'run', 'capabilities:check'], root).ok) failures.push('bun run capabilities:check')
  // Never return tool stdout (which could contain a diff or sensitive data).
  if (failures.length) return `Project quality gate failed: ${failures.join('; ')}. Run these commands, fix their deterministic failures, then retry completion.`
}

if (import.meta.main) await main(client => gateResponse(client, qualityGate(projectRoot)))
