# Reusable capability roadmap

This roadmap separates the permanent starter baseline from optional reusable capabilities and from framework/library evaluations. The machine-readable source for capability status and relationships is [`capabilities/catalog.json`](capabilities/catalog.json); its contract is [`capabilities/catalog.schema.json`](capabilities/catalog.schema.json).

For user-facing enablement, removal, and pruning guidance, see [`docs/CAPABILITIES.md`](docs/CAPABILITIES.md) and [`docs/STARTING-A-PROJECT.md`](docs/STARTING-A-PROJECT.md).

## Relationship vocabulary

- **Requires** is a hard dependency on another reusable capability. Installation is incomplete without it.
- **Integrates with** is an optional enhancement. The named capability remains useful when the integration is absent.
- **External** is service or infrastructure outside this capability catalog. External entries say whether they are required or optional.
- **Baseline requirements** are built into this starter and are not capability-module edges. They are tracked separately to avoid fake modules and accidental dependency cycles.

Hard dependency edges must stay sparse and acyclic. Future Nuxt modules should use Nuxt 4 `moduleDependencies` only for genuine Nuxt-module requirements and `optional: true` for optional Nuxt-module integrations. Ordinary npm packages and the starter's built-in Drizzle/auth layers are not fake Nuxt modules.

## Base starter contract — not modules

The starter always supplies:

- Nuxt 4/Vue/Nitro framework conventions and strict TypeScript
- Bun package management and scripts, with portable Node production output
- PostgreSQL 18, Drizzle ORM, and explicit committed migrations
- Better Auth sessions with passwords disabled, GitHub OAuth, and generic OIDC
- Pocket ID development provisioning and optional magic-link support
- Tailwind CSS 4, the shadcn-style component system/Reka UI, and Tabler Icons
- provider-neutral Docker/Compose orchestration
- lint, typecheck, Vitest, Playwright, build, and production-container CI
- layered agent context, prompts, and task-specific skills

Capabilities may declare a baseline requirement such as authenticated identity, but that does not create a capability dependency.

## Capability package convention

Reusable Nuxt capabilities are developed as sibling workspace packages under `packages/nuxt-<id>/`, following Nuxt's normal module-author structure and build tooling. Each implemented package owns its runtime dependencies and public commands, has an explicit minimal consumer under `fixtures/`, and is activated only when an application installs it and lists it in `nuxt.config.ts`. Package source existing in this repository is never sufficient to enable a capability.

`defaultInstalled` has one meaning: whether a clean consumer/base application receives a capability without explicitly selecting or enabling it. It does not describe the root reference application. All completed capabilities are `defaultInstalled: false`; the root deliberately installs and enables them for continuous integration testing, tracked separately in `referenceApplication.enabledCapabilities`.

The root is a reference application that may opt into completed capabilities for integrated development and deployment. It is not the definition of the base generated starter. `capabilities/catalog.json` is the source of truth for completed package discovery and records the package name/path, consumer fixture, owned-dependency assertions, optional fixture runtime hook, and removal test contract. Each `CAPABILITY.md` owns installation/removal guidance. This metadata drives repository preparation and verification only; it is not an application installer or runtime capability loader. The private `@repo/*` scope identifies internal workspace packages only; a publication scope must be chosen deliberately before any npm release. Future packages should follow this convention only when implemented; empty packages are not created for roadmap entries.

The generic `packages:*` commands build and exercise the catalog entries. Hard capability dependencies are resolved as an acyclic package closure and built first. External fixtures receive packed dependency tarballs, with workspace references replaced in staged manifests; removal retains required packages and their owned dependencies. Root postinstall prepares only catalog packages that are actual root dependencies. CI derives its package matrix from the catalog, performs the common tarball install/typecheck/build/removal lifecycle once per entry, and lets each capability fixture own any specialized runtime checks. Adding a completed package therefore changes metadata and its fixture, not the CI workflow.

## Status summary

| Status | Capability |
| --- | --- |
| Done | Jobs — pg-boss; API Platform / Machine Auth / OpenAPI; Observability; Object Storage; Email; Webhooks; Audit Log; Cache / Coordination; Realtime; Notifications; Search; AI |
| Planned | All remaining capabilities below unless explicitly changed in the catalog |

API Platform is capability #2. Observability is capability #3: server-only logs, request correlation, explicit spans/metrics, optional OTLP export and a clean-consumer lifecycle. No new service is required.

## Foundational / backend

### Jobs — pg-boss (`done`)

- Requires: none beyond baseline PostgreSQL/Drizzle/Node runtime
- Integrates with: Observability, Ops / Admin
- External: PostgreSQL (required)
- Default installed: no; a clean consumer must explicitly select it. Enabled in reference app: yes.
- Current implementation: `@repo/nuxt-jobs` private workspace package, typed registry, Zod execution validation, guarded same-database transactional Drizzle enqueue, concurrency `4` (decimal `1`–`100`), producer/reader and worker roles, native retry/cancellation context, explicit migrations/doctor, package-owned CLI, clean consumer fixture, standalone worker, smoke test, and shared production image
- Contract: [`capabilities/jobs/CAPABILITY.md`](capabilities/jobs/CAPABILITY.md)

### API Platform / Machine Auth / OpenAPI (`done`)

- Requires: none beyond the starter baseline
- Integrates with: Audit Log, Observability, Authorization, Organizations / Tenancy
- External: none
- Default installed: no; a clean consumer must explicitly select it. Enabled in reference app: yes.
- Current implementation: `@repo/nuxt-api`, Better Auth user-owned hashed API keys, typed machine principals and permissions, native Nitro `/api/v1` routes, Zod-backed OpenAPI 3.1.1, Scalar docs, committed migration, credential management, and clean consumer fixture
- Contract: [`capabilities/api-platform/CAPABILITY.md`](capabilities/api-platform/CAPABILITY.md)

### Observability (`done`)

- Requires: none
- Integrates with: effectively every server/runtime capability
- External: optional OTLP destination
- Default installed: no; explicitly enabled in the reference app.
- Current implementation: private `@repo/nuxt-observability`, safe Pino JSON logs, bounded request IDs/async context, OTel stable trace/metric SDKs, independently configurable optional HTTP/JSON exporters, safe build/health metadata, application-owned Jobs/API wrappers, bounded shutdown and external-style install/runtime/removal fixture
- Contract: [`capabilities/observability/CAPABILITY.md`](capabilities/observability/CAPABILITY.md)
- Browser telemetry/replay/analytics remain future extensions; no vendor backend or cross-process pg-boss propagation is claimed.

### Object Storage (`done`)

- Requires: none
- Integrates with: Jobs, Observability
- External: S3-compatible storage (required)
- Preferred self-hosted options: RustFS; Garage with optional GarageUI. MinIO is not the default.
- Current implementation (#4): private `@repo/nuxt-storage`, server-only S3 primitives, lazy configuration with explicit region, private streaming objects, signed GET/PUT, multipart and HEAD policy verification; generic external fixture tests real RustFS 1.0.0 and Garage 2.4.1, CORS and optional third-party Noooste Garage UI v0.13.0 (localhost/operator-only, not official or needed for S3). Shared AWS SDK 3.1143.0, TTL 600 seconds (30–3600), custom-endpoint path-style defaults and region/credentials follow the [synchronized baseline](OBJECT_STORAGE_MODULE_EVALUATION.md#shared-cross-framework-baseline). No files table, application UI, processing jobs or implicit bucket creation.
- External storage is needed only when operations are used, not at install/build/startup. Default installed: no; reference application explicitly opts in.
- Contract: [`capabilities/object-storage/CAPABILITY.md`](capabilities/object-storage/CAPABILITY.md)

### Email (`done`)

- Requires: none
- Integrates with: Jobs, Observability; baseline Better Auth magic links
- Baseline requirement: Node production runtime
- External: SMTP required only on use; Mailpit 1.31.3 is an optional disposable development/test sink.
- Implementation (#5): private `@repo/nuxt-email`, lazy Nodemailer 10.0.13 SMTP, explicit transport security, bounded text/HTML/addresses and safe single-attempt delivery/errors; root hashed-token magic links and optional application-owned telemetry. No durable queue, database dependency, attachments or provider SDK.
- Default installed: no; the reference application explicitly opts in.
- Contract: [`capabilities/email/CAPABILITY.md`](capabilities/email/CAPABILITY.md)
- Base transport remains SMTP rather than a provider-specific SDK.

### Webhooks (`done`)

- Requires: Jobs (hard catalog/module/peer dependency)
- Baseline requirement: Node production runtime; PostgreSQL is supplied through Jobs
- Integrates with: Audit Log, Observability, API Platform
- External: remote webhook endpoints only for outbound use; build/boot/health need none
- Default installed: no; root explicitly opts in. `@repo/nuxt-webhooks` supplies Standard Webhooks HMAC signing, bounded raw-body verification, target policy, replay handoff and durable Jobs definitions with no second worker/routes/UI.
- Contract: [`capabilities/webhooks/CAPABILITY.md`](capabilities/webhooks/CAPABILITY.md)

### Audit Log (`done`)

- Requires: none
- Integrates with: API Platform, Organizations, Jobs, Invoice Ninja, Stripe, Medusa; optional baseline authentication
- Baseline: PostgreSQL and Drizzle
- External: PostgreSQL (required)
- Implementation: `@repo/nuxt-audit-log`, application-owned schema/migrations, transactional append, bounded metadata and keyset queries; no UI or retention daemon.
- Contract: [`capabilities/audit-log/CAPABILITY.md`](capabilities/audit-log/CAPABILITY.md)

### AI (`done`)

- Requires: none
- Integrates with: Jobs, Object Storage, Observability, Audit Log
- Baseline requirement: Node production runtime
- External: configured model provider only when used; install/build/boot/health remain backendless
- Default installed: no; root explicitly opts in.
- Implementation: `@repo/nuxt-ai`, OpenAI-compatible text/streaming/Zod structured generation, bounded output, cancellation/deadline and safe errors. No UI/history/tools/RAG or generic queued AI.
- Contract: [`capabilities/ai/CAPABILITY.md`](capabilities/ai/CAPABILITY.md)

## Application infrastructure

### Cache / Coordination (`done`)

- Requires: none
- Integrates with: Realtime, API Platform, Jobs, Observability
- Baseline requirement: Node production runtime
- External: Valkey/Redis-compatible service (required only on use)
- Default installed: no; reference application explicitly opts in.
- Implementation: `@repo/nuxt-cache`, ephemeral exact namespaced strings/bytes, TTL/NX, atomic counters, advisory token-safe single-backend leases (no fencing/Redlock), non-durable pub/sub and lazy lifecycle. Pinned Valkey 9.1.2 / node-redis 6.3.0; independent packed fixture. Optional application-owned Realtime fanout composes Cache pub/sub; no Cache-to-Realtime package dependency.
- Contract: [`capabilities/cache-coordination/CAPABILITY.md`](capabilities/cache-coordination/CAPABILITY.md)

### Search (`done`)

- Requires: none; baseline PostgreSQL and Drizzle
- Integrates with: Jobs, Object Storage, Organizations (future optional enhancements)
- External: existing PostgreSQL only; no external index service
- Default installed: no; reference application explicitly opts in.
- Implementation: private `@repo/nuxt-search`, application-owned generated weighted `simple` vector/GIN migration, parameterized websearch and normalization-32 rank, canonical numeric-float4 UTF-8 keyset cursors (2048 ASCII bound) and owner-scoped Projects service/endpoint with explicit CRUD projections. Existing-row/hash upgrade, retained-DB removal/rebuild and authenticated production/privacy regressions. No automatic routes, connections or migrations.
- Contract: [`capabilities/search/CAPABILITY.md`](capabilities/search/CAPABILITY.md)

### Realtime (`done`)

- Requires: none; baseline Node runtime, optional baseline authentication
- Integrates with: Cache / Coordination, Notifications, Observability
- External: none; optional Cache fanout remains non-durable
- Implementation: both SSE/WebSocket server adapters, bounded events/queues, application-owned session/channel policy; no replay/RPC.
- Contract: [`capabilities/realtime/CAPABILITY.md`](capabilities/realtime/CAPABILITY.md)

### Notifications (`done`)

- Requires: Jobs
- Integrates with: Email, Realtime, Audit Log, Observability
- Baseline: PostgreSQL/Drizzle; optional baseline authentication
- External: ntfy optional
- Implementation: application-included Drizzle records, recipient keyset/read state, transactional Jobs delivery, optional app Email/post-commit Realtime integrations.
- Contract: [`capabilities/notifications/CAPABILITY.md`](capabilities/notifications/CAPABILITY.md)

### Import / Export (`in-progress`)

- Requires: Jobs, Object Storage
- Integrates with: Notifications, Audit Log
- External: none additional; S3 supplied by Object Storage, on use
- Private `@repo/nuxt-import-export`, transfer receipt schema, Jobs worker handler and personal Project CSV reference are under verification.
- Contract: [`capabilities/import-export/CAPABILITY.md`](capabilities/import-export/CAPABILITY.md)

## Identity / policy

### Organizations / Tenancy (`planned`)

- Requires: starter authentication (baseline, not a capability edge)
- Integrates with: Audit Log, Notifications
- External: PostgreSQL

### Authorization (`planned`)

- Requires: starter authentication (baseline, not a capability edge)
- Integrates with: Organizations, API Platform, Audit Log
- External: PostgreSQL

### Feature Flags (`planned`)

- Requires: none
- Integrates with: Organizations, Authorization, Audit Log
- External: PostgreSQL

## Business integrations

### Invoice Ninja (`planned`)

- Requires: Jobs, Webhooks
- Integrates with: Organizations, Audit Log, Notifications
- External: Invoice Ninja

### Stripe (`planned`)

- Requires: Jobs, Webhooks
- Integrates with: Organizations, Authorization, Audit Log, Notifications
- External: Stripe

### Medusa (`planned`)

- Requires: Jobs, Webhooks
- Integrates with: Object Storage, Organizations, Search
- External: Medusa

## Operations / UI infrastructure

### Ops / Admin (`planned`)

- Requires: starter authentication (baseline, not a capability edge)
- Integrates with: Observability, Jobs, Audit Log, Object Storage, Cache / Coordination, Webhooks
- External: none

### Command System (`planned`)

- Requires: none
- Integrates with: Search, Authorization
- External: none

### Data Table (`planned`)

- Requires: none
- Integrates with: Search, Organizations, Authorization
- External: none

### Markdown / Code Content (`planned`)

- Requires: none
- Integrates with: Object Storage, AI
- External: none

### Charts / Visualization (`planned`)

- Requires: none
- Integrates with: Data Table, Realtime
- External: none

### File UI (`planned`)

- Requires: Object Storage
- Integrates with: Jobs, Search
- External: none directly; Object Storage owns its S3 requirement

### Rich Text / Tiptap (`planned`)

- Requires: none
- Integrates with: Object Storage, Markdown / Code, Realtime, Organizations
- External: none

### Flow / Canvas (`planned`)

- Requires: none
- Integrates with: Realtime, Object Storage, Audit Log
- External: none

## Client / platform

### PWA / Offline (`planned`)

- Requires: none
- Integrates with: Notifications, Realtime
- External: none

### Internationalization (`planned`)

- Requires: none
- Integrates with: UI-facing capabilities
- External: none

## Framework and library evaluations — not automatically modules

Evaluation status means “investigate when a real capability needs it,” not “install it.” No package below should be added merely to satisfy this roadmap.

### TanStack-oriented repository evaluations

- TanStack DB
- TanStack AI
- TanStack Hotkeys
- TanStack Pacer
- TanStack Virtual
- TanStack Charts
- TanStack Markdown / Highlight
- TanStack Intent

### Nuxt/Vue-oriented repository evaluations

- appropriate Nuxt Modules ecosystem integrations for each capability
- VueUse primitives already present in the baseline where they solve the actual need
- Nuxt Content for content-heavy use cases
- Vue-native equivalents when a TanStack-oriented capability relies on React-specific UI packages

## Governance

Every implemented capability gets `capabilities/<id>/CAPABILITY.md`. Changes to capability installation, removal, dependencies, optional integrations, external requirements, scripts, migrations, runtime services, or status update this roadmap, the JSON catalog, and the capability contract together. Run `bun run capabilities:check` before the ordinary repository verification.
