# Observability module evaluation

Capability #3 is `@repo/nuxt-observability`, a private optional Nuxt package following the Jobs/API package and catalog lifecycle. No publication scope is chosen and nothing is published. No database or collector service is added.

## Library choices and sources

- Pino **10.3.1**, JSON/NDJSON to stdout by default. No production pretty-printer requirement. [Official API](https://github.com/pinojs/pino/blob/main/docs/api.md) and [redaction guide](https://github.com/pinojs/pino/blob/main/docs/redaction.md).
- OTel API **1.9.1**, stable trace-node/trace-base/core/context/resources/metrics **2.11.0**, HTTP/JSON exporters **0.222.0** from the matching release train. The API is independently versioned. [Official releases](https://github.com/open-telemetry/opentelemetry-js/releases), [2.x compatibility/migration](https://github.com/open-telemetry/opentelemetry-js/blob/main/doc/upgrade-to-2.x.md), [instrumentation](https://opentelemetry.io/docs/languages/js/instrumentation/), [exporters](https://opentelemetry.io/docs/languages/js/exporters/).
- `NodeTracerProvider` with `BatchSpanProcessor` supplies explicit server/manual spans. `MeterProvider` plus `PeriodicExportingMetricReader` supplies metrics. These lower-level stable SDKs make initialization/export selection clear without the experimental convenience `sdk-node` dependency or its implicit exporter discovery.
- HTTP/JSON exporters are in OTel's experimental version family despite being released non-prerelease versions; pinned together with the stable SDK family. They let the fixture inspect actual wire requests without deploying a collector. A real backend must accept OTLP/HTTP JSON. gRPC/protobuf transports are not silently selected by this package.
- OTel Logs is not the primary signal: Pino is independently useful with no backend and gives a straightforward NDJSON transport/redaction contract. No OTel log bridge or vendor SDK is added.
- Blanket automatic instrumentation was avoided: explicit Nitro/manual/job/API spans give bounded labels and do not patch auth/database/network libraries or accidentally record SQL, credentials or arbitrary URLs.

## Nuxt/Nitro integration and context

The module uses [Nuxt Kit server imports/plugins](https://nuxt.com/docs/4.x/api/kit/nitro), [Nitro runtime hooks](https://v2.nitro.build/guide/plugins) (`request`, `afterResponse`, `error`, `close`), and Nitro's supported experimental [async request context](https://v2.nitro.build/guide/utils#async-context-experimental). Current Nuxt 4.5.2 installs Nitro 2.13.4/H3 1.15.x. Node/Bun is the supported runtime boundary; edge portability is not claimed.

Nitro `useEvent()` supplies request-scoped lookup through a plugin adapter; standalone `/server` code never imports Nitro globals. Event-owned state stores the request span/context. Manual nested spans use OTel AsyncLocalStorage and `context.with`, while application log fields use a separate scoped AsyncLocalStorage. No `enterWith` across request hooks or shared mutable request variable is used. This avoids depending on async hook changes escaping into the enclosing router continuation. Concurrent/interleaved fixture requests test that model.

Incoming request IDs are bounded ASCII correlation values; invalid/missing/oversized values are replaced with UUIDs and returned in `X-Request-ID`. W3C `traceparent` is extracted and tested as a server-span parent. Baggage and raw header maps are excluded. Request spans start with a bounded method and finish with H3's registered route template; arbitrary URL/query values never become span names or metric attributes.

The supported [Nitro `errorHandler`](https://v2.nitro.build/config#errorhandler) is necessary because the default fallback logs raw errors and full URLs, independently of the error hook. Uncaught failures instead return generic JSON/status without raw data or stack. API Platform's existing handled envelope path stays authoritative. Uncaught HTML/page errors also use this safe fallback; custom downstream error presentation must keep that safety contract.

## Secrecy and cardinality

Recursive case-insensitive omission covers authorization/cookies/API keys/passwords/secrets/tokens/credentials/database URLs and consumer-configured `redactKeys`. Raw headers/bodies/query/job payloads/user/session/URL fields are omitted. Strings containing credential URLs are redacted. Error capture exposes only a whitelisted type and generic message, never arbitrary messages/stacks/causes/custom fields. This trades detailed raw diagnostics for a safe default; apps should supply deliberate safe codes/operation context when needed.

Pino's child logger intentionally resets its bindings formatter. A real emitted-output regression test caught this; the public server logger therefore exposes only level methods and a guarded recursive `child(fields)` wrapper. Unsafe transport/serializer/setBindings customization is not part of its API. Free-text messages/custom field names/manual tracer/meter calls still require discipline: no sanitizer can infer every possible credential value.

HTTP conventions follow the current [span](https://opentelemetry.io/docs/specs/semconv/http/http-spans/) and [metric](https://opentelemetry.io/docs/specs/semconv/http/http-metrics/) semantic conventions: `http.request.method`, `http.route`, `http.response.status_code`, `http.server.request.duration` in seconds. Counts/errors and job/API metrics use an explicit `app.*` namespace. Bounded registered job/operation names, method, status and outcome are dimensions. Request/job/user/project/key/trace IDs and arbitrary URLs are excluded from dimensions. Job IDs remain log-only.

## Export activation, metadata and lifecycle

No endpoint creates no network exporter. Trace/metric exporters are independently `otlp` or `none`; `OTEL_SDK_DISABLED` retains useful logs/request IDs. Common endpoints append signal paths, per-signal endpoints are full URLs, and standard OTLP headers remain secret. Invalid URLs/exporter modes yield safe configuration diagnostics. Operator-defined resources are sanitized and authoritative service/version/revision/environment fields are applied afterward.

Metadata comes only from safe deployment environment values and the actual Node/Bun runtime version. No runtime Git executable or secret-bearing URL/config object is exposed in health responses. `/api/health` preserves database readiness, adding safe build fields and enabled-export flags, not collector configuration.

Initialization and shutdown are idempotent per process. Export requests time out at one second; flush and shutdown phases each have a 2.5-second bound and terminate exporters. Nitro `close` and the app-owned Jobs adapter invoke shutdown explicitly. Unavailable collectors cannot hold shutdown indefinitely; export delivery remains best effort. No unsupervised background backend is started.

## Optional integration boundaries

Jobs handler wrapping is application-owned; the package has no Jobs dependency. `starter.echo` records registered name, safe ID, duration/outcome and never its payload. A small generic Jobs CLI lifecycle contract (`onError`, `onShutdown`) allows the reference worker to drain first and flush telemetry, including fatal initialization. Without callbacks the existing Jobs behavior/defaults remain unchanged; migrations and `migrate:false` remain intact.

API wrapping is also application-owned (`server/utils/observed-api.ts`). It delegates status/envelopes to `defineApiHandler`, records the stable contract operation ID/method/status, and safely captures unexpected failures. It never logs raw machine credentials, bodies or session objects. Unit coverage specifically retains 401/403/429 behavior; the independent API fixture retains the full real-credential/security contract without Observability.

Cross-process enqueue propagation is deliberately not claimed. pg-boss payload contracts remain unchanged; a worker span starts independently and uses job name/ID for operational correlation. Future propagation needs a clean supported metadata mechanism, not hidden payload schema fields.

## Package lifecycle and verification

The catalog declares the private package, fixture, owned dependency assertions, runtime hook and removal contract. Generic preparation prepares only actual reference-app dependencies. Explicit build/test commands can also target `in-progress` packages during development; the CI matrix and unqualified build/test select only `done` packages.

The external-style fixture has no PostgreSQL, Jobs or API dependency. It packs/installs the actual artifact, typechecks/builds, starts production Node output, tests request IDs/concurrent isolation/safe child logs, manual/server/error spans/W3C parenting, HTTP metrics/cardinality, trace+metric POSTs, independent/disabled/no-backend exports, standalone job-like success/failure and unavailable-collector shutdown. A temporary lightweight HTTP receiver inspects OTLP JSON. Generic removal clears generated state, verifies owned dependencies disappear, then typechecks/builds the remaining Nuxt app. Existing Jobs/API fixtures prove their core operation without Observability.

Verification passed: all three packed package install/runtime/removal lifecycles; frozen installation; catalog validation; clean application/pg-boss migrations and Jobs doctor/smoke; lint, strict typecheck, 32 tests across 10 files, production build and the Playwright test. The real standalone-worker integration test proves job-span/metric export after SIGTERM and no payload disclosure. The shared production image also passed Compose's explicit migration gate, application health (`X-Request-ID`, safe release metadata, no-backend flags) and real instrumented worker execution. Existing Scalar CSS/chunk-size warnings remain non-blocking.

## Scope and publication

Server-only for v1. Browser telemetry, replay, analytics and vendor backend deployment remain out of scope. Before publication choose a real scope, review runtime/peer ranges and Node/Nitro support, and rerun packed install/removal with the selected scope. Compared with Jobs/API, this capability owns no schema/CLI/worker service but has a more sensitive output/context/shutdown contract; actual emitted logs and wire exports matter more than merely building the package.
