# Observability capability

`@repo/nuxt-observability` is a private, publish-shaped, independently installable Nuxt 4 package. It is capability #3, server-only, and `defaultInstalled: false`; the reference app explicitly enables it. See [evaluation](../../OBSERVABILITY_MODULE_EVALUATION.md).

## Requirements

Requires:

- No other capability. Compatible Nuxt 4/Nitro/H3 and Node 24 are consumer runtime requirements, not fake module dependencies.

Integrates with:

- Jobs, API Platform and other server/runtime capabilities through deliberate application instrumentation. Neither Jobs nor API Platform is a package dependency or `moduleDependencies` entry.

External:

- An OTLP/HTTP destination is optional. No backend is a valid production configuration.

## Adds

### Dependencies

The package owns Pino 10.3.1, OTel API 1.9.1, stable SDK/core/context/resources 2.11.0, and compatible HTTP/JSON trace/metric exporters 0.222.0. Nuxt/H3 are peers. No pretty-printer, `sdk-node`, blanket automatic instrumentation, OTel Logs pipeline, browser instrumentation or Jobs/API dependency is added.

### Environment

- `LOG_LEVEL`: Pino level, default `info`; JSON is canonical in every environment.
- `OTEL_SERVICE_NAME`: safe service identity; module default `nuxt-application`.
- `OTEL_SDK_DISABLED=true`: disable SDK instrumentation/export while retaining logs/request IDs.
- `OTEL_EXPORTER_OTLP_ENDPOINT`: optional HTTP(S) base; `/v1/traces` and `/v1/metrics` are appended.
- `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` / `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT`: optional full per-signal URLs.
- `OTEL_EXPORTER_OTLP_HEADERS`: standard comma-separated encoded exporter headers; never logged.
- `OTEL_TRACES_EXPORTER` / `OTEL_METRICS_EXPORTER`: independently `otlp` or `none`. Unset means `otlp` only when an endpoint exists. Unsupported values fail with a safe diagnostic.
- `OTEL_RESOURCE_ATTRIBUTES`: operator-owned comma-separated key/value attributes, filtered through the sensitive-field boundary. Never configure secrets as resource metadata.
- `APP_VERSION`, `APP_REVISION`, `DEPLOYMENT_ENVIRONMENT`: safe deployment metadata; unset version/revision are `unknown`. Runtime Node version is included; Git is never invoked.

All configuration is server-only. No endpoint means **no exporter**, not a failing localhost loop. SDK telemetry still supplies local span correlation and manual metric APIs; without a reader, metrics are not externally persisted. For a collector reachable from Compose, use its actual network address, not the application's localhost.

### Scripts

`bun run packages:build observability` and `bun run packages:test observability` use the generic catalog lifecycle. No standalone CLI is needed: this package has no migration/service command. Consumers explicitly call `initializeObservability`, `flushObservability` and `shutdownObservability` in standalone processes.

### Database/migrations

None. Observability does not mutate or own database schema.

### Runtime processes

Runs inside Nitro and, optionally, an instrumented worker. Nitro's `close` hook flushes/shuts down exporters. The root Jobs adapter supplies a generic `onShutdown` callback after the worker drains; startup/fatal errors also flush before exit. Export requests have one-second timeouts and each flush/shutdown phase has a 2.5-second bound. Delivery is best effort when a collector is unavailable.

### Compose/infrastructure

The shared existing production image includes instrumented app/worker code. Compose passes configuration to those services; no telemetry service, migration change, proxy or vendor backend is introduced. `/api/health` retains its database check and adds only safe build and exporter-enabled flags, never endpoint URLs/headers.

## Application API

The package root is the Nuxt module. `/server` exports `getLogger`, `withLogContext`, `getRequestContext`, `getRequestId`, `captureException`, `withSpan`, `getTracer`, `getMeter`, `getBuildInfo`, initialization/status/flush/shutdown APIs and `observeOperation` for application-owned job/API wrappers. Common server helpers are Nitro-only auto-imports. Standalone code imports `/server`, which has no Nitro globals.

```ts
import { getLogger, withSpan } from '@repo/nuxt-observability/server'

await withSpan('projects.list', async () => {
  getLogger().info({ component: 'projects' }, 'projects.listed')
})
```

`getLogger()` exposes guarded Pino level methods and `child(fields)`, not unsafe serializer/transport/binding reconfiguration. Sensitive keys are recursively omitted case-insensitively, including nested arrays and children. `redactKeys` extends the list by field name. Bodies, headers, payloads, query, user/session objects and URLs are omitted; credential-bearing URL strings are redacted. `captureException` records a safe type and generic message, never arbitrary error text/stack/cause. Callers must still avoid secrets in custom free text, span names and unrecognized field names: sanitization cannot recognize every secret value.

Nitro uses `request`, `afterResponse`, `error`, `close` hooks and supported experimental async context (`useEvent`). Every incoming request receives `X-Request-ID`: 1–64 ASCII letters/digits/underscore/hyphen are accepted, otherwise a UUID replaces it. Async request lookup plus OTel AsyncLocalStorage gives nested logs their request/trace/span IDs without shared mutable request state. Only W3C `traceparent` is extracted; baggage is intentionally excluded. No blanket HTTP/DB/library monkey patching occurs.

Uncaught Nitro failures use the supported custom `errorHandler` boundary, returning safe generic JSON with the original valid HTTP error status, excluding raw URLs/data/stacks and suppressing Nitro's raw fallback logging. This also applies to uncaught page-render failures; applications needing custom error presentation must preserve that secrecy boundary. API Platform's handled `{error:{code,message}}` envelopes and 401/403/429 semantics are unchanged.

HTTP metrics: `app.http.requests`, `http.server.request.duration` (seconds), `app.http.errors` (5xx). Dimensions: bounded method, H3 registered route template or `unmatched`, status. Span names contain method/template, never the raw URL/query. `observeOperation` adds `app.job.*` / `app.api.*` execution/duration/failure metrics, bounded `job.name` / `api.operation_id` and outcome/status. IDs are log-only. Manual `getMeter()`/`getTracer()` use requires the same secrecy/cardinality discipline.

Prefer `withSpan` for automatic request parenting and active nested context. Direct standard tracer calls outside that helper must pass `getRequestContext()?.otelContext` explicitly as the parent; the module does not patch Nitro's router to make its request span globally active across the entire handler.

Root optional integrations:

- `starter.echo` wraps the handler with `observeOperation('job', ...)`: job name, safe ID, duration and success/failure, no payload. Registry/payload validation/pg-boss migration behavior is unchanged.
- `defineObservedApiHandler` wraps the existing API envelope handler with a registered operation ID and method/status; it never receives or logs API keys.
- No cross-process enqueue trace propagation is claimed. Each worker execution starts its own span, correlated by job name/ID; payload schemas are not modified to smuggle trace context.

## Installation

1. Add the private workspace dependency `@repo/nuxt-observability: workspace:*`, or use a locally packed tarball in a compatible external app. Nothing is published to npm.
2. Explicitly register `'@repo/nuxt-observability'` in Nuxt `modules`. Source presence never activates it.
3. Optionally set `observability: { serviceName, logLevel, redactKeys }`; configure deployment metadata and optional OTLP environment at runtime.
4. Instrument meaningful application operations using safe, registered names. Jobs/API wrappers remain consumer-owned and optional.
5. For standalone workers, initialize before work and await shutdown after draining, including fatal-startup paths.
6. Verify the package fixture and repository/container checks. No database migration is required.

## Removal

1. Remove the module/options and dependency; remove application imports/wrappers.
2. Root: restore `defineApiHandler` in both project routes and remove `server/utils/observed-api.ts`; unwrap `starter.echo`; remove Observability imports/initialization/lifecycle callbacks from `scripts/jobs-worker.ts` and `scripts/jobs-smoke.ts` while retaining Jobs itself.
3. Restore baseline `/api/health` (`status`, `timestamp`, existing database check), remove telemetry environment entries from Compose/`.env.example`, and update `referenceApplication.enabledCapabilities`.
4. Clear generated `.nuxt`/`.output`, reinstall and build/typecheck. Package-provided imports/plugin/error handler/async-context enablement disappear with module registration; remove no schema or migration.
5. The generic fixture proves owned dependency removal and clean post-removal typecheck/build. Existing Jobs/API package fixtures continue to prove operation without Observability.
6. A downstream fork may prune the package/fixture/evaluation/skill and capability contract only after updating the catalog/docs consistently; keep the ID if other roadmap entries reference it.

## Upgrade considerations

Keep API/stable SDK/exporter versions compatible with official OTel release families. Review Nitro async context/H3 route metadata/error hooks and Pino child behavior on upgrades. Rerun emitted-output secrecy, concurrency, W3C parenting, error spans, low-cardinality metrics, independent signals, unavailable-collector shutdown and packed removal checks. Retain server-only imports and Node-compatible production bundles.

## Verification

```sh
bun run capabilities:check
bun run packages:test observability
bun run packages:test jobs
bun run packages:test api-platform
bun run check
bun run test:e2e
```

The Observability fixture owns a temporary local HTTP/JSON OTLP receiver and proves actual trace/metric POSTs, shutdown export, secret omission, request IDs/concurrent isolation, nested/child logs, manual/server/error spans, W3C propagation, metrics/cardinality, no-backend and disabled configurations, independent signals, standalone success/failure and unavailable collector shutdown. Generic tooling owns tarball build/install, dependency arrival/removal, generated-state cleanup and before/after typecheck/build. CI discovers it through the existing catalog matrix; no handwritten Observability job is necessary.

## Agent guidance

Use `capability-change` and `observability-change`. Preserve optional integrations, secrets safety, low cardinality and bounded graceful shutdown. Browser telemetry, replay and product analytics remain future extensions, not part of v1.
