# Commands

All commands use Bun. PostgreSQL is required for migrations, authenticated runtime behavior, integration tests, and health checks.

CI pins Bun 1.4.2 independently and uses `actions/setup-node` for Node 24 in both the application check and every catalog-derived package lifecycle job. Each runtime job logs the exact Node/Bun versions and asserts Node major 24 before installation/runtime fixtures.

- `bun install --frozen-lockfile`: reproduce dependencies.
- `bun run agents:check`: read-only validation of canonical guidance/skills, project adapters and shared hook paths; no agent CLIs or authentication required.
- `bun run agents:test`: synthetic client payloads and temporary Git-fixture tests for hooks and capability governance.
- `bun run capabilities:check`: validate capability catalog schema, relationships, files, and declared package scripts.
- `bun run capabilities:status`: read the catalog and root Nuxt configuration to report availability, clean-consumer defaults, package-source presence, reference-app enablement, requirements, and external services; it does not modify the application.
- `docker compose up -d postgres`: start PostgreSQL 18.
- `docker compose build app`: build and tag the shared production application/migration image.
- `docker compose run --rm migrate`: explicitly apply application migrations, supported pg-boss migrations, and the jobs doctor using the production image; failure blocks release startup.
- `docker compose up -d --wait app worker`: start healthy PostgreSQL and the production application and standalone worker after migrations.
- `docker compose logs -f app worker postgres`: follow production-like application, worker, and database logs.
- `docker compose down --remove-orphans`: stop the stack without deleting PostgreSQL data; add `--volumes` only for an intentional clean database.
- `bun run db:generate`: generate a reviewed migration after schema changes.
- `bun run db:migrate`: apply committed migrations (never use push in production).
- `bun run jobs:migrate`: explicitly create/upgrade the pg-boss schema; uses `PGBOSS_DATABASE_URL` when set, otherwise `DATABASE_URL`.
- `bun run jobs:doctor`: fail on pg-boss schema drift or pending migration problems.
- `bun run jobs:worker`: run the standalone worker with migrations disabled.
- `bun run jobs:smoke`: enqueue `starter.echo`, run the real worker registration, and verify completion output.
- `bun run packages:prepare`: prepare selected done/in-progress root packages and their catalog hard-dependency closure; root postinstall runs this before Nuxt preparation.
- `bun run packages:build <id>`: produce a completed capability's publish-shaped package artifact without publishing it; omit IDs to build all completed package capabilities.
- `bun run packages:test <id>`: pack a completed capability and its hard-dependency closure, replace workspace references with local tarballs, install it in its catalog-declared fixture, run common typecheck/build and its optional fixture-owned runtime check, remove it, and prove the remaining app typechecks/builds; omit IDs to test all.
- `bun run packages:matrix`: emit the catalog-derived JSON matrix used by CI for completed packages and authored fixture-backed in-progress packages; it currently contains all twenty-two completed capabilities.
- Explicit `packages:build <id>` / `packages:test <id>` may target an in-progress package while developing it; unqualified build/test commands select only completed packages, while the CI matrix also includes authored fixture-backed in-progress packages.
- Observability package verification: `bun run packages:test observability`; the fixture owns safe-output/context/span/metric tests, actual local OTLP/HTTP JSON receiving, no-backend/independent-signal checks and bounded app/standalone shutdown. No external collector is needed.
- API package verification: `bun run packages:build api-platform` and `bun run packages:test api-platform`; the fixture owns database/auth/permission/OpenAPI/docs checks while generic orchestration owns packed install and removal.
- Use an isolated empty database for the external API fixture; its migration history is intentionally independent of the root reference application. Do not point it at a deployed/shared application database.
- Package CLI: `nuxt-jobs <worker|migrate|doctor|smoke>`; registry commands accept `--registry`, and smoke also requires `--job` plus JSON `--payload`.
- `bun run dev`: Nuxt development server.
- `bun run lint`: ESLint static checks.
- `bun run typecheck`: strict Nuxt/Vue TypeScript check.
- `bun run test`: Nuxt/Vitest unit and database integration suite; authorization coverage requires `DATABASE_URL` and migrated PostgreSQL.
- `PLAYWRIGHT_BASE_URL=http://127.0.0.1:<port> bun run test:e2e`: run the same health/API, session/machine Audit and browser contracts against an explicitly started production app; supply its disposable `DATABASE_URL` and auth secret.
- `bun run test:e2e`: Playwright browser smoke test, which starts Nuxt itself (install Chromium once with `bunx playwright install chromium`).
- Interactive browser tests await the root application's public `data-app-hydrated="true"` marker, set by `onNuxtReady`, before using controls. The shared helper gives cold startup 30 seconds; feature assertions retain their normal five-second budget. The same readiness contract applies to dev and production output.
- `bun run build` / `bun run start`: produce and serve portable Nitro output.
- `bun run check`: agent harness/tests, capability catalog, lint, typecheck, Nuxt/Vitest tests, and production build. Stop/AfterAgent hooks run only staged/unstaged whitespace checks plus the capability checker for governance changes and the agent-harness checker for harness changes (both for overlapping paths); full verification remains task/skill/CI-driven.
- `bun run auth:provision`: idempotently configure a development Pocket ID client using the documented environment.
- Container smoke: build the shared image, start `postgres`, run `migrate`, start `app worker` with `--wait`, curl `/api/health`, confirm the worker is running, then always run `docker compose down --volumes --remove-orphans`.
- Storage package: `bun run packages:test object-storage` runs the common real RustFS/Garage contract and UI/CORS/module runtime checks within generic packed install/removal. Docker is required; no other capability or storage config is needed for fixture build. Normal CI matrix discovers completed Storage metadata without a special job.
- `bun fixtures/storage-consumer/.fixture/reference-removal.ts`: verify the broader documented Storage removal in a temporary root-reference copy without touching external resources. Use a temporary location outside `node_modules` for this source-building check.
- `bun run storage:check`: read-only configured-bucket check; `storage:smoke`: unique temporary object/signing/multipart/policy contract with cleanup. Both use package exports, no consumer script rewriting.
- `bun run storage:dev:rustfs` / `storage:dev:garage`: explicitly bootstrap localhost single-node dev provider/bucket/CORS; `storage:dev:down` stops that project and retains named volumes. Override ports/dev credentials before initial bootstrap; on passwordless-sudo-only workstations add `STORAGE_DOCKER_SUDO=true`. See Storage contract for optional authenticated Garage UI and explicit-origin CORS. Normal `docker compose up -d postgres` remains unchanged.

- Email: `bun run packages:test email` verifies packed SMTP/Mailpit contract and clean removal. `email:check` verifies without sending; `email:smoke [recipient]` sends exactly once (explicit target outside local Mailpit). `email:dev:mailpit` / `email:dev:down` manage the disposable localhost sink, not the production stack.
- After a root production build, `bun fixtures/email-consumer/.fixture/reference-smoke.ts` checks the actual Nitro magic-link endpoint/delivery/redemption with disposable Mailpit and migrated `DATABASE_URL`; `reference-removal.ts` verifies documented application removal in a temporary copy. Neither runs automatically at turn completion.

`bun run webhooks:smoke` explicitly tests signed local delivery, inbound verification, Jobs retries/exhaustion and permanent rejection. `bun run packages:test webhooks` packs catalog hard dependencies and proves removal retains Jobs. No external endpoint is configured for root build/health/worker startup.

`bun run packages:test audit-log`: generic packed install/build/remove lifecycle and fixture-owned PostgreSQL migration, metadata, pagination and commit/rollback proof. Fixture creates a disposable database via DATABASE_URL (local test role needs CREATEDB); root migrations include audit_event. No Audit-specific CI orchestration.

- Cache: `bun run packages:test cache-coordination` owns real Valkey 9.1.2 Node/Bun protocol, lazy production boot, install/removal and explicit reconnect. `cache:check` pings configured server; `cache:smoke` uses unique exact keys. `cache:dev:valkey` starts explicit disposable loopback infrastructure, `cache:dev:down` stops it. No external FLUSH or migration exists. `bun fixtures/cache-consumer/.fixture/removal-data.ts` runs the generic Cache lifecycle while retaining an independent disposable backend to prove existing data survives removal.

- Realtime: `bun run packages:test realtime` verifies both actual Node SSE/WebSocket transports, all runtime config modes, auth/isolation,20sec heartbeats, bounded queues and clean removal. REALTIME_TRANSPORTS choices are sse(default),websocket,sse,websocket (Both); no generic client RPC.
- Notifications: `bun run packages:test notifications` verifies application migrations, transactional domain/notification/Jobs commit/rollback, recipient read/query, current-target delivery and disposable ntfy2.28.0. Generic runtime/post-removal/cleanup hooks retain and witness data/indexes/history/Jobs through final rebuild; `email-reference.ts` proves actual root Email adapter using disposable Mailpit. No public ntfy call. `bun run test:notification-email` runs actual disposable Mailpit from root check/production CI.
- Notifications tables require explicit `db:migrate`; deliveries use existing `jobs:migrate`/worker. Root E2E must exercise both transports with `REALTIME_TRANSPORTS=sse,websocket`; default production remains SSE unless chosen otherwise.

Search verification: bun run packages:test search retains an independent disposable PostgreSQL 18 database through removal and the final rebuild, then verifies exact rows/vector/GIN/migration hashes before cleanup. It tests shared canonical codec vectors and B-rank ties/microseconds at pages 1/default25/100, owner/keyset/privacy checks; apply root bun run db:migrate explicitly before Projects search. No additional worker or external service.

Production CI runs the full E2E suite against the built container with its disposable database. `DISPOSABLE_DATABASE_TESTS=true` permits a restored Search column-rename failure probe; `PRODUCTION_COMPOSE_PROJECT` selects only that test stack for safe-error/log privacy verification. Generic package-test metadata optionally declares `postRemovalScript` (after final rebuild) and `cleanupScript` (in finally) for retained external-state proofs. Both scripts must survive removal.

AI: `bun run packages:test ai` verifies packed install/backendless Node boot/actual local HTTP SDK adapter/disconnect/removal/post-removal build. `bun run ai:smoke` is a deliberately invoked single configured model operation, logging only safe finish/usage. No provider is required for ordinary check/build/start/health.

Ops/Admin (`done`): `bun run packages:test ops-admin` exercises packed baseline-only Better Auth/PostgreSQL auth, SSR/no-store/privacy and removal. No migration belongs to Ops.

Ops reference proof: after a root build, `bun run test:ops-reference` exercises the ordinary3/Ops1 retry canary and real disposable RustFS/Valkey/PostgreSQL read-only protocols. It then stages the actual root Ops composition in the authenticated baseline fixture, removes each provider package/helper/shutdown hook, asserts package resolution fails, and verifies typecheck/build/Ops access/session/login/health. Jobs removal also removes its hard-dependent Webhooks. All-provider and full Ops removal are included. Disabled instrumentation reports zero without collector contact. This composition proof does not claim removal of unrelated root product features; generic packed lifecycles own clean consumer installation/removal. No provider data cleanup exists in application removal.

Invoice Ninja: `bun run packages:test invoice-ninja` packs the Jobs/Webhooks closure, runs Node24/Bun mocked native wire fixtures and isolated PostgreSQL receipts/ledger/upgrade/rollback/privacy checks, then witnesses retained data after uninstall/rebuild. The Docker-based pinned 5.13.43 official-image fixture passed numeric-string draft/GET and isolated unsent zero-tax/discount checks; deployment-specific currency/company-hook policy remains separately required. Normal app/worker/health need no provider configuration.

Stripe verification: `bun run packages:test stripe` uses the official pinned SDK on Bun/Node24 against local wire/signature fixtures, a disposable PostgreSQL database and packed production consumer, then retains data through removal/rebuild. Root migrations include `0011_stripe_v1` and `0012_stripe_receipt_conflicts`; run app/Jobs migrations and doctor explicitly. Stripe CLI/account/sandbox/payment actions are not part of this fixture.

Medusa: `bun run packages:test medusa` exercises native Admin protocol and raw application-bridge verification on Bun1.4.2/actual Node24 plus a separately installed disposable Medusa2.21.2 backend/subscriber, PostgreSQL18 receipt+Jobs/retained-data/remove/rebuild. No external provider services or payment workflows. Apply app migration0013 and existing Jobs migration/doctor explicitly. Authenticated reference page: `/integrations/medusa`.

Data Table source-baseline evidence: the [combined CI run](https://github.com/formless63/demo-starter-nuxt/actions/runs/37008356538) passed all 20 jobs at `bfad9dce3ade72a42836d79103947de63a2a8279`, including all 18 generic package lifecycles and the full application check, browser suite, explicit migrations, production container/health and worker checks. Re-run full CI for subsequent revisions; static local checks alone do not replace database, Docker, browser or package runtime coverage.

Charts source `7e8daa68c9862ef982c6dd0aa7e4269903eda9fd` passed [all 20 CI jobs](https://github.com/formless63/demo-starter-nuxt/actions/runs/37018899032). Command retains its separately verified implementation ([all 20 jobs at e0a01fa](https://github.com/formless63/demo-starter-nuxt/actions/runs/37012702417)). Markdown / Code Content implementation `e99539d90020a70028545ac4f252c55c16e3f432` passed [all 23 CI jobs](https://github.com/formless63/demo-starter-nuxt/actions/runs/37029379598): all 21 generic packed package lifecycles, corrected real-browser payload/hydration/copy checks, full root checks, production browser/container/health, migrations and worker verification. This is source evidence; metadata promotion and later revisions require their own exact-head CI.

Data Table: `bun run packages:test data-table` verifies the actual packed component's SSR pagination/sorting/global and column filtering/manual modes/navigation states, then clean removal and rebuild. `bun run test tests/unit/data-table.test.ts tests/unit/data-table-vite-config.test.ts` verifies mounted controlled updates and actual Nuxt/Vite module-owned configuration. Root E2E covers the hydrated reference page; include it in full exact-head CI.

Command System: `bun run packages:test command-system` verifies packed production SSR/browser behavior and clean removal/typecheck/rebuild without a database.

Interactive browser tests await the root application’s public `data-app-hydrated="true"` marker set by `onNuxtReady`, before using controls. The shared helper gives cold startup 30 seconds; feature assertions retain the normal five-second budget in both dev and production.


Charts / Visualization: `bun run packages:test charts-visualization` verifies packed selective ECharts rendering and SSR table fallback, then clean removal and rebuild. Root chart unit/config/importer and browser contracts cover module-owned dependency discovery, exact zrender tslib resolution, responsive lifecycle and accessible fallback.


### Browser infrastructure ownership

Playwright runs the `application` project before the dependent `import-export` project. The latter creates/removes a disposable Docker bridge, so it must not overlap ordinary browser navigations. Both projects inherit the same development or explicit `PLAYWRIGHT_BASE_URL` production target, retain every assertion and timeout, and add no retries. A dependency failure blocks the downstream project and keeps CI failed; it is not a pass or skipped acceptance gate.

`bun run test:e2e --project=application` selects the application set. `bun run test:e2e --project=import-export` includes its application dependency; `--no-deps` is an explicit standalone fixture diagnostic and must not be used alongside another browser run. File/grep filters follow [Playwright dependency semantics](https://playwright.dev/docs/test-projects#test-filtering).

Evidence: [bounded CI probe](https://github.com/formless63/demo-starter-nuxt/actions/runs/37018590706/job/110875526426) on Chromium153.0.8010.12 held eight loopback module requests with six accepted connections. In both development and production passes, the two pending requests failed `ERR_NETWORK_CHANGED`19–38ms before the fixture's Docker network-create event. The real feature assertions remained intact. Ordinary acceptance does not intentionally abort requests; the investigative probe remains in the linked run and diagnostic history. Its bounded event/error evidence omits payloads, credentials, addresses and unrelated resource identities.

Markdown: `bun run packages:test markdown-code` is generic packed strict typecheck/build/shipped SSR/browser/install/removal. Browser gate is mandatory in hosted CI; report OS restrictions without bypassing it. `bun fixtures/markdown-code-consumer/.fixture/contract.ts` is the focused shipped parser/Vue SSR regression suite after module build.

Rich Text: `bun x vitest run --config vitest.rich-text.config.ts` runs independent validation/real Vue editor checks. `bun run packages:test rich-text` exercises actual packed types/build/SSR/browser/removal/rebuild. Root E2E waits for explicit Nuxt hydration readiness. Source implementation CI passed; the combined Markdown/Rich Text promotion requires exact-head CI.

Rich Text source `1666bb6e252fbedbbe20b545de8117e8a246820f` passed [all 23 CI jobs](https://github.com/formless63/demo-starter-nuxt/actions/runs/37031826840), including its real packed browser/removal lifecycle and full root production gates. The combined Markdown/Rich Text promotion records 22 completed opt-in capabilities; its own exact-head full CI remains pending before acceptance.
