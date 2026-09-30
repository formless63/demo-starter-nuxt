# Shared project hooks

`session-context.ts`, `tool-guard.ts` and `quality-gate.ts` contain the policy. `common.ts` handles bounded subprocesses, input and client response shapes. The small `session-context.sh` launcher falls back to Node 24's TypeScript support when Bun is unavailable. Other hooks require Bun, the repository prerequisite.

Clients pass a JSON object on stdin and a `claude`, `codex` or `gemini` argument. stdout is one JSON response; inputs, transcripts, environment values and diffs are never echoed. Scripts resolve the repository from their own location, independent of the client's cwd. Guards use the tool's supplied cwd for literal path checks. Commands are never evaluated by the guard. Subprocesses in context/gates are fixed argument arrays, capped at four seconds each.

Adapters live in `.claude/settings.json`, `.codex/hooks.json` and `.gemini/settings.json`. They deliberately abstain on benign tools rather than overriding the client's permission policy with a blanket approval. Detailed trust controls and automatic/manual verification boundaries: [Agent automation](../../docs/AGENT-AUTOMATION.md).
