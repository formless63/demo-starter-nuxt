import { basename } from 'node:path'
import { contextResponse, main, projectRoot, run, type Runner } from './common.ts'

function concise(value: string) {
  return [...value].map(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 ? ' ' : char).join('').trim().slice(0, 100)
}

export function sessionContext(root: string, execute: Runner = run): string {
  const branch = execute(['git', 'branch', '--show-current'], root)
  const state = execute(['git', 'status', '--porcelain=v1', '-z'], root)
  const status = execute(['bun', 'run', 'capabilities:status'], root)
  const lines = [
    `${concise(basename(root))}: Nuxt 4 / Vue 3; Bun tooling.`,
    `Branch: ${concise(branch.text) || 'detached/unknown'}; worktree: ${state.ok ? (state.text ? 'dirty' : 'clean') : 'unknown'}.`,
  ]
  if (status.ok) {
    // Summarize only known status fields, never arbitrary command output.
    const entries = status.text.split(/\n(?=[a-z][a-z0-9-]* — )/).slice(1)
    const summary = entries.flatMap((entry) => {
      const id = entry.match(/^([a-z][a-z0-9-]*) — /)?.[1]
      const phase = entry.match(/\n\s+status: (done|in-progress|planned|evaluate|deferred)\b/)?.[1]
      const enabled = /\n\s+enabled in reference app: yes\b/.test(entry)
      return id && phase ? [`${id}=${phase}${enabled ? ' (reference enabled)' : ''}`] : []
    })
    if (summary.length) lines.push(`Capabilities: ${summary.slice(0, 32).join('; ')}.`)
    else lines.push('Capability status unavailable.')
  }
  else lines.push('Capability status unavailable; retry bun run capabilities:status when tooling is ready.')
  lines.push('Read AGENTS.md and use the matching .agents/skills workflow before changing a governed domain.')
  return lines.join('\n')
}

if (import.meta.main) await main(client => contextResponse(client, sessionContext(projectRoot)))
