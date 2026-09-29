# Jobs module evaluation (September 2026)

## Prototype inventory

- pg-boss **12.35.0** is the sole new runtime dependency and is pinned in `package.json`/`bun.lock`. Existing Zod, Drizzle, postgres, Nuxt, Bun, and Node dependencies are reused.
- The local module lives in `modules/jobs/`. Nuxt 4 discovers `modules/jobs/index.ts` automatically; it is deliberately absent from the manual `modules` array in `nuxt.config.ts`.
- The module owns typed module options, private runtime configuration, the pg-boss factory, registry primitives, queue/worker registration, typed enqueue functions, the official Drizzle transaction adapter, Nitro server imports, and Nitro shutdown cleanup.
- Application-owned pieces are `server/jobs/registry.ts` and `server/jobs/tasks/starter-echo.ts`. `starter.echo` is an explicitly disposable demonstration task.
- Consumer-owned scripts are `jobs:worker`, `jobs:migrate`, `jobs:doctor`, and `jobs:smoke`. Environment settings are `PGBOSS_SCHEMA` (default `pgboss`), `JOBS_CONCURRENCY` (default `5`), and `PGBOSS_USE_LISTEN_NOTIFY` (default `false`). `PGBOSS_DATABASE_URL` overrides `DATABASE_URL` for jobs processes, including a separate migration role.
- Files outside `modules/jobs/` changed for the application registry/task, scripts, tests, dependency/lockfile, environment example, Dockerfile, Compose, CI, README, stack/architecture/commands notes, agent skill, and this evaluation.

## Installation and published-module shape

The current install behavior is genuine Nuxt local-module behavior: placing `index.ts` under `modules/jobs/` makes Nuxt run the module, and Nuxt Kit registers server-only imports and the shutdown plugin. The application consumes `sendJob(...)` and `sendJobInTransaction(...)` through Nitro auto-imports; browser bundles receive neither pg-boss nor database code.

A published form should expose a normal Nuxt module such as `@formless/nuxt-jobs`, installed with Nuxt's module installer and configured in `nuxt.config.ts`. It should also expose a package `bin`/CLI for `worker`, `migrate`, `doctor`, and `smoke` so consumer scripts can call stable commands instead of importing package internals. Publishing is intentionally deferred.

Nuxt's module system naturally owns runtime/server utilities, types, module options, runtime configuration, aliases, server imports, and Nitro plugins. It does not naturally own a consumer's package scripts, application task registry, Dockerfile, Compose services, CI workflow, or release runbook. This prototype keeps those changes explicit rather than performing brittle source rewriting.

## Production and removal

The existing `compose.yaml` was extended instead of adding `compose.jobs.yaml`. A single file makes the normal production-like stack and CI invocation unambiguous, while the `worker` remains opt-in in practice because `docker compose up -d postgres` still names and starts only PostgreSQL. The tradeoff is that removal touches the shared Compose file rather than deleting one additive file.

The production image bundles Nitro, the application migrator, and all jobs entrypoints once. The one-shot `migrate` service applies application migrations, applies supported pg-boss migrations, then runs the pg-boss doctor. `app` and `worker` use that exact image revision. Every long-running pg-boss instance sets `migrate: false`; a failed explicit migration/doctor command blocks release startup.

To remove the capability, delete `modules/jobs/`, `server/jobs/`, the four jobs scripts/tests/skill/evaluation, remove pg-boss and its scripts from the manifest, remove the jobs build artifacts and Compose worker/jobs migration commands, remove jobs CI/docs/env entries, then regenerate the lockfile. The application schema is independent. The `pgboss` PostgreSQL schema may be retained for rollback or dropped explicitly after confirming no queued work is needed.

## Findings

Framework-specific glue is small: one Nuxt module entry, one alias to the consumer registry, two Nitro server imports, and one shutdown plugin. The registry, worker, scripts, and transaction support are runtime-neutral TypeScript. The official pg-boss Drizzle adapter avoids leaking adapter internals into feature code and makes the application mutation and enqueue one PostgreSQL transaction.

Nuxt local-module discovery and Nitro server imports worked cleanly. Bun runs the TypeScript development commands, while Bun's bundler emits Node-targeted worker/tool artifacts for the existing non-root Node production image. pg-boss owns a separate schema and supported migration lifecycle; keeping migration authority out of runtime startup is operationally clearer but adds a mandatory release step. LISTEN/NOTIFY stays off by default because polling is portable across connection poolers; operators can opt in deliberately.

No dashboard was added. A later optional module/profile could add one, but it should not introduce Hono, Fastify, or Express into this starter merely to mount UI.

This feels robust enough for a maintained personal local module: boundaries are visible, transaction semantics and invalid payloads are tested against PostgreSQL, and deployment uses one image. Before extraction, add a package-level test fixture with a minimal Nuxt consumer, define the public registry-resolution API without a project alias, publish a stable CLI/bin contract, test multiple supported Nuxt/Node versions, and write upgrade/removal automation that reports changes without rewriting consumer files.
