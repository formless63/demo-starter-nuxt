import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export type Client = 'claude' | 'codex' | 'gemini'
export type Payload = Record<string, unknown>
export const projectRoot = fileURLToPath(new URL('../..', import.meta.url))

export interface Result { ok: boolean, text: string }
export type Runner = (args: string[], root: string) => Result
export const run: Runner = (args, root) => {
  const child = spawnSync(args[0]!, args.slice(1), {
    cwd: root, encoding: 'utf8', timeout: 4000, maxBuffer: 128 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return { ok: child.status === 0 && !child.error, text: child.stdout ?? '' }
}

export function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function contextResponse(client: Client, context: string) {
  return { hookSpecificOutput: {
    ...(client === 'gemini' ? {} : { hookEventName: 'SessionStart' }),
    additionalContext: context,
  } }
}

export function guardResponse(client: Client, reason?: string, warning?: string) {
  // An abstention preserves the client's own approval/sandbox policy; "allow"
  // can override ordinary permission prompts in some clients.
  if (!reason) return warning ? { systemMessage: warning } : {}
  return client === 'gemini'
    ? { decision: 'deny', reason }
    : { hookSpecificOutput: {
        hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason,
      } }
}

export function gateResponse(client: Client, reason?: string) {
  if (!reason) return {}
  return { decision: client === 'gemini' ? 'deny' : 'block', reason }
}

export async function main(handler: (client: Client, payload: Payload) => object) {
  const client = process.argv[2]
  if (!['claude', 'codex', 'gemini'].includes(client ?? '')) {
    console.error('Hook requires a supported client argument.')
    process.exitCode = 1
    return
  }
  try {
    let input = ''
    for await (const chunk of process.stdin) {
      input += String(chunk)
      if (input.length > 1024 * 1024) throw new Error('Oversized input')
    }
    const payload: unknown = JSON.parse(input)
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Invalid input')
    console.log(JSON.stringify(handler(client as Client, payload as Payload)))
  }
  catch {
    // Never echo malformed input: it may contain prompts or secrets.
    console.log(JSON.stringify({ systemMessage: 'Project hook could not interpret input; client policy remains in effect.' }))
  }
}
