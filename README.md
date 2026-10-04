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
| Invoice Ninja | Available (`done`) | Optional | Jobs, Webhooks; configured provider on use | Scoped projections, reconciliation and durable draft ledger; pinned disposable provider compatibility verified |
| Stripe | Available (`done`) | Optional | Jobs, Webhooks; configured provider on use | Bound one-time Checkout, local payment projections and native signed-event reconciliation |
| Medusa | Available (`done`) | Optional | Jobs, Webhooks; configured provider on use | Scoped Admin product/order reads and an operator-installed application bridge |
| Command System | Available (`done`) | Optional | None | Application-owned commands, accessible keyboard palette |
| Ops / Admin | Available (`done`) | Optional | Baseline human session; privileged server allowlist | Read-only sanitized application-owned diagnostic adapters |
| Search | Available (`done`) | Optional | Baseline PostgreSQL/Drizzle; no extra service | Owner-scoped weighted FTS and deterministic keyset pages |
| Data Table | Available (`done`) | Optional | None | Accessible controlled TanStack Vue tables with manual server modes |
| Markdown / Code Content | Available (`done`) | Optional | None | Bounded server Markdown/Shiki with safe native Vue SSR and copy UI |
| Internationalization | Available (`done`) | Optional | None | Explicit locale, bounded translations, CLDR plurals and canonical SSR formatting |
| File UI | Available (`done`) | Optional | Object Storage | Bounded raw uploads, owner-authorized attachment downloads and atomic retained receipts |
| Flow / Canvas | Available (`done`) | Optional | None | Controlled native Vue diagrams with bounded graph JSON and semantic SSR |
| PWA / Offline | Done | Optional | None | Explicit native registration; only a public inert notice and fingerprinted icons |
| Rich Text / Tiptap | Available (`done`) | Optional | None | Bounded canonical JSON, safe Vue SSR and controlled lazy editing with explicit record identity |
| Import / Export | Available (`done`) | Optional | Jobs, Object Storage; PostgreSQL/Drizzle/Node | Durable bounded CSV transfer; personal Project round-trip |
| Charts / Visualization | Available (`done`) | Optional | None | Accessible line, bar, and area charts with SSR table fallback |

| Organizations / Tenancy | In progress; current verification paused | Opt-in | Baseline Authentication/PostgreSQL/Drizzle/Node | [Native acceptance transaction finding](docs/evaluations/ORGANIZATIONS_MODULE_EVALUATION.md) |
| Authorization | In progress; current verification paused | Opt-in | Baseline Authentication/PostgreSQL/Drizzle/Node | [Exact-scope application policy](capabilities/authorization/CAPABILITY.md) |
| Feature Flags | In progress; current verification paused | Opt-in | Baseline PostgreSQL/Drizzle/Node | [Server boolean controls](capabilities/feature-flags/CAPABILITY.md) |

`defaultInstalled: false` means a clean consumer must explicitly select and enable the capability. The root reference application explicitly enables the capability packages so their integration is continuously tested; Storage, Email, Cache, AI, Invoice Ninja, Stripe and Medusa remain lazy with no provider required to boot/build. The accepted twenty-six capabilities remain `done`; Organizations, Authorization and Feature Flags are additionally reference-enabled and remain `in-progress`.

Data Table source-baseline evidence: the [combined CI run](https://github.com/formless63/demo-starter-nuxt/actions/runs/37008356538) passed all 20 jobs at `bfad9dce3ade72a42836d79103947de63a2a8279`, including all 18 generic package lifecycles and the full application check, browser suite, explicit migrations, production container/health and worker checks.

Charts source `7e8daa68c9862ef982c6dd0aa7e4269903eda9fd` passed [all 20 CI jobs](https://github.com/formless63/demo-starter-nuxt/actions/runs/37018899032). Command retains its separately verified implementation ([all 20 jobs at e0a01fa](https://github.com/formless63/demo-starter-nuxt/actions/runs/37012702417)). Markdown / Code Content implementation `e99539d90020a70028545ac4f252c55c16e3f432` passed [all 23 CI jobs](https://github.com/formless63/demo-starter-nuxt/actions/runs/37029379598): all 21 generic packed package lifecycles, corrected real-browser payload/hydration/copy checks, full root checks, production browser/container/health, migrations and worker verification. This is source evidence; metadata promotion and later revisions require their own exact-head CI.

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

Set a strong `NUXT_AUTH_SECRET` of at least 32 characters. The checked-out reference app explicitly enables all twenty-six completed capability packages; `db:migrate` applies the application/API/Audit/Notification/transfer/provider tables and Projects search vector/index and `jobs:migrate` applies the separately owned pg-boss schema. OAuth providers are optional for local startup.

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

Explicitly enabled in the reference app and lazy at boot/build. Server-only `@repo/nuxt-cache` supplies exact namespaced string/byte values, expiring writes, atomic counters, advisory leases and non-durable pub/sub. Optional application-owned Realtime fanout uses pub/sub; Jobs remains PostgreSQL-durable. `cache:dev:valkey` starts pinned disposable localhost Valkey; `cache:check`, `cache:smoke` and `cache:dev:down` use explicit configuration. Leases have no fencing or quorum and cannot alone protect irreversible correctness. See the [contract](capabilities/cache-coordination/CAPABILITY.md) and [evaluation](docs/evaluations/CACHE_COORDINATION_MODULE_EVALUATION.md).

## Realtime and Notifications

Choose **SSE**, **WebSocket**, or **Both** with server-only `REALTIME_TRANSPORTS=sse` (default), `websocket`, or `sse,websocket`. Both adapters are included. WebSocket v1 carries the same server event stream, not generic RPC, and uses transport-only ping/pong heartbeats. Session-authenticated routes authorize exact channels; reconnect then refetch authoritative state because events and optional Cache fanout have no replay guarantee. See the [Realtime contract](capabilities/realtime/CAPABILITY.md).

Notifications stores recipient-scoped plain records in an application-migrated table. The existing Jobs worker reloads records/current destinations for optional Email/ntfy delivery; queued data contains only notification ID and channel. The reference demo publishes an ID-only realtime hint after commit. ntfy requires an explicitly configured trusted server and application topic resolver; there is no public ntfy default. Optional transports are unnecessary for build/boot. See the [Notifications contract](capabilities/notifications/CAPABILITY.md).

## Search

Opt-in PostgreSQL-native `@repo/nuxt-search` server helpers; the reference Projects endpoint searches owner rows using weighted `simple` FTS. Apply the explicit application migration first. Page size 25 (1–100); canonical rank/timestamp/ID cursor. No query logs or extra service. See [Search contract](capabilities/search/CAPABILITY.md) and [evaluation](docs/evaluations/SEARCH_MODULE_EVALUATION.md).

## AI

Explicitly enabled, server-only and operation-lazy. `@repo/nuxt-ai/server` provides text, incremental streaming and Zod structured generation; default provider openai-compatible, timeout 60 seconds, no retries, 1 MiB output cap. Set AI_MODEL and optional server AI_API_KEY/AI_BASE_URL only when used. `bun run ai:smoke` performs one intentional configured operation without logging generated content. See the [contract](capabilities/ai/CAPABILITY.md) and [evaluation](docs/evaluations/AI_MODULE_EVALUATION.md).

Ops / Admin is available (`done`): opt-in read-only `/admin/ops`, privileged server-only baseline-user allowlist and application-owned safe adapters. [Contract](capabilities/ops-admin/CAPABILITY.md).

## Invoice Ninja

Invoice Ninja is available (`done`) as `@repo/nuxt-invoice-ninja`. The pinned disposable 5.13.43 fixture verifies native numeric-string draft/GET behavior and its isolated unsent zero-tax/discount policy. The reference app still has no draft policy: each deployment must supply its own currency/company-hook evidence. See the [contract](capabilities/invoice-ninja/CAPABILITY.md) and [evaluation](docs/evaluations/INVOICE_NINJA_MODULE_EVALUATION.md).

## Stripe

Stripe v1 is available (`done`), independently packaged as `@repo/nuxt-stripe` with Jobs/Webhooks hard dependencies. The `/stripe` reference requires authentication and explicit server customer bindings; optional operator-owned `STRIPE_REFERENCE_PRICE_ID`, `STRIPE_REFERENCE_CURRENCY`, `STRIPE_REFERENCE_SUCCESS_URL` and `STRIPE_REFERENCE_CANCEL_URL` configure the single registered `starter.one-time` offer. Missing configuration remains lazy503. [Contract](capabilities/stripe/CAPABILITY.md); [design/compatibility limits](docs/evaluations/STRIPE_MODULE_EVALUATION.md). No remote account, payment or registration is required for base startup or local verification.

## Medusa

The reference app explicitly enables private `@repo/nuxt-medusa`; clean consumers default to uninstalled. Requires Jobs and Webhooks. [Provider contract](capabilities/medusa/CAPABILITY.md) covers bounded scoped Admin reconciliation, the operator-installed application bridge, verification and independent removal. `/integrations/medusa` reads approved local product/order projections; no provider configuration is required for startup.

Medusa 2.21.2 backend/subscriber compatibility is verified against the pinned disposable fixture. None of these provider checks certify financial activity or a remote production deployment.

Command System is available (`done`): opt-in native Nuxt command palette and application-owned registry. Keyboard, focus, async execution and interruption contracts live in the [capability contract](capabilities/command-system/CAPABILITY.md). Reference: `/commands`.

Markdown / Code Content is available (`done`): optional `@repo/nuxt-markdown-code`, native Vue renderer and bounded server parsing at `/markdown`. See [contract](capabilities/markdown-code/CAPABILITY.md).

Rich Text / Tiptap is an opt-in completed native Vue package. The reference page `/rich-text-test` demonstrates bounded safe JSON with lazy editing and caller-owned state. See [contract](capabilities/rich-text/CAPABILITY.md).

Rich Text source `1666bb6e252fbedbbe20b545de8117e8a246820f` passed [all 23 CI jobs](https://github.com/formless63/demo-starter-nuxt/actions/runs/37031826840), including its real packed browser/removal lifecycle and full root production gates. The reviewed Markdown/Rich Text promotion `f1bbea44407704973dd2168cda3c23115028c487` passed [all 24 hosted CI jobs](https://github.com/formless63/demo-starter-nuxt/actions/runs/37037650525), recording 22 completed opt-in capabilities. This File UI composition requires its own exact-head full CI before acceptance.

File UI (`done`) is an opt-in native Nuxt package with bounded raw uploads, owner-authorized attachment downloads, atomic lifecycle adapters and an accessible Vue manager. Root reference: `/files`; [contract](capabilities/file-ui/CAPABILITY.md). Only Object Storage is a hard dependency. Source review and full hosted gates passed; this combined successor still requires its own hosted verification.

File UI source `8063f37b71aa679ed6cacd80c68aa30720289c0a` passed [all 24 hosted CI jobs](https://github.com/formless63/demo-starter-nuxt/actions/runs/37040678932), including packed native/provider/browser/removal and root application/production gates. Historical Rich Text / File UI composition checkpoint: 23 completed opt-in, reference-enabled capabilities, with its own CI/review pending at that time. Accepted main `bf15830889757b76b44a71fac80461deaca22cd1` is now the baseline for the 24-capability Flow composition below.

## Flow / Canvas

Optional private `@repo/nuxt-flow-canvas` provides controlled native Vue editing and bounded server-safe graph JSON. Default installation remains false; this reference explicitly enables `/flow-test`. Applications own state and persistence. No database, migrations, network, or hard capability dependencies. See [contract](capabilities/flow-canvas/CAPABILITY.md). Remove the explicit module/dependency and `app/pages/flow-test.vue`/`server/api/flow-reference.get.ts`, update reference enablement/tests, then install/typecheck/build; existing graph documents are application-owned. Source gates passed; combined exact-head hosted gates remain pending.

Flow / Canvas source `1999dab23987aa90efa62411275b7075b974d593` passed [all 24 CI jobs](https://github.com/formless63/demo-starter-nuxt/actions/runs/37040851945), including the real native browser and independent packed install/runtime/removal/rebuild gates, and independent review. The 24-capability Flow composition and Rich Text focus fix are accepted in main `f1210c7c58dcebc24558042f34c39af9c03d1929`. That historical 25-capability composition subsequently passed full CI and was accepted as main `d8ca417919b5f9dd352fb7ba0b41d427da503e5a`.

## Internationalization

Opt-in `@repo/nuxt-internationalization` supplies request-local plain-text translation, CLDR plurals and canonical SSR formatting. The reference app explicitly enables `/i18n-test`; no automatic locale routing or persistence. See [contract](capabilities/internationalization/CAPABILITY.md) for install, validation, browser gates and exact removal recipe.

Internationalization source `96c24efcfc7e6fa31381dc4839be80ef75293a7b` passed [all 26 hosted CI jobs](https://github.com/formless63/demo-starter-nuxt/actions/runs/37052330442), including root native browser/production and packed install/types/build/provider/browser/removal/rebuild gates. It is completed, default-off and explicitly reference-enabled. The accepted 25-capability composition, including Flow / Canvas and the Rich Text focus fix, passed [all 27 hosted CI jobs](https://github.com/formless63/demo-starter-nuxt/actions/runs/37122326222) at PR #27 source `3b35cc07` and was merged as main `d8ca417919b5f9dd352fb7ba0b41d427da503e5a`. This PWA composition preserves that accepted baseline; verified source and pending promotion evidence follow below.

## PWA / Offline (done)

The optional native `@repo/nuxt-pwa-offline` module is explicitly reference-enabled at `/pwa-test`; clean consumers default off and have no fallback paths. Three reviewed public assets only; no SSR/account/API/application chunks are cached. Natural updates never reload open forms. See [the contract](capabilities/pwa-offline/CAPABILITY.md).

Removal requires deploying `pwaOffline.retired: true` at the same worker URL/scope, allowing natural activation, and retaining that exact retirement script in `public/pwa-offline-sw.js` through all subsequent lean builds for returning clients. Only then remove the explicit module/dependency, page/imports and reference metadata. Never delete unrelated registrations/caches. Hosted exact-head acceptance and independent review remain required.

PWA / Offline source `5214f541fdbf6c3c8c7842a749d74ab437ad5a54` passed [all 28 hosted CI jobs](https://github.com/formless63/demo-starter-nuxt/actions/runs/37132857767), including all 26 generic packed lifecycles and the root production authenticated-session/privacy/offline-fallback checks. Independent review is complete. All 26 capabilities are done, explicitly reference-enabled and default-off. This metadata-only promotion requires its own exact-head full CI before acceptance. The intermittent anonymous Search timeout did not recur; diagnostic-only success does not establish its cause or a runtime fix.
