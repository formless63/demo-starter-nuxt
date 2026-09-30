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

The root is a reference application that may opt into completed capabilities for integrated development and deployment. It is not the definition of the base generated starter. `capabilities/catalog.json` is the source of truth for completed package discovery and records the package name/path, consumer fixture, owned-dependency assertions, optional fixture runtime hook, and removal test contract. Each `CAPABILITY.md` owns installation/removal guidance. This metadata drives repository preparation and verification only; it is not an application installer or runtime capability loader. The private `@repo/*` scope identifies internal workspace packages only; a publication scope must be chosen deliberately before any npm release. Future packages such as API, Observability, Storage, and Email should follow this convention only when implemented; empty packages are not created for roadmap entries.

The generic `packages:*` commands build and exercise the catalog entries. Root postinstall prepares only catalog packages that are actual root dependencies. CI derives its package matrix from the catalog, performs the common tarball install/typecheck/build/removal lifecycle once per entry, and lets each capability fixture own any specialized runtime checks. Adding a completed package therefore changes metadata and its fixture, not the CI workflow.

## Status summary

| Status | Capability |
| --- | --- |
| Done | Jobs — pg-boss; API Platform / Machine Auth / OpenAPI; Observability |
| Planned | All remaining capabilities below unless explicitly changed in the catalog |

API Platform is capability #2. Observability is capability #3: server-only logs, request correlation, explicit spans/metrics, optional OTLP export and a clean-consumer lifecycle. No new service is required.

## Foundational / backend

### Jobs — pg-boss (`done`)

- Requires: none beyond baseline PostgreSQL/Drizzle/Node runtime
- Integrates with: Observability, Ops / Admin
- External: PostgreSQL (required)
- Default installed: no; a clean consumer must explicitly select it. Enabled in reference app: yes.
- Current implementation: `@repo/nuxt-jobs` private workspace package, typed registry, Zod execution validation, transactional Drizzle enqueue, explicit migrations/doctor, package-owned CLI, clean consumer fixture, standalone worker, smoke test, and shared production image
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

### Object Storage (`planned`)

- Requires: none
- Integrates with: Jobs, Observability
- External: S3-compatible storage (required)
- Preferred self-hosted options: RustFS; Garage with optional GarageUI. MinIO is not the default.

### Email (`planned`)

- Requires: none
- Integrates with: Jobs, Observability, baseline Better Auth magic links
- External: SMTP (required); Mailpit is the development default
- Base transport remains SMTP rather than a provider-specific SDK.

### Webhooks (`planned`)

- Requires: Jobs for the complete reliable inbound/outbound capability
- Integrates with: Audit Log, Observability, API Platform
- External: remote webhook endpoints

### Audit Log (`planned`)

- Requires: none
- Integrates with: baseline authentication, API Platform, Organizations, Jobs, and business integrations
- External: PostgreSQL (required)

### AI (`planned`)

- Requires: none
- Integrates with: Jobs, Object Storage, Observability, Audit Log
- External: configured model provider (required)

## Application infrastructure

### Cache / Coordination (`planned`)

- Requires: none
- Integrates with: Realtime, API Platform, Jobs
- External: Valkey/Redis-compatible service (required)

### Search (`planned`)

- Requires: none; PostgreSQL-first
- Integrates with: Jobs, Object Storage, Organizations
- External: PostgreSQL initially

### Realtime (`planned`)

- Requires: authenticated starter identity (baseline, not a capability edge)
- Integrates with: Cache / Coordination, Notifications, Observability
- External: none initially

### Notifications (`planned`)

- Requires: Jobs
- Integrates with: Email, Realtime, Audit Log
- External: ntfy optional; SMTP through Email optional

### Import / Export (`planned`)

- Requires: Jobs, Object Storage
- Integrates with: Notifications, Audit Log
- External: none

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
