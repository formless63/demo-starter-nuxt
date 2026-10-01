# AI module evaluation

Research date: 2026-10-01. Scope: private, server-only Nuxt/Nitro AI v1. Source of shared semantics is the user's implementation prompt; no other framework repository was consulted.

## Current stable options

Registry checks found OpenAI `7.25.0`, AI SDK `ai@7.0.126` and `@ai-sdk/openai-compatible@3.0.62`. All support Node >=22, including Node 24. [OpenAI release](https://github.com/openai/openai-node/releases/tag/v7.25.0) and [official README](https://github.com/openai/openai-node#requirements) explicitly support Node 24 LTS and Nitro >=2.6, SSE, request signals, custom base URLs, disabling retries and disabling logging. Its Chat Completions interface is supported indefinitely and suits compatible hosted/self-hosted endpoints better than requiring Responses API.

Selected **OpenAI SDK 7.25.0**, package-owned alongside **Zod 4.6.5**. Plain Chat Completions streams serve all modes; bounded collection implements text and structured generation, incremental mapping implements streaming. This keeps compatible transport details inside the package. SDK defaults (two retries, ten-minute request timeout, warning logs) are overridden with zero retries, configured timeout plus whole-operation AbortController, and logging off. Standard fetch owns no extra application pool to shut down. Config does not fall through to OPENAI_* variables.

AI SDK's compatible adapter is viable and adds an abstraction/provider stack but is unnecessary for one finite provider ID. Direct fetch would require a new SSE parser/error transport implementation that the official SDK already supplies. Nuxt ecosystem approaches reviewed include ordinary Nuxt server routes/composables and [NuxtHub](https://github.com/nuxt-hub/core) infrastructure composition; a broad infrastructure module or browser/chat helper is unnecessary here. Use the repository's normal `@nuxt/module-builder` 1.0.3, Nuxt 4.5.2 peer, server imports and native Nitro application boundaries. No Hono/Fastify/Express, runtime capability loader or AI route added by installation.

## Cross-framework v1 contract

This canonical contract is stated from **this prompt**, not another repository's source:

- Relationships: requires []; integratesWith jobs/object-storage/observability/audit-log; baseline node-runtime; external configured model provider only on use; defaultInstalled false. Root explicitly enables AI, with no provider at install/build/boot/health.
- Server-side text generation, real incremental text streaming, Zod-validated structured generation, finite model/provider config, whole-operation timeout/cancellation, normalized usage and safe errors.
- Finite provider ID `openai-compatible`; any compatible OpenAI/hosted/self-hosted endpoint. No raw SDK clients/responses in ordinary application APIs.
- Server config: AI_PROVIDER defaults openai-compatible and accepts only that ID; AI_MODEL required lazily, 1–128 printable characters; AI_API_KEY optional structurally/server-only; AI_BASE_URL optional with standard adapter upstream default, explicit non-HTTPS only for deliberate localhost/test development; AI_TIMEOUT_SECONDS defaults 60, integer 1–300.
- Input: 1–100 text messages, roles system/user/assistant, <=64 KiB UTF-8 each, <=256 KiB total. Optional temperature 0–2; integer maxOutputTokens 1–65536. No arbitrary provider bag, tools, images/audio/files.
- Text result `{ text, finishReason, usage? }`; reasons stop/length/content-filter/other; optional inputTokens/outputTokens/totalTokens finite non-negative integers. Accumulated output <=1 MiB UTF-8; no raw response.
- Structured success requires completion, JSON parse and authoritative Zod validation; malformed/schema-invalid output invalid-output. Native JSON features may optimize. Structured output <=1 MiB.
- Stream events `{ type: 'text-delta', text }`, and exactly one successful `{ type: 'finish', finishReason, usage? }`. Incremental, no pre-yield full-response buffering, <=1 MiB total. Signals/timeouts abort provider work; return/disconnect cleanup; safe errors, no raw chunks. Failed streams emit no successful terminal.
- Configured timeout covers entire operation; compose caller cancellation. No automatic AI retry: Jobs/application owns policy.
- Safe codes configuration/authentication/rate-limit/timeout/unavailable/invalid-request/invalid-output/cancelled/unknown, with static message/retryability only. Never automatically serialize/log prompts, output, API key, provider response, headers or raw SDK errors.
- Optional root Observability adapter may emit operation, finite provider ID, outcome, duration seconds, usage counts and finite finish reason only. No default model metric label or user content.
- Jobs: app workflows only. Storage: artifact consumer, no AI file model. Audit: safe operation fact, no copied content. Observability: optional app adapter. No capability dependency.
- Excludes conversation DB/history, chat UI, agents, arbitrary tools, MCP, embeddings/vector search/RAG, ingestion, billing, prompt CMS and generic queued AI. No Search/Realtime/Notifications or later roadmap work.
- Private package/packed fixture and catalog-driven build/install/Node boot/runtime/removal/post-removal build. Removal deletes module/dependency/config/app wrappers/call sites, has no migration, never automatically deletes/revokes provider accounts/secrets.

## Implementation defaults and limits

Defaults: provider openai-compatible; upstream `https://api.openai.com/v1`; model unset; key optional, absent key omits Authorization; timeout 60 seconds; no temperature/token override unless supplied; retries zero; output cap 1,048,576 bytes. Strict input does not spread unknown provider properties. Printable model identifiers count Unicode characters and reject controls, format characters, unpaired surrogates and line separators. HTTPS URLs reject credentials/query/fragment and redirects; literal loopback HTTP is the deliberate development/test exception.

Structured native JSON-object mode requires the caller to ask for JSON; Zod remains authoritative, including asynchronous refinements within the deadline. A stop finish is required for structured success. Incomplete streams fail invalid-output. Usage from the trailing SSE chunk is retained and invalid individual counts omitted. Retryability is a workflow hint; a timeout may still incur provider cost. Consumers own prompt quality, provider/model feature compatibility, authorization and retry policy.

Nuxt-specific wiring: server-only getAi auto-import, explicit @repo/nuxt-ai/server exports, native Nitro response-close signal in streaming HTTP consumers. These are framework integration details; no unavoidable difference in the observable v1 contract. No owned transport pool/background resource requires a shutdown hook.

## Verification evidence

The deterministic local Node HTTP fixture exercises the actual packed OpenAI SDK, including completion/normalization, streaming before final output, structured JSON, malformed/schema-invalid/truncated output, authentication, rate limits, provider 5xx, whole-operation stalls, caller/iterator cancellation and UTF-8 overflow. It runs on Node 24 and Bun; a built Nuxt fixture checks backendless boot, server auto-import and disconnect cleanup. Generic lifecycle removes the package and owned SDK, then typechecks/builds. Normal root and production verification follows the canonical repository commands; hosted CI uses the existing catalog matrix without an AI-specific job.
