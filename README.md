# Nuxt Full-Stack Starter

A deployable, modular Nuxt 4 and Vue 3 starter using Bun, PostgreSQL with Drizzle, Better Auth, Tailwind CSS with shadcn-vue and Tabler Icons, Docker Compose, and a complete test/CI path. The repository includes a reference application plus optional Nuxt capability packages that can be kept or removed independently.

## Why this starter

- Production-sensible, provider-neutral defaults with portable Nitro output.
- Explicit reviewed migrations instead of startup-time schema mutation.
- Passwordless authentication with GitHub OAuth, generic OIDC, and optional magic links.
- Native Nitro server routes without a second backend framework.
- A health-checked production image and Compose release workflow.
- Optional capabilities built as normal Nuxt workspace packages.
- Lint, strict typecheck, integration tests, browser tests, package fixtures, and container smoke coverage.
- Concise agent guidance and machine-readable architecture metadata.

This is an opinionated starting point, not a universal application architecture. Keep the pieces that fit the product you are building.

## Base stack

| Baseline | Included |
| --- | --- |
| Application | Nuxt 4, Vue 3, Nitro, strict TypeScript |
| Tooling/runtime | Bun for dependencies and scripts; Node 24 production output |
| Data | PostgreSQL 18, Drizzle ORM, committed SQL migrations |
| Authentication | Better Auth sessions; GitHub OAuth; generic OIDC; optional hashed-token magic links; passwords disabled |
| UI | Tailwind CSS 4, shadcn-vue/Reka UI, Tabler Icons |
| Deployment | Multi-stage Docker image and provider-neutral Compose stack |
| Quality | ESLint, Vitest, Playwright, package lifecycle tests, CI, container smoke |

Optional capabilities are not baseline features. Their source may exist in the repository without making them part of a clean consumer application.

## Available capabilities

| Capability | Status | Default | Requirements | Purpose |
| --- | --- | --- | --- | --- |
| Jobs | Available (`done`) | Optional | Baseline PostgreSQL; external PostgreSQL service | Typed pg-boss jobs, explicit queue migrations, and a standalone worker |
| API Platform | Available (`done`) | Optional | Baseline Nuxt, Better Auth, PostgreSQL, and Drizzle | User-owned API keys, permissions, native `/api/v1` routes, OpenAPI 3.1.1, and Scalar docs |
| Observability | Available (`done`) | Optional | No other capability; OTLP destination optional | Safe server JSON logs, request IDs, traces, metrics and optional OTLP/HTTP export |
| Cache / Coordination | Available (`done`) | Optional | Valkey/Redis-compatible service only when used; no capability dependency | Ephemeral values/counters, advisory token-safe leases and non-durable pub/sub |
| Object Storage | Available (`done`) | Optional | S3-compatible service only when used; no capability dependency | Private objects, streaming, signed GET/PUT, multipart and post-upload policy verification |
| Email | Available (`done`) | Optional | SMTP only when used; no capability dependency | Safe text/HTML SMTP, Mailpit fixture and hashed-token magic links |
| Webhooks | Available (`done`) | Optional | Jobs; remote endpoints only when delivering | Standard signed envelopes, durable delivery and bounded raw-body verification |
| AI | Available (`done`) | Optional | Configured OpenAI-compatible model provider only when used | Text, streaming, Zod structured generation, cancellation and safe errors |
| Audit Log | Available (`done`) | Optional | Baseline PostgreSQL/Drizzle; optional authentication | Transactional append-oriented history and bounded keyset queries |
| Realtime | Available (`done`) | Optional | Node runtime; application session policy; no capability dependency | Bounded server-to-browser SSE and WebSocket event adapters |
| Notifications | Available (`done`) | Optional | Jobs; PostgreSQL/Drizzle; optional Email/Realtime/ntfy | Recipient-scoped persistent notifications and transactional delivery |
| Search | Available (`done`) | Optional | Baseline PostgreSQL/Drizzle; no extra service | Owner-scoped weighted FTS and deterministic keyset pages |
| Organizations / Tenancy | In progress; compatibility gate blocked | Opt-in | Baseline Authentication/PostgreSQL/Drizzle/Node | [Native acceptance transaction finding](ORGANIZATIONS_MODULE_EVALUATION.md) |
| Authorization | In progress; implementation pending | Opt-in | Baseline Authentication/PostgreSQL/Drizzle/Node | Exact-scope application policy; follows Organizations consumer proof |
| Feature Flags | In progress; implementation pending | Opt-in | Baseline PostgreSQL/Drizzle/Node | Independent server boolean controls; follows Authorization |

`defaultInstalled: false` means a clean consumer must explicitly select and enable the capability. The root reference application explicitly enables the capability packages so their integration is continuously tested; Storage, Email, Cache and AI remain lazy with no provider required to boot/build.

See [Using capabilities](docs/CAPABILITIES.md) for installation and removal guidance and [ROADMAP.md](ROADMAP.md) for the future design plan.

## Quick start

Install Node 24, Bun 1.4.2, and Docker with Compose, then:

```sh
cp .env.example .env
docker compose up -d postgres
bun install --frozen-lockfile
bun run db:migrate
bun run jobs:migrate
bun run dev
```

Set a strong `NUXT_AUTH_SECRET` of at least 32 characters. The checked-out reference app explicitly enables all twelve completed capability packages; `db:migrate` applies the application/API/Audit/Notification tables and Projects search vector/index and `jobs:migrate` applies the separately owned pg-boss schema. OAuth providers are optional for local startup.

## Authentication notes

Password authentication is disabled. For GitHub, create an OAuth application with homepage `http://localhost:3000` and authorization callback `http://localhost:3000/api/auth/callback/github`, then set `NUXT_GITHUB_CLIENT_ID` and `NUXT_GITHUB_CLIENT_SECRET`.

Generic OIDC is provider-neutral. Set `NUXT_OIDC_ISSUER`, client ID/secret, and base URL. Better Auth 1.7 treats generic OAuth as a standard social provider, so register redirect URI `${NUXT_PUBLIC_APP_BASE_URL}/api/auth/callback/oidc` (not the retired `/oauth2/callback/` route) and post-logout URI `${NUXT_PUBLIC_APP_BASE_URL}`. Discovery, issuer checks, OAuth state, and PKCE are handled by Better Auth. GitHub remains independent.

Magic links are opt-in with `NUXT_MAGIC_LINK_ENABLED=true`. Configure the optional Email SMTP transport and canonical app URL; delivery is awaited and links/tokens are never logged, including in development.

### Pocket ID development provisioning

Set `DEV_OIDC_ADMIN_URL`, `DEV_OIDC_API_KEY`, and `APP_BASE_URL`, then run `bun run auth:provision`. It authenticates with Pocket ID's `X-API-KEY` header, creates or updates the named client, and uses the dedicated client-secret endpoint when no usable local secret exists. It preserves matching local credentials, replaces managed keys instead of appending duplicates, writes ignored `.env.local` with mode `0600`, and exits with actionable diagnostics when configuration or the IdP is unavailable. Revalidate the current Pocket ID API when upgrading that external service.

## Starting a project

Choose one of two supported paths:

1. **Use the full reference application.** Keep the selected capabilities enabled. This preserves the integrated worker, API-key UI, external API, safe server telemetry, and production Compose path.
2. **Start lean.** Keep the baseline and remove any optional capabilities before product work. Capabilities can be re-enabled later from their local packages and contracts.

[Starting a project](docs/STARTING-A-PROJECT.md) contains verified, capability-specific removal recipes and distinguishes a disposable never-deployed project from an already-deployed application.

## Verification

```sh
bun install --frozen-lockfile
bun run capabilities:status
bun run capabilities:check
bun run packages:test jobs
bun run packages:test api-platform
bun run packages:test observability
bun run packages:test object-storage
bun run packages:test email
bun run packages:test webhooks
bun run packages:test audit-log
bun run packages:test cache-coordination
bun run packages:test realtime
bun run packages:test notifications
bun run packages:test ai
bun run check
bun run test:e2e
```

PostgreSQL and committed migrations are required for database integration tests and E2E session restoration. Playwright may first require `bunx playwright install chromium`. See [.agents/context/commands.md](.agents/context/commands.md) for the full command contract.

## Deployment

Normal runtime startup never mutates the database. Build one image, use it for the explicit migration gate and runtime services, then verify health:

```sh
docker compose build app
docker compose run --rm migrate
docker compose up -d --wait app worker
curl --fail http://localhost:${APP_PORT:-3000}/api/health
docker compose logs -f app worker postgres
docker compose down --remove-orphans
```

Set production `NUXT_AUTH_SECRET` and `NUXT_PUBLIC_APP_BASE_URL` values in the environment. Compose connects to the `postgres` service rather than localhost. `APP_IMAGE`, `APP_PORT`, and `POSTGRES_PORT` are configurable. A failed migration is a failed deployment; do not update the runtime services after it fails. Add `--volumes` to `docker compose down` only when intentionally deleting PostgreSQL data.

For an image update, check out the intended revision or select a registry tag with `APP_IMAGE`, build or pull that image, run `migrate`, and only then recreate `app` and `worker` with `--wait`.

## Server observability

Without a backend, the reference app produces safe Pino JSON logs, returns `X-Request-ID`, correlates nested operation spans, and adds safe build/export-enabled metadata to `/api/health`. Set `APP_VERSION`, `APP_REVISION` and `DEPLOYMENT_ENVIRONMENT` at release time. To export traces/metrics, set `OTEL_EXPORTER_OTLP_ENDPOINT` to an OTLP/HTTP JSON destination; each signal can be disabled independently with `OTEL_TRACES_EXPORTER=none` or `OTEL_METRICS_EXPORTER=none`. Compose passes these settings to the app and worker; no collector is required or started.

Raw request headers/bodies/query strings, job payloads, sessions/users and credentials are omitted. Use safe operation names/messages and extend `observability.redactKeys` for application secrets. This is server-only v1—no browser instrumentation or analytics. See the [Observability contract](capabilities/observability/CAPABILITY.md) for configuration, safe error behavior, optional Jobs/API wrappers, shutdown and removal.

## Object storage

Storage is a server-only S3 primitive, not a File UI or attachments model. It requires an existing private bucket and explicit region only when used: `STORAGE_REGION` → `AWS_REGION` → `AWS_DEFAULT_REGION` → configuration error; unused builds/boot remain backendless. `bun run storage:dev:rustfs` explicitly starts the preferred RustFS 1.0.0 local profile; `storage:dev:garage` starts Garage 2.4.1. Set the printed endpoint/bucket/region and matching development credentials, then run `storage:check` (read-only) or `storage:smoke` (unique temporary objects with cleanup). `storage:dev:down` stops providers while retaining data. Optional `compose.storage.yaml` leaves normal PostgreSQL/app/worker deployment independent of storage infrastructure. Third-party **Noooste Garage UI v0.13.0** (`noooste/garage-ui:v0.13.0`) is localhost-only development/operator tooling, not official Garage software or required for S3. It uses privileged admin-token login; known dev tokens are local-only and must never enter application browser code or normal S3 clients. See the [Storage contract](capabilities/object-storage/CAPABILITY.md#composeinfrastructure) for configuration and access.

Use the standard AWS credential chain or paired server-only static credentials. Signed PUT headers must match exactly; post-upload HEAD checks enforce the baseline size/type policy, not a universal pre-ingest size limit. Consume or close streaming downloads and never log signed URLs. See the [Storage contract](capabilities/object-storage/CAPABILITY.md) for configuration, explicit bucket/CORS bootstrap, multipart, optional telemetry and removal.

## Repository and capability development

- `app/` and `server/` contain the reference application.
- `packages/nuxt-*` contains private, publish-shaped optional Nuxt packages.
- `fixtures/*-consumer` proves tarball installation, runtime behavior, and clean removal like an external consumer.
- `capabilities/*/CAPABILITY.md` is the technical installation/removal contract for each completed capability.
- `capabilities/catalog.json` drives validation, package discovery, and the CI matrix.
- `ROADMAP.md` records planned capabilities and their dependency relationships.
- `.agents/` contains focused maintenance context and workflows.

The private `@repo/*` package scope means “inside this workspace.” These packages are not published; choose a real npm scope deliberately before any future release. Nuxt's module system remains the integration mechanism—there is no custom installer or runtime capability manager.

Email (#5) is an optional server-only SMTP package. See the [Email contract](capabilities/email/CAPABILITY.md) for lazy configuration, local Mailpit, safe magic links and removal. Better Auth 1.7.7 upgrades require a coordinated cutover of nodes sharing verification storage: request new magic links and restart pending OAuth/SAML sign-in or linking flows. Existing hashed Magic Link tokens with global identifier storage unset already match the advisory mitigation; this upgrade does not establish prior vulnerability. No auth schema or user/account migration is required. See the [upstream advisory](https://github.com/better-auth/better-auth/security/advisories/GHSA-965c-763c-88jm).

The root sample Project accepts a trimmed name of 1–120 characters and an optional description of at most 1000 characters; empty descriptions become `null`. Browser inputs, session/machine APIs and generated OpenAPI share these limits. PostgreSQL keeps the existing text columns, with input limits enforced at HTTP validation; applied migrations remain unchanged.

Webhooks is explicitly enabled as `@repo/nuxt-webhooks` and requires Jobs; see its [contract](capabilities/webhooks/CAPABILITY.md). Run `bun run webhooks:smoke` for a local receiver test.

## Cache / Coordination

Explicitly enabled in the reference app and lazy at boot/build. Server-only `@repo/nuxt-cache` supplies exact namespaced string/byte values, expiring writes, atomic counters, advisory leases and non-durable pub/sub. Optional application-owned Realtime fanout uses pub/sub; Jobs remains PostgreSQL-durable. `cache:dev:valkey` starts pinned disposable localhost Valkey; `cache:check`, `cache:smoke` and `cache:dev:down` use explicit configuration. Leases have no fencing or quorum and cannot alone protect irreversible correctness. See the [contract](capabilities/cache-coordination/CAPABILITY.md) and [evaluation](CACHE_COORDINATION_MODULE_EVALUATION.md).

## Realtime and Notifications

Choose **SSE**, **WebSocket**, or **Both** with server-only `REALTIME_TRANSPORTS=sse` (default), `websocket`, or `sse,websocket`. Both adapters are included. WebSocket v1 carries the same server event stream, not generic RPC, and uses transport-only ping/pong heartbeats. Session-authenticated routes authorize exact channels; reconnect then refetch authoritative state because events and optional Cache fanout have no replay guarantee. See the [Realtime contract](capabilities/realtime/CAPABILITY.md).

Notifications stores recipient-scoped plain records in an application-migrated table. The existing Jobs worker reloads records/current destinations for optional Email/ntfy delivery; queued data contains only notification ID and channel. The reference demo publishes an ID-only realtime hint after commit. ntfy requires an explicitly configured trusted server and application topic resolver; there is no public ntfy default. Optional transports are unnecessary for build/boot. See the [Notifications contract](capabilities/notifications/CAPABILITY.md).

## Search

Opt-in PostgreSQL-native `@repo/nuxt-search` server helpers; the reference Projects endpoint searches owner rows using weighted `simple` FTS. Apply the explicit application migration first. Page size 25 (1–100); canonical rank/timestamp/ID cursor. No query logs or extra service. See [Search contract](capabilities/search/CAPABILITY.md) and [evaluation](SEARCH_MODULE_EVALUATION.md).

## AI

Explicitly enabled, server-only and operation-lazy. `@repo/nuxt-ai/server` provides text, incremental streaming and Zod structured generation; default provider openai-compatible, timeout 60 seconds, no retries, 1 MiB output cap. Set AI_MODEL and optional server AI_API_KEY/AI_BASE_URL only when used. `bun run ai:smoke` performs one intentional configured operation without logging generated content. See the [contract](capabilities/ai/CAPABILITY.md) and [evaluation](AI_MODULE_EVALUATION.md).
