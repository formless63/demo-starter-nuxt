# Jobs capability

PostgreSQL-backed background jobs implemented with pg-boss 12.35.0 as the starter's first reusable local Nuxt module. The canonical implementation findings remain in [`JOBS_MODULE_EVALUATION.md`](../../JOBS_MODULE_EVALUATION.md).

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

- `pg-boss` 12.35.0 is the capability-owned runtime dependency.
- Existing Zod validates payloads, existing Drizzle supplies transactional enqueue support through pg-boss's official adapter, and the baseline Node runtime runs production artifacts. These are starter libraries/runtime, not capability-module dependencies.

### Environment

- `DATABASE_URL`: default application and jobs database connection.
- `PGBOSS_DATABASE_URL`: optional override for jobs processes or a separate migration role.
- `PGBOSS_SCHEMA`: pg-boss schema, default `pgboss`.
- `JOBS_CONCURRENCY`: worker concurrency, default `5`.
- `PGBOSS_USE_LISTEN_NOTIFY`: opt-in pg-boss LISTEN/NOTIFY, default `false`.

All values are server-only.

### Scripts

- `bun run jobs:worker`: standalone worker.
- `bun run jobs:migrate`: explicitly create or upgrade the pg-boss schema.
- `bun run jobs:doctor`: fail on schema drift or migration problems.
- `bun run jobs:smoke`: enqueue and consume `starter.echo`, then verify its output.

### Database/migrations

pg-boss owns its schema and supported migrations. Only `jobs:migrate` may run them. Nitro clients, workers, doctor, and smoke runtime instances use `migrate: false`; normal startup never mutates the pg-boss schema.

### Runtime processes

- A standalone worker runs `scripts/jobs-worker.ts` in development and `.jobs/worker.mjs` in production.
- The Compose `migrate` service is a one-shot release gate, not a long-running process.
- Nitro creates its pg-boss enqueue client lazily and closes it on Nitro shutdown.

### Compose/infrastructure

The existing production image bundles Nitro and the jobs tools once. Compose uses that same image revision for `migrate`, `app`, and `worker`. The worker depends on healthy PostgreSQL, runs as the existing non-root user, has no source mount, restarts unless stopped, and handles SIGTERM/SIGINT gracefully. `docker compose up -d postgres` still starts only PostgreSQL.

## Application API

The local module registers server-only Nitro auto-imports:

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

Task definitions live in `server/jobs/tasks/` and are collected by `server/jobs/registry.ts`. Zod validation runs before enqueue and again at the worker execution boundary. `starter.echo` is a removable demonstration task.

## Installation

The current starter already has Jobs installed:

1. `pg-boss` is pinned in `package.json` and `bun.lock`.
2. `modules/jobs/index.ts` is auto-discovered by Nuxt 4; it is not manually added to `nuxt.config.ts`.
3. The application registry and tasks live under `server/jobs/`.
4. Package scripts, Docker build outputs, Compose services, CI steps, environment examples, tests, and documentation are explicit consumer-repository changes.
5. Run application migrations, `bun run jobs:migrate`, and `bun run jobs:doctor` before starting the worker.

A future published module should install normally as a Nuxt module and expose stable CLI/bin commands. It must not rewrite consumer package scripts, Docker, Compose, or CI files behind the scenes.

## Removal

1. Stop the worker and decide whether queued work must be drained or retained.
2. Remove `modules/jobs/`, `server/jobs/`, the four jobs scripts, jobs tests, and jobs-specific agent/evaluation/contract files.
3. Remove `pg-boss`, the four package scripts, environment entries, Docker `.jobs` bundles, the Compose worker and pg-boss migration/doctor commands, and CI jobs steps.
4. Remove Jobs from `capabilities/catalog.json` relationships or change its status only as part of an intentional governance decision; update `ROADMAP.md` in the same change.
5. Regenerate the lockfile and run full verification.
6. Retain the `pgboss` PostgreSQL schema for rollback safety or drop it explicitly only after confirming no queued work is needed.

## Upgrade considerations

- Review pg-boss release notes and migration notes before changing its version.
- Apply the supported pg-boss migration explicitly on a clean database and run `jobs:doctor`.
- Confirm every long-running instance still uses `migrate: false`.
- Re-run invalid-payload behavior, transaction commit/rollback, worker shutdown, production image, and Compose smoke coverage.
- Revisit LISTEN/NOTIFY compatibility before enabling it behind transaction-pooling proxies.

## Verification

```sh
bun run capabilities:check
bun run jobs:migrate
bun run jobs:doctor
bun run jobs:smoke
bun run test
bun run check
bun run test:e2e
```

Production verification builds the shared image, runs the one-shot migration service, starts `app` and `worker`, checks `/api/health`, confirms the worker is running, and shuts the stack down cleanly.

## Agent guidance

Use both `.agents/skills/capability-change/SKILL.md` and `.agents/skills/jobs-change/SKILL.md` when changing this capability or its relationships. Preserve explicit migrations, execution-boundary payload validation, server-only code, atomic Drizzle enqueueing where needed, and the shared production image contract.
