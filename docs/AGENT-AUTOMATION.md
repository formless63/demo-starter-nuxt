# Project agent automation

`AGENTS.md` is canonical guidance; `CLAUDE.md` links to it. `.agents/skills` is the canonical skill tree; `.claude/skills` links to it. Claude and Gemini project settings are thin adapters. `.codex` contains only Codex-specific project runtime configuration (`hooks.json`; no duplicate instructions or skills). Shared local code lives in `.agents/hooks`.

Project hooks execute local code with your permissions. Inspect both settings and scripts before trusting a project, and use each client's normal review/trust controls. Never bypass hook trust in normal usage. Hooks supplement, rather than replace, sandboxing and approvals.

| Client | Project configuration | Inspect / disable |
| --- | --- | --- |
| Codex | `.codex/hooks.json` | `/hooks` shows sources and exact-definition trust; review, trust or disable individual hooks there. Untrusted project hooks are skipped. |
| Claude Code | `.claude/settings.json` | `/hooks` shows configuration. For one run, use `claude --settings '{"disableAllHooks":true}'`; persistent personal overrides belong in untracked `.claude/settings.local.json`. Managed policy hooks may remain active. |
| Gemini CLI | `.gemini/settings.json` | `/hooks panel`, `/hooks disable <name>` or `/hooks disable-all`; use `/hooks enable <name>` or `/hooks enable-all` to restore. Changed project hooks require normal fingerprint review. |

SessionStart injects a short repository/framework, branch and clean/dirty summary, summarized capability status, and a reminder to use matching skills. Codex and Claude refresh after compaction as well as startup/resume; Gemini currently exposes startup/resume/clear, not a post-compaction SessionStart event. Session hooks are read-only; Node 24 supplies context if Bun is temporarily unavailable.

PreToolUse/BeforeTool protects clear literal destructive Git operations, recursive deletion of the repository root or `.git`, and direct edits/patches to secret `.env` variants. `.env.example`, `.env.sample` and other explicit templates remain editable. Ordinary generated-file deletion, disposable fixture teardown, reads and established Docker cleanup remain allowed. Dynamic shell expressions, embedded programs and unknown payload shapes cannot be reliably interpreted: the guard abstains with a warning instead of treating it as a security boundary. It does not inspect transcripts, collect prompts, or send telemetry.

Stop (Codex/Claude) and AfterAgent (Gemini) do nothing on a clean worktree. Otherwise they run both staged and unstaged `git diff --check`; governance changes also run `bun run capabilities:check`, and agent-harness changes run `bun run agents:check`. Overlapping changes run both checkers. Failures return actionable retry feedback. A retry passes as soon as these deterministic failures are fixed; no external service, Docker or credential is required. Full lint, typecheck, tests, Playwright, clean package installation/removal, provider compatibility and production containers remain task/skill/CI responsibilities. There is no per-edit formatter.

Run `bun run agents:check` to validate the harness without installing agent CLIs, and `bun run agents:test` for synthetic payload and temporary Git-fixture tests. `bun run check` includes both alongside the usual full verification.

Schemas and event semantics were checked against current official docs on September 30, 2026: [Codex hooks](https://developers.openai.com/codex/hooks/), [Claude hooks](https://code.claude.com/docs/en/hooks), [Gemini hooks](https://geminicli.com/docs/hooks/) and [Gemini event reference](https://geminicli.com/docs/hooks/reference/). Recheck these sources when changing adapters.
