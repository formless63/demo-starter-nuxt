import { realpathSync } from 'node:fs'
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { guardResponse, main, projectRoot, text, type Payload } from './common.ts'

export interface Decision { reason?: string, warning?: string }
const uncertain = { warning: 'Project guard cannot reliably parse this tool input; review it using normal client approvals.' }

function canonical(path: string): string {
  try { return realpathSync(path) }
  catch {
    const parent = dirname(path)
    return parent === path ? path : resolve(canonical(parent), basename(path))
  }
}

function secretFile(path: string) {
  const parts = basename(path).split('.')
  if (parts[0] !== '' || parts[1] !== 'env') return false
  return !parts.slice(2).some(part => ['example', 'sample', 'template'].includes(part))
}

function protectedWrite(path: string, cwd: string, root: string): boolean {
  const lexical = resolve(cwd, path)
  const target = canonical(lexical)
  const inside = (file: string) => {
    const distance = relative(canonical(root), file)
    return distance !== '..' && !distance.startsWith(`..${sep}`) && !isAbsolute(distance)
  }
  return (inside(lexical) || inside(target)) && (secretFile(lexical) || secretFile(target))
}

// A small lexer for literal POSIX commands, not a shell interpreter. Quoting is
// retained as literal words; expansion/redirects/heredocs fail open with warning.
function literalCommands(command: string): string[][] | undefined {
  const commands: string[][] = []
  let words: string[] = [], word = '', started = false, quote = ''
  const flush = () => { if (started) words.push(word); word = ''; started = false }
  for (let index = 0; index < command.length; index++) {
    const char = command[index]!
    if (quote) {
      if (char === quote) quote = ''
      else if (quote === '"' && (char === '$' || char === '`' || char === '\\')) return undefined
      else word += char
      continue
    }
    if (char === "'" || char === '"') { quote = char; started = true }
    else if (char === '\\') { if (++index >= command.length) return undefined; word += command[index]; started = true }
    else if ('$`<>(){}'.includes(char)) return undefined
    else if (char === '>' || char === '#') return undefined
    else if (';\n&|'.includes(char)) { flush(); if (words.length) commands.push(words); words = [] }
    else if (/\s/.test(char)) flush()
    else { word += char; started = true }
  }
  if (quote) return undefined
  flush()
  if (words.length) commands.push(words)
  return commands
}

export function shellDecision(command: string, cwd: string, root: string): Decision {
  const commands = literalCommands(command)
  if (!commands) return uncertain
  let directory = cwd
  for (const original of commands) {
    const words = [...original]
    // Only unwrap simple command prefixes; no evaluating nested shell strings.
    while (words[0] && (words[0] === 'command' || words[0] === 'sudo')) words.shift()
    while (words[0] && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0])) words.shift()
    const executable = basename(words.shift() ?? '')
    if (executable === 'cd') {
      if (words.length !== 1 || /[*?~]/.test(words[0]!)) return uncertain
      directory = resolve(directory, words[0]!)
    }
    if (executable === 'git') {
      let subcommand = words.shift()
      while (subcommand?.startsWith('-')) {
        if (subcommand === '-C' || subcommand === '-c' || subcommand === '--git-dir' || subcommand === '--work-tree') words.shift()
        else if (!['--no-pager', '--no-optional-locks', '--literal-pathspecs'].includes(subcommand)
          && !subcommand.startsWith('-C') && !subcommand.startsWith('--git-dir=') && !subcommand.startsWith('--work-tree=')) return uncertain
        subcommand = words.shift()
      }
      if (subcommand === 'reset' && words.includes('--hard')) return { reason: 'Project guard: git reset --hard discards repository work.' }
      if (subcommand === 'clean' && words.some(arg => arg === '--force' || /^-[^-]*f/.test(arg))) {
        return { reason: 'Project guard: forced git clean deletes untracked repository files.' }
      }
      if (subcommand === 'push' && words.some(arg => arg === '--force' || arg.startsWith('--force-with-lease') || arg.startsWith('--force=') || /^-[^-]*f/.test(arg) || arg.startsWith('+'))) {
        return { reason: 'Project guard: force push rewrites remote history.' }
      }
    }
    if (executable === 'rm') {
      const recursive = words.some(arg => arg === '--recursive' || /^-[^-]*[rR]/.test(arg))
      if (!recursive) continue
      const targets = words.filter(arg => !arg.startsWith('-'))
      for (const path of targets) {
        if (/[?~]/.test(path)) return uncertain
        // Recognize root globs explicitly; other wildcard paths are uncertain.
        const literal = path.endsWith('/*') ? path.slice(0, -2) : path
        if (literal.includes('*')) return uncertain
        const target = canonical(resolve(directory, literal))
        const repository = canonical(root)
        const git = resolve(repository, '.git')
        const containsRepository = relative(target, repository)
        if ((!containsRepository.startsWith(`..${sep}`) && containsRepository !== '..' && !isAbsolute(containsRepository))
          || target === git || target.startsWith(`${git}${sep}`)) {
          return { reason: 'Project guard: recursive deletion targets the repository root or .git.' }
        }
      }
    }
    if (['bash', 'sh', 'zsh', 'fish', 'python', 'python3', 'node', 'bun', 'eval'].includes(executable)
      && words.some(arg => ['-c', '-e', '--eval'].includes(arg))) return uncertain
  }
  return {}
}

export function toolDecision(payload: Payload, root: string): Decision {
  const name = text(payload.tool_name)
  const input = payload.tool_input
  if (!input || typeof input !== 'object' || Array.isArray(input)) return uncertain
  const args = input as Payload
  const sessionCwd = text(payload.cwd) || root
  // Gemini dir_path is relative to workspace root; Codex exec workdir is
  // relative to the session cwd. Both also accept absolute paths.
  const cwd = name === 'run_shell_command' && text(args.dir_path)
    ? resolve(root, text(args.dir_path))
    : resolve(sessionCwd, text(args.workdir) || text(args.cwd) || '.')
  if (['Bash', 'run_shell_command', 'exec_command', 'shell_command'].includes(name)) {
    const command = text(args.command) || text(args.cmd)
    return command ? shellDecision(command, cwd, root) : uncertain
  }
  if (['Write', 'Edit', 'MultiEdit', 'write_file', 'replace'].includes(name)) {
    const path = text(args.file_path) || text(args.path)
    if (!path) return uncertain
    return protectedWrite(path, cwd, root) ? { reason: 'Project guard: direct editing of secret .env files is blocked; use secure local configuration.' } : {}
  }
  if (name === 'apply_patch') {
    const patch = text(args.command) || text(args.patch)
    if (!patch.startsWith('*** Begin Patch\n')) return uncertain
    const paths = [...patch.matchAll(/^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/gm)].map(match => match[1]!)
    if (!paths.length) return uncertain
    return paths.some(path => protectedWrite(path, cwd, root))
      ? { reason: 'Project guard: patches to secret .env files are blocked; templates remain editable.' }
      : {}
  }
  // Read-only tools are unaffected. Unknown mutation tools retain client policy.
  return /^(?:Read|Glob|Grep|read_|list_|glob|grep|search)/.test(name) ? {} : uncertain
}

if (import.meta.main) await main((client, payload) => {
  const decision = toolDecision(payload, projectRoot)
  return guardResponse(client, decision.reason, decision.warning)
})
