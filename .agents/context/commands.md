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
- `bun run packages:matrix`: emit the catalog-derived JSON matrix used by CI for completed package capabilities.
- Explicit `packages:build <id>` / `packages:test <id>` may target an in-progress package while developing it; unqualified commands and the CI matrix still select only completed packages.
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

Organizations in-progress verification: `bun run packages:test organizations` exercises native HTTP/auth.api, postgres-js/pg on Bun/Node24 and retained-data removal. `bun fixtures/organizations-consumer/.fixture/upstream-atomicity.ts` reproduces the upstream crash window using only one uniquely owned loopback PostgreSQL18 database. This diagnostic is not an atomicity or completion claim.

Identity-policy checks: `bun run packages:test authorization`, `bun run packages:test feature-flags`; each retains a uniquely owned local PostgreSQL18 database through removal/rebuild. `identity:fixture` requires explicit local operator/subject authority; never seed at startup. Run browser verification after package rebuilding completes because the shared generated artifacts are replaced by prepack.

The generic CI matrix includes done/in-progress package pairs with packageTest metadata, so hosted lifecycle checks precede the status-done gate. Default local `packages:test` remains the completed-capability sweep; explicit IDs verify in-progress work.
