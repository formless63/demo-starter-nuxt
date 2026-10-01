# AI

Private optional Nuxt package `@repo/nuxt-ai` in `packages/nuxt-ai`; clean consumer `fixtures/ai-consumer`. `defaultInstalled: false`; the root reference application deliberately enables it. Requires no other capability; baseline Node 24. Jobs, Object Storage, Observability and Audit Log are optional application integrations. A configured model provider is required only when used. No database, routes, UI, startup calls or health dependency.

## Install and server API

Keep `"@repo/nuxt-ai": "workspace:*"` and explicitly register `'@repo/nuxt-ai'` in Nuxt `modules`. Outside this workspace use a locally packed tarball; the private scope is unpublished. The normal `@nuxt/module-builder` artifact owns OpenAI SDK 7.25.0 and Zod 4.6.5; Nuxt is a peer. No browser auto-imports. `getAi` is server-only; explicit imports use `@repo/nuxt-ai/server`. `createAi(env?)` also supports standalone server consumers. Creating an instance or calling `getAi` does not read required config or connect; operations resolve server environment lazily. Clients use standard fetch without owned pools/background resources, so no Nitro shutdown resource hook is needed.

```ts
import { getAi, z } from '@repo/nuxt-ai/server'
const ai = getAi()
const input = { messages: [{ role: 'user' as const, content: 'Return JSON with a greeting.' }] }
const result = await ai.generateText(input, { signal })
const structured = await ai.generateStructured(input, z.object({ greeting: z.string() }), { signal })
for await (const event of ai.streamText(input, { signal })) {
  // Consume normalized events. Break/return closes provider work.
}
```

`generateText` returns `{ text, finishReason, usage? }`. `generateStructured` returns `{ data, finishReason, usage? }`, requires stop completion, JSON parsing and authoritative Zod validation; native JSON mode optimizes the request but does not replace validation. Async Zod validation is included in the deadline. Send a JSON instruction in structured prompts as required by compatible providers. Never expose the SDK/client/response to callers.

## Configuration

Server-only, read on operations, never copied to public Nuxt runtimeConfig:

| Variable | Contract/default |
| --- | --- |
| `AI_PROVIDER` | `openai-compatible`; only accepted v1 ID |
| `AI_MODEL` | Required lazily; 1–128 printable characters |
| `AI_API_KEY` | Optional structurally; upstream may require it; absent key omits Authorization |
| `AI_BASE_URL` | `https://api.openai.com/v1`; explicit HTTPS endpoint, or deliberate literal loopback HTTP (`localhost`, `127.0.0.1`, `::1`) for test/development |
| `AI_TIMEOUT_SECONDS` | 60; integer 1–300 |

URLs cannot contain credentials, query or fragment; redirects are rejected. SDK `OPENAI_*` config is not implicitly consulted. No credentials/network are required at install, build, boot or health. Compose passes optional AI settings only to the app. Runtime never starts a provider.

## Input, output and cancellation

Text-only roles `system`, `user`, `assistant`; 1–100 messages, at most 64 KiB UTF-8 per message and 256 KiB total. Optional temperature 0–2 and integer maxOutputTokens 1–65536. Strict input rejects arbitrary options/tools/images/audio/files. Maximum accumulated output is 1 MiB UTF-8 for all modes. Generation collects the actual SDK stream with this bound; streaming yields incrementally without accumulating output.

Finish reasons are `stop`, `length`, `content-filter`, `other`. Optional inputTokens/outputTokens/totalTokens are finite non-negative integers; invalid counts are omitted. Stream events are `{ type: 'text-delta', text }` followed by exactly one successful `{ type: 'finish', finishReason, usage? }`. Trailing usage is read before terminal delivery. Truncated/malformed streams and overflow fail safely with no successful terminal. A stream is single-consumer; consume it, return/break or cancel its signal. For Nitro streaming HTTP boundaries attach a caller AbortSignal to response close and propagate readable-stream cancellation; see the fixture route. Async iterator `return()` interrupts a pending provider read immediately.

The configured timeout covers the whole operation, including stream pauses and structured validation, and aborts underlying work. Caller cancellation composes with it. There is **no automatic AI retry** (`maxRetries: 0`); Jobs/application workflow owns retries and their cost implications.

## Errors and privacy

`AiError` exposes only safe code/static message/retryability through JSON/string/inspect. Codes: configuration, authentication, rate-limit, timeout, unavailable, invalid-request, invalid-output, cancelled, unknown. Rate-limit/timeout/unavailable are retryable hints, never an automatic retry. No raw SDK cause is retained. SDK logging is explicitly off even if `OPENAI_LOG` is set. Never serialize/log prompts, outputs, key, headers, provider responses or raw errors. No model label in metrics.

Root `generateObservedText` emits only operation, finite provider ID, outcome, duration seconds, validated usage and finite finish reason. It has no hard package dependency impact. Jobs integrations are app-owned workflows, storage may consume artifacts without an AI file model, Audit may record a safe operation fact without prompt/output copying. No conversation DB/history, chat UI, agents, arbitrary tools, MCP, embeddings/vector search/RAG, ingestion, billing, prompt CMS or generic queued AI.

## Verification and removal

`bun run packages:test ai` packs/installs, typechecks/builds, boots Node backendless, runs the actual local SDK adapter on Node 24 and Bun, checks Nitro imports/disconnect, removes the package and owned OpenAI dependency, then typechecks/builds again. The deterministic HTTP fixture requires no production credential and covers completion, streaming, structured JSON, malformed output, Zod failure, auth/rate/5xx, stall/timeout, cancellation and overflow. Zod may remain when shared by Nuxt/other code. `bun run ai:smoke` is an explicitly invoked single configured operation; it logs no generated content. See `AI_MODULE_EVALUATION.md` for the prompt-derived cross-framework contract.

Remove module/dependency, AI env/config, `server/utils/observed-ai.ts`, `scripts/ai-smoke.ts`, aliases and all consumer call sites. Remove `ai` from reference enablement and matching script declarations; clear generated output, reinstall and verify. No schema or data migration. Never delete/revoke external provider accounts or secrets automatically. Removing Observability while retaining AI means replacing the app wrapper with plain `getAi().generateText` and removing optional telemetry only. Permanent pruning updates catalog/docs consistently before deleting package/fixture/contract/evaluation/skill, retaining the roadmap ID where referenced.
