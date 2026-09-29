# Jobs capability

PostgreSQL-backed background jobs implemented by the independently installable Nuxt package `@repo/nuxt-jobs`. `@repo/*` is an internal workspace scope, not a publication decision, and the package remains private. Implementation findings remain in [`JOBS_MODULE_EVALUATION.md`](../../JOBS_MODULE_EVALUATION.md).

`defaultInstalled` is false: clean consumers do not receive Jobs without selecting it. The root reference application enables it deliberately for integration testing.

## Requirements

Requires:

- No other reusable capability.
- Baseline PostgreSQL.

Integrates with:

- Observability, when installed, for worker/job telemetry.
- Ops / Admin, when installed, for operational queue views and actions.

External:

- PostgreSQL is required. pg-boss uses the existing database with a configurable schema.

The Jobs Nuxt module has no hard dependency on another Nuxt module and declares none.

## Adds

### Dependencies

- `pg-boss` 12.35.0 is a direct `@repo/nuxt-jobs` dependency and arrives with the package.
- `jiti` loads an application-owned TypeScript registry for standalone commands.
- Nuxt 4, Zod, and Drizzle are compatible peers supplied by the consumer. They remain baseline libraries, not capability-module dependencies.

### Environment

- `DATABASE_URL`: default application and jobs database connection.
- `PGBOSS_DATABASE_URL`: optional override for jobs processes or a separate migration role.
- `PGBOSS_SCHEMA`: pg-boss schema, default `pgboss`.
- `JOBS_CONCURRENCY`: worker concurrency, default `5`.
- `PGBOSS_USE_LISTEN_NOTIFY`: opt-in pg-boss LISTEN/NOTIFY, default `false`.
- `JOBS_REGISTRY`: optional package-CLI registry path override, default `server/jobs/registry.ts`.

All values are server-only.

### Scripts

- `bun run jobs:worker`: standalone worker.
- `bun run jobs:migrate`: explicitly create or upgrade the pg-boss schema.
- `bun run jobs:doctor`: fail on schema drift or migration problems.
- `bun run jobs:smoke`: enqueue and consume `starter.echo`, then verify its output.
- `bun run packages:build jobs`: build the publish-shaped module, runtime, declarations, and CLI.
- `bun run packages:test jobs`: verify a clean tarball install, Jobs-owned runtime checks, and removal lifecycle.

The long-term command contract is the package-provided `nuxt-jobs <worker|migrate|doctor|smoke>` bin. Consumer package scripts are optional aliases; Jobs does not rewrite them.

### Database/migrations

pg-boss owns its schema and supported migrations. Only `jobs:migrate` may run them. Nitro clients, workers, doctor, and smoke runtime instances use `migrate: false`; normal startup never mutates the pg-boss schema.

### Runtime processes

- A standalone worker runs through the package command contract; the reference app keeps a thin adapter for its production bundle.
- The Compose `migrate` service is a one-shot release gate, not a long-running process.
- Nitro creates its pg-boss enqueue client lazily and closes it on Nitro shutdown.

### Compose/infrastructure

The existing production image bundles Nitro and the jobs tools once. Compose uses that same image revision for `migrate`, `app`, and `worker`. The worker depends on healthy PostgreSQL, runs as the existing non-root user, has no source mount, restarts unless stopped, and handles SIGTERM/SIGINT gracefully. `docker compose up -d postgres` still starts only PostgreSQL.

## Application API

After explicit installation, the module registers server-only Nitro auto-imports:

```ts
await sendJob('starter.echo', { message: 'hello' })
```

For atomic application writes and enqueueing:

```ts
await db.transaction(async (tx) => {
  await tx.update(/* application data */)
  await sendJobInTransaction(tx, 'starter.echo', { message: 'committed' })
})
```

Consumers import `defineJob` and `defineJobRegistry` from `@repo/nuxt-jobs/server`; the package root is the Nuxt module entry. Task definitions live in application `server/jobs/tasks/` and are collected by `server/jobs/registry.ts`. Zod validation runs before enqueue and again at the worker execution boundary. `starter.echo` is a removable reference-app demonstration task.

## Installation

1. Add the private workspace package `@repo/nuxt-jobs` to a compatible Nuxt 4 application with `workspace:*`. It is not currently resolvable from npm; choose a real scope before publishing it.
2. Add `'@repo/nuxt-jobs'` to `nuxt.config.ts`. Source existing under `packages/` never enables the capability by itself.
3. Create the application registry and tasks under `server/jobs/` using the public package API.
4. Configure the server-only environment and optional command aliases.
5. Add migration/worker deployment roles and CI steps explicitly.
6. Apply `nuxt-jobs migrate`, run `nuxt-jobs doctor`, then start the worker.

`fixtures/jobs-consumer` is the minimal external-style example. The package must not rewrite consumer scripts, Docker, Compose, or CI.

## Removal

1. Stop/drain the worker and decide whether queued work must be retained.
2. Remove the package from Nuxt's modules array and dependencies.
3. Remove the application registry/tasks, Jobs API calls, command aliases, tests, deployment roles, CI steps, and environment entries.
4. Clear generated Nuxt state and reinstall so stale auto-import types cannot hide a dependency.
5. Typecheck/build the remaining application. The clean-package test executes this contract and confirms `pg-boss` also leaves.
6. Retain the `pgboss` schema for rollback safety or drop it explicitly only after queued work is no longer needed.

## Upgrade considerations

- Review pg-boss release notes and migration notes before changing its version.
- Rebuild/pack the module and run the catalog-driven clean fixture lifecycle when changing its package boundary or Nuxt module builder.
- Apply the supported pg-boss migration explicitly on a clean database and run `jobs:doctor`.
- Confirm every long-running instance still uses `migrate: false`.
- Re-run invalid-payload behavior, transaction commit/rollback, worker shutdown, production image, and Compose smoke coverage.
- Revisit LISTEN/NOTIFY compatibility before enabling it behind transaction-pooling proxies.

## Verification

```sh
bun run capabilities:check
bun run packages:build jobs
bun run packages:test jobs
bun run jobs:migrate
bun run jobs:doctor
bun run jobs:smoke
bun run test
bun run check
bun run test:e2e
```

Production verification builds the shared image, runs the one-shot migration service, starts `app` and `worker`, checks `/api/health`, confirms the worker is running, and shuts the stack down cleanly.

The generic package test proves tarball installation, owned-dependency arrival/removal, strict typecheck/build, generated-state cleanup, and post-removal build. The Jobs fixture's `package:test:runtime` hook separately proves registry extension, migrations/doctor, the package worker, and a queued smoke job.

## Agent guidance

Use both `.agents/skills/capability-change/SKILL.md` and `.agents/skills/jobs-change/SKILL.md` when changing this capability or its relationships. Preserve explicit Nuxt opt-in, package-owned dependencies/CLI, explicit migrations, execution-boundary payload validation, server-only code, atomic Drizzle enqueueing where needed, and the shared production image contract.
