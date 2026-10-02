# Using capabilities

## What is a capability?

The baseline starter always includes Nuxt/Nitro, strict TypeScript, Bun tooling, PostgreSQL and Drizzle, Better Auth, the UI stack, explicit migrations, Docker/Compose, testing/CI, and agent scaffolding.

A capability is an optional, independently maintained feature package layered onto that baseline. Package source existing under `packages/` does not activate anything. A consumer must keep the workspace dependency, register the Nuxt module, and perform the capability's documented application integration. Unused packages do not become modules, routes, workers, or runtime services merely because their source exists.

The root application deliberately enables all twenty completed capabilities for continuous integration, recorded in `referenceApplication.enabledCapabilities`. That is separate from `defaultInstalled`: this field means “will a clean consumer/base application receive this capability without explicitly selecting or enabling it?” All current capabilities answer no.

`@repo/*` is the private internal workspace scope. The packages are not published, so commands such as `bun add @repo/nuxt-jobs` will not work in an unrelated external repository. A real npm scope will be chosen deliberately if publication happens later.

## Capability status

| ID | Package | Reference app | Default installed | Hard capability dependencies | External | Contract |
| --- | --- | --- | --- | --- | --- | --- |
| `jobs` | `@repo/nuxt-jobs` | Enabled | No | None | PostgreSQL (required) | [Jobs](../capabilities/jobs/CAPABILITY.md) |
| `api-platform` | `@repo/nuxt-api` | Enabled | No | None | None | [API Platform](../capabilities/api-platform/CAPABILITY.md) |
| `observability` | `@repo/nuxt-observability` | Enabled | No | None | OTLP destination (optional) | [Observability](../capabilities/observability/CAPABILITY.md) |
| `cache-coordination` | `@repo/nuxt-cache` | Enabled | No | None | Valkey/Redis-compatible service on use | [Cache / Coordination](../capabilities/cache-coordination/CAPABILITY.md) |
| `object-storage` | `@repo/nuxt-storage` | Enabled | No | None | S3-compatible service when used | [Object Storage](../capabilities/object-storage/CAPABILITY.md) |
| `email` | `@repo/nuxt-email` | Enabled | No | None | SMTP on use; Mailpit optional | [Email](../capabilities/email/CAPABILITY.md) |
| `webhooks` | `@repo/nuxt-webhooks` | Enabled | No | Jobs | Remote endpoints when used | [Webhooks](../capabilities/webhooks/CAPABILITY.md) |
| `ai` | `@repo/nuxt-ai` | Enabled | No | None | Configured model provider on use | [AI](../capabilities/ai/CAPABILITY.md) |
| `audit-log` | `@repo/nuxt-audit-log` | Enabled | No | None | PostgreSQL (required) | [Audit Log](../capabilities/audit-log/CAPABILITY.md) |
| `realtime` | `@repo/nuxt-realtime` | Enabled | No | None | None; Cache fanout optional | [Realtime](../capabilities/realtime/CAPABILITY.md) |
| `notifications` | `@repo/nuxt-notifications` | Enabled | No | Jobs | ntfy optional; Email integration optional | [Notifications](../capabilities/notifications/CAPABILITY.md) |
| `search` | `@repo/nuxt-search` | Enabled | No | None | Existing PostgreSQL | [Search](../capabilities/search/CAPABILITY.md) |
| `import-export` | `@repo/nuxt-import-export` | Enabled | No | Jobs, Object Storage | Existing PostgreSQL and S3 on use | [Import / Export](../capabilities/import-export/CAPABILITY.md) |
| `invoice-ninja` | `@repo/nuxt-invoice-ninja` | Enabled | No | Jobs, Webhooks | Invoice Ninja on use | [Invoice Ninja](../capabilities/invoice-ninja/CAPABILITY.md) |
| `stripe` | `@repo/nuxt-stripe` | Enabled | No | Jobs, Webhooks | Stripe on use | [Stripe](../capabilities/stripe/CAPABILITY.md) |
| `medusa` | `@repo/nuxt-medusa` | Enabled | No | Jobs, Webhooks | Medusa on use; optional operator bridge | [Medusa](../capabilities/medusa/CAPABILITY.md) |
| `data-table` | `@repo/nuxt-data-table` | Enabled | No | None | None | [Data Table](../capabilities/data-table/CAPABILITY.md) |
| `command-system` | `@repo/nuxt-command-system` | Enabled | No | None | None | [Command System](../capabilities/command-system/CAPABILITY.md) |
| `ops-admin` | `@repo/nuxt-ops-admin` | Enabled | No | None | None; optional provider adapters | [Ops / Admin](../capabilities/ops-admin/CAPABILITY.md) |
| `charts-visualization` | `@repo/nuxt-charts-visualization` | Enabled | No | None | None | [Charts / Visualization](../capabilities/charts-visualization/CAPABILITY.md) |

All twenty entries above are `done`. Data Table source-baseline evidence: the [combined CI run](https://github.com/formless63/demo-starter-nuxt/actions/runs/37008356538) passed all 20 jobs at `bfad9dce3ade72a42836d79103947de63a2a8279`, including all 18 generic package lifecycles and the full application check, browser suite, explicit migrations, production container/health and worker checks.

Charts source `7e8daa68c9862ef982c6dd0aa7e4269903eda9fd` passed [all 20 CI jobs](https://github.com/formless63/demo-starter-nuxt/actions/runs/37018899032). Command retains its separately verified implementation ([all 20 jobs at e0a01fa](https://github.com/formless63/demo-starter-nuxt/actions/runs/37012702417)). The composed twenty-capability tree requires a new full exact-head CI run; these source results are not evidence for this combination.

Run `bun run capabilities:status` for the catalog-derived status of completed and planned capabilities and their current root-reference enablement.

## Adding or enabling a capability

For a clone or downstream fork that retains the package source:

1. Keep or add the package as a `workspace:*` dependency in the consuming application's `package.json`.
2. Add the package name to `modules` in `nuxt.config.ts`.
3. Complete the consumer-owned integration described by its `CAPABILITY.md`.
4. Review and run any explicit database migrations.
5. Run the capability package test and normal repository verification.

### Jobs

Keep `"@repo/nuxt-jobs": "workspace:*"`, add `'@repo/nuxt-jobs'` to the Nuxt modules array, and define the application registry/tasks under `server/jobs/` using `@repo/nuxt-jobs/server`. Add the `nuxt-jobs` command aliases and a worker deployment role only when the application needs them. Apply `bun run jobs:migrate`, run `bun run jobs:doctor`, and verify with `bun run packages:test jobs`. See the [Jobs contract](../capabilities/jobs/CAPABILITY.md).

### API Platform

Keep `"@repo/nuxt-api": "workspace:*"`, add `'@repo/nuxt-api'` to the Nuxt modules array, compose `apiPlatformAuth()` from `@repo/nuxt-api/server` into the application's single Better Auth instance, export the package's `apikey` table from the application schema, and commit/apply a reviewed migration. Add an application-owned contract registry and native Nitro `/api/v1` routes. Key-management routes/UI are consumer features, not hidden module side effects. Verify with `bun run packages:test api-platform`. See the [API Platform contract](../capabilities/api-platform/CAPABILITY.md).

The current API defaults are `X-API-Key`, hashing enabled, user-owned keys, no default expiry, a 64-character generated secret, `app_` prefix, 1,000 requests per 60 seconds, no browser sessions from API keys, `projects.read`/`projects.write`, OpenAPI 3.1.1 at `/api/openapi.json`, and Scalar at `/docs/api`.

### Observability

Keep `@repo/nuxt-observability: workspace:*` and explicitly register its Nuxt module. JSON logs, request IDs, local span correlation and safe build metadata work with no backend. Set `OTEL_EXPORTER_OTLP_ENDPOINT` only for an optional OTLP/HTTP JSON destination, with independent trace/metric `otlp`/`none` selection. Request bodies, raw headers/query, job payloads and auth objects are omitted; extend `redactKeys` and use deliberate safe free text/attributes. v1 is server-only. Jobs/API wrappers are optional consumer-owned integrations, not dependencies. See the [contract](../capabilities/observability/CAPABILITY.md) for the complete configuration/safe uncaught-error/shutdown model and fixture proof.

Removal restores ordinary Jobs handlers/API handlers and baseline health output, removes module/dependency/env configuration, then clears generated state and rebuilds. There is no schema to drop. [Starting a project](STARTING-A-PROJECT.md#remove-observability) lists the root-specific files.

### Object Storage

Keep `@repo/nuxt-storage: workspace:*` and explicitly register the module. Installation/build/startup need no backend. When used, supply an existing private bucket and server-only S3 configuration; absent static credentials preserves the AWS default chain. Region resolves `STORAGE_REGION` → `AWS_REGION` → `AWS_DEFAULT_REGION` → safe configuration error on use, not build/boot. Root `storage:dev:rustfs` / `storage:dev:garage` explicitly bootstrap local-only RustFS 1.0.0 / Garage 2.4.1 with explicit regions. `storage:check` is read-only; `storage:smoke` uses package-owned unique-key cleanup. The same packed fixture verifies real RustFS/Garage object/signing/multipart contracts and post-removal builds, independently of Jobs/API/Observability. Optional third-party Noooste Garage UI v0.13.0 is localhost-bound operator tooling, not official Garage or needed for S3; privileged admin credentials never belong in application browser code or normal S3 clients. Known development credentials are local-only. See the [shared defaults](../OBJECT_STORAGE_MODULE_EVALUATION.md#shared-cross-framework-baseline).

Authorization, files records and UI remain app-owned. The optional root operation runner instruments bounded operation/outcome/duration/known bytes without keys or signed URLs; Storage has no Observability dependency. Removal means code/config removal, **not deleting remote objects/buckets or revoking credentials**. See the [contract](../capabilities/object-storage/CAPABILITY.md) and [root removal recipe](STARTING-A-PROJECT.md#remove-object-storage).

### Email

Keep `@repo/nuxt-email` and register its Nuxt module explicitly. SMTP config is server-only and lazy; structured messages bound addresses/display names/subjects to 254/128/200 characters and text+HTML to a combined 1 MiB; connection/greeting/DNS timeouts are 5 seconds and socket timeout 10 seconds; enable magic links only with structural SMTP configuration and canonical app URL. `email:check` verifies without sending; `email:smoke [recipient]` intentionally sends once. Mailpit is an optional local sink. No DB/Jobs/Observability dependencies, queues or SMTP health requirement. See [Email contract](../capabilities/email/CAPABILITY.md) and [removal](STARTING-A-PROJECT.md#remove-email).

### Cache / Coordination

Keep `@repo/nuxt-cache: workspace:*` and explicitly register the module. First-use server-only CACHE_URL config supports redis/rediss with TLS verification. Namespaced exact keys, bounded strings/bytes, namespace `app`, default 300-second TTL (1–86400), lossless Buffer reads, explicit `setWithoutExpiry`, NX, atomic initial-TTL counters, token-safe advisory leases (30 seconds, allowed 2–300) and non-durable pub/sub (32 subscriptions maximum, explicit re-subscription after failure); no routes or startup connection. Local `cache:dev:valkey` / `cache:dev:down` owns disposable loopback Valkey 9.1.2 with no AOF/RDB/volume. `cache:check` pings and `cache:smoke` cleans only unique exact keys. The generic packed fixture owns real compatibility and removal. Optional root telemetry records operation/outcome/duration/hit-miss only; no capability dependency.

Leases have no fencing/Redlock/quorum and cannot alone guarantee irreversible correctness under partitions/process pauses. Application-owned Realtime fanout may compose Cache pub/sub; future API shared state remains documentation only; Jobs remains PostgreSQL-durable. Removal changes code/config with no persistent migration and **never external FLUSH**. See the [contract](../capabilities/cache-coordination/CAPABILITY.md), [evaluation](../CACHE_COORDINATION_MODULE_EVALUATION.md) and [removal recipe](STARTING-A-PROJECT.md#remove-cache--coordination).

### Realtime

Explicitly enable `@repo/nuxt-realtime`, then choose **SSE**, **WebSocket**, or **Both**: `REALTIME_TRANSPORTS=sse` (default), `websocket`, `sse,websocket`. The package includes both adapters and compiles Nitro WebSocket support. Applications own normal cookie/session-authenticated routes and exact authorized channels. Envelopes≤64KiB, channels≤32, pending bytes≤256KiB, heartbeats20seconds. No RPC/replay/delivery guarantee; reconnect then refetch authoritative state. Optional Cache/Notifications/telemetry wrappers remain outside the package. See the [contract](../capabilities/realtime/CAPABILITY.md) and [removal](STARTING-A-PROJECT.md#remove-realtime).

### Notifications

Enable `@repo/nuxt-notifications` with its hard Jobs dependency. Include the public `/schema` Drizzle table in application schema, generate/commit/apply migrations explicitly, and compose `createNotificationJobs` into the existing worker. Recipient-scoped list/read/unread use keyset pagination (page25,1–100). Transactional append/enqueue shares the domain transaction; optional realtime hint follows commit and contains only notification ID. Delivery reloads current record/target, payload only ID/channel, five retries after initial,30sec backoff cap900,expiry60,retention1day. Email is an app adapter; ntfy has explicit server/no public default, optional token and timeout10sec1–30. No optional adapter needed for boot. See the [contract](../capabilities/notifications/CAPABILITY.md) and [removal](STARTING-A-PROJECT.md#remove-notifications).

## Disabling, removing, and pruning

These are different operations:

### Disable

Stop registering or using the capability in the application. The private package source and capability metadata can remain in the repository for later reuse. Remove runtime services such as the Jobs worker when they are no longer used.

### Remove from the application

Remove the Nuxt module registration, root workspace dependency, and consumer-owned integrations listed in the capability contract. Clear generated Nuxt state, reinstall, and typecheck/build so stale generated types cannot hide a dependency. Preserve database data and migration history by default; application removal does not authorize dropping tables or schemas.

### Prune from a downstream fork

After application removal, a fork that will not develop or reuse the capability may delete its `packages/nuxt-<capability>/` source, consumer fixture, capability contract, evaluation document, and capability-specific skill/testing metadata.

Do not leave the catalog pointing at deleted files. The least disruptive roadmap-preserving change is to set the catalog entry back to `planned` and remove its implemented-only fields: scripts, environment variables, migrations, runtime processes, documentation/evaluation/skill paths, package name/path, fixture path, and package-test configuration. Update `ROADMAP.md`, this guide, and `docs/STARTING-A-PROJECT.md` in the same change. Keep the capability ID if other planned capabilities still reference it; deleting the entry requires updating every `requires` and `integratesWith` reference. Run `bun run capabilities:check` afterward.

Never delete an already-applied migration or automatically drop PostgreSQL data merely to make a fork look clean. Database destruction requires a separate, reviewed decision.

## Dependency handling

- **Requires** is a hard dependency on another capability. Webhooks will require Jobs; File UI will require Object Storage.
- **Integrates with** is an optional enhancement. Email can integrate with Jobs without requiring it, so Email's core remains usable without Jobs.
- **External** is infrastructure or a remote service outside the capability catalog, such as PostgreSQL, SMTP, or S3-compatible storage.

Baseline features such as authentication and Drizzle are recorded separately rather than invented as module dependencies. Hard dependencies must remain explicit, sparse, and acyclic.

## Verification after capability changes

```sh
bun run capabilities:check
bun run packages:test <id>
bun run check
```

Package tests resolve catalog hard dependencies, build and pack the real artifacts with workspace references replaced by local tarballs, install them into an external-style fixture, exercise capability-owned runtime checks, remove it, clear generated state, and prove the remaining fixture still typechecks and builds. Required capability packages and their owned dependencies remain installed after removal of the selected package. Tests validate package-level removal without acting as a source-rewriting uninstaller.

## Webhooks

Install and explicitly enable Jobs and Webhooks together; compose `createWebhookJobs({ events, resolveTarget })` into your existing Jobs registry. Use lowercase event names and JSON-safe schema output. Serialize once with `createWebhookEvent`; keep endpoints/secrets out of queues. Applications own routes and secrets, verify raw bytes before parsing, and provide durable transactional idempotency for replay prevention. Queued bodies stay at most 64 KiB; completed retention is one day. Every deliberate enqueue may create delivery work, so durable domain/outbound idempotency is app-owned. Normal build/health/worker startup requires no endpoints. `bun run webhooks:smoke` exercises a local signed receiver and bounded retries. The [contract](../capabilities/webhooks/CAPABILITY.md) covers SSRF/DNS limits, privacy, retry outcomes and removal while retaining Jobs.

## Audit Log

Explicitly enable `@repo/nuxt-audit-log`, export its table in the application Drizzle schema and apply a committed migration. Append within the domain transaction; query using bounded exact filters, inclusive `from`/exclusive `until` and an opaque cursor. Event identity/time are primitive-owned, and credential/raw-container metadata keys are rejected recursively. Root Projects record stable user/machine IDs only. Authentication and all other capabilities remain optional. See the [contract](../capabilities/audit-log/CAPABILITY.md) and [removal recipe](STARTING-A-PROJECT.md#remove-audit-log). No UI or retention service is supplied.

## Search

Application-owned domain rows and explicit generated-vector/GIN migrations, reusable server helpers, no auto routes or connections. Root Projects searches always retain owner isolation. `simple` FTS, A name/B description, websearch input, rank normalization 32 and descending keyset pages. See [contract](../capabilities/search/CAPABILITY.md). Jobs/Storage/Organizations are future optional integrations, not requirements.

### AI

Keep `@repo/nuxt-ai: workspace:*` and register its module. Use server-only `getAi` or `@repo/nuxt-ai/server` for text, real incremental streams and Zod-validated structured output. Configure AI_MODEL lazily; provider defaults openai-compatible and timeout 60 seconds. No automatic retry, 1 MiB output maximum and safe errors. No routes/UI/history/tools/RAG are installed. Optional integrations are application-owned; the root telemetry wrapper emits only finite operation/provider/outcome/duration/usage/finish fields. Verify the actual local adapter with `bun run packages:test ai`; use `ai:smoke` only for an intentional provider call. See the [contract](../capabilities/ai/CAPABILITY.md) and [removal](STARTING-A-PROJECT.md#remove-ai).

## Import / Export

Private `@repo/nuxt-import-export` requires Jobs and Object Storage; PostgreSQL/Drizzle/Node baseline. Register application definitions and the existing worker handler, include transfer schema and apply the explicit additive migration. Personal Project CSV columns are `name,description`; imports create fresh Projects. S3 configuration is lazy. Cancellation is best effort until committed apply/publication. Explicit selected receipt reconciliation and dry-run artifact purge are operator actions. Optional Audit/Notifications stay application-owned. See [contract](../capabilities/import-export/CAPABILITY.md) and [evaluation](../IMPORT_EXPORT_MODULE_EVALUATION.md).

Ops / Admin (`done`) is an optional private `@repo/nuxt-ops-admin` package. Enable with `opsAdmin.application` pointing to an application-owned baseline session resolver/static adapter registry. No service/migration or hard capability dependencies. [Contract](../capabilities/ops-admin/CAPABILITY.md).

Ops reference verification uses `bun run test:ops-reference` after building the root. Its disposable protocol services and temporary source copies prove read-only inspection and independent adapter/full Ops removal; they are test-only, not an application installer.

## Invoice Ninja

[Contract](../capabilities/invoice-ninja/CAPABILITY.md): independent opt-in private package, application-owned Drizzle schemas and native routes. Getter calls read local projections only; reconcile client/invoice explicitly through existing Jobs. Draft policy denies absent actual deployment evidence. Callback possession secret is distinct from a cryptographic body signature. The pinned disposable 5.13.43 backend and generic lifecycle passed; this proves the isolated fixture policy, not arbitrary deployment/company-hook settings.

## Stripe

Stripe v1 is available (`done`): `@repo/nuxt-stripe` requires Jobs and Webhooks; clean consumers remain opt-in. Native routes are application-owned under `/api/integrations/stripe`; the reference page is `/stripe`. The completed generic package lifecycle verifies local SDK/database behavior and retained-data removal. [Stripe contract](../capabilities/stripe/CAPABILITY.md) and [design evaluation](../STRIPE_MODULE_EVALUATION.md) distinguish local SDK compatibility from financial certification.

## Medusa

The reference app explicitly enables private `@repo/nuxt-medusa`; clean consumers default to uninstalled. Requires Jobs and Webhooks. [Provider contract](../capabilities/medusa/CAPABILITY.md) covers bounded scoped Admin reconciliation, the operator-installed application bridge, verification and independent removal. `/integrations/medusa` reads approved local product/order projections; no provider configuration is required for startup.

The pinned disposable Medusa 2.21.2 backend/subscriber and packed lifecycle passed. The fixture uses real event infrastructure and source-verified `order.placed` payloads without invoking checkout/payment workflows; remote production event delivery remains an operator responsibility.

### Data Table

Keep `"@repo/nuxt-data-table": "workspace:*"` and register `'@repo/nuxt-data-table'` in Nuxt modules. The module registers the component and its owned Vite adapter prebundle; applications own data, stable row IDs, typed columns, controlled state and any server requests. The root `/data-table-test` reference covers interactive client/manual behavior. Verify packed SSR, install and removal with `bun run packages:test data-table`; no database or external provider is needed. See the [Data Table contract](../capabilities/data-table/CAPABILITY.md) and [removal recipe](STARTING-A-PROJECT.md#remove-data-table).

Command System (`done`) uses `@repo/nuxt-command-system`; enabled explicitly in the reference, never installed by default. No service, migrations or hard capability dependencies. [Contract](../capabilities/command-system/CAPABILITY.md).


### Charts / Visualization

Keep `"@repo/nuxt-charts-visualization": "workspace:*"` and explicitly register its Nuxt module. Applications own data and optional Data Table/Realtime composition; no hard capability dependency exists. The module owns selective ECharts prebundles while preserving consumer optimizer settings. The `/charts` reference covers line/bar/area, SSR semantic data, responsive updates, reduced motion and disposal. Verify with `bun run packages:test charts-visualization` and the root unit/browser contracts. See the [Charts contract](../capabilities/charts-visualization/CAPABILITY.md) and [removal recipe](STARTING-A-PROJECT.md#remove-charts--visualization).
