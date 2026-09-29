# Starting a project

The repository is both a baseline starter and a reference application. Decide whether Jobs and API Platform belong in the product before building domain features around them.

## Full/reference setup

Keep both completed capabilities when durable background work and a machine-facing API are likely requirements. The root application already:

- depends on and registers `@repo/nuxt-jobs` and `@repo/nuxt-api`;
- includes a Jobs registry and `starter.echo` demonstration task;
- composes API Platform into Better Auth and exposes project API contracts;
- includes the application and API-key migration plus explicit pg-boss migration commands;
- builds the app, migration tools, and Jobs worker into one production image; and
- exercises both packages through catalog-driven fixture tests and CI.

Follow the [README quick start](../README.md#quick-start), then remove or rename the demonstration domain pieces as the real application takes shape.

## Lean baseline

Remove a capability only after checking its [technical contract](CAPABILITIES.md#capability-status). The recipes below are intentionally explicit because the completed capabilities touch shared auth, schema, migrations, and deployment. There is no automatic source-rewriting uninstaller.

The package-level core of both recipes is continuously verified by `bun run packages:test <id>`: the test installs the packed package into a clean fixture, exercises its runtime contract, removes its dependency and consumer files, clears generated state, and proves the base fixture still typechecks/builds. The root-specific steps below cover the broader reference integration.

## Remove Jobs

1. Stop and drain the worker if it has ever processed real work. Decide whether queued jobs must be retained.
2. Remove `'@repo/nuxt-jobs'` from `nuxt.config.ts` and `@repo/nuxt-jobs` from root `package.json`.
3. Remove the `jobs:worker`, `jobs:migrate`, `jobs:doctor`, and `jobs:smoke` root aliases and the thin adapters `scripts/jobs-worker.ts`, `scripts/jobs-migrate.ts`, `scripts/jobs-doctor.ts`, and `scripts/jobs-smoke.ts`.
4. Remove application-owned job definitions and registry under `server/jobs/`, the demonstration route `server/api/jobs.post.ts`, and every remaining `sendJob`/`sendJobInTransaction` call.
5. Remove Jobs-specific tests: `tests/unit/jobs-registry.test.ts` and `tests/unit/jobs.integration.test.ts`.
6. Remove Jobs build outputs and commands from `Dockerfile`: `.jobs`, its four Jobs Bun build commands, and its runtime copy. In `compose.yaml`, remove the pg-boss migration/doctor portion from `migrate`, remove the `worker` service, and remove Jobs-only environment values. Keep the application migration service and app service intact.
7. Remove Jobs-only environment examples and documentation references, reinstall dependencies, clear `.nuxt`/`.output`, then run `bun run capabilities:check`, `bun run lint`, `bun run typecheck`, `bun run test`, `bun run build`, `bun run test:e2e`, and the production app/migration container smoke without the worker.

The pg-boss schema is external to Drizzle application migrations. Keep it by default for rollback and queued-work safety. For an already-deployed application, dropping it is a separate destructive database operation that requires explicit review. A fresh, never-deployed project can simply omit `jobs:migrate`; no pg-boss schema will be created.

If a downstream fork will never reuse Jobs, follow the pruning metadata guidance in [Using capabilities](CAPABILITIES.md#prune-from-a-downstream-fork), then optionally delete `packages/nuxt-jobs/`, `fixtures/jobs-consumer/`, `capabilities/jobs/`, `JOBS_MODULE_EVALUATION.md`, and `.agents/skills/jobs-change/`. Do this only after the root no longer imports the package.

## Remove API Platform

1. If deployed, revoke existing keys first when external access must end immediately.
2. Remove `'@repo/nuxt-api'` from `nuxt.config.ts`, its `apiPlatform` module options, and `@repo/nuxt-api` from root `package.json`.
3. Remove the `apiPlatformAuth()` import/call from `server/utils/auth.ts` while preserving GitHub, generic OIDC, hashed magic-link, and database-session behavior.
4. Remove the package `apikey` import/export and its entry in the exported `schema` object from `server/database/schema.ts`.
5. Remove application-owned external API contracts and native routes under `server/api-platform/` and `server/api/v1/`.
6. Remove human key management under `server/api/api-keys/`, `server/utils/api-keys.ts`, and `app/pages/app/api-keys.vue`; remove its navigation link from `app/layouts/app.vue`.
7. Remove API Platform-specific assertions from `tests/unit/api-platform.test.ts` and delete that file when nothing remains.
8. Reinstall dependencies, clear `.nuxt`/`.output`, then run `bun run capabilities:check`, `bun run lint`, `bun run typecheck`, `bun run test`, `bun run build`, `bun run test:e2e`, and the production application/migration container smoke.

Keep `server/database/migrations/0001_api-platform.sql` and the migration journal/snapshot for an already-deployed application. Historical migrations describe databases that already exist; do not rewrite or delete them. If dropping `apikey` is intentional, add a new reviewed migration after deciding that credential destruction and loss of rollback are acceptable.

For a truly fresh project where no local, shared, CI, staging, or production database has ever applied the API migration, you may remove the API table from the desired schema and regenerate a coherent migration history before the first deployment. Do not delete only the SQL file while leaving Drizzle journal/snapshot metadata inconsistent; verify the regenerated history against an empty database. Retaining the unused table migration is also safe and simpler.

If a downstream fork will never reuse API Platform, follow the pruning metadata guidance in [Using capabilities](CAPABILITIES.md#prune-from-a-downstream-fork), then optionally delete `packages/nuxt-api/`, `fixtures/api-consumer/`, `capabilities/api-platform/`, `API_PLATFORM_MODULE_EVALUATION.md`, and `.agents/skills/api-contract-change/`. Do this only after auth, schema, routes, UI, and tests no longer import the package.

## Fresh versus deployed removal

| Situation | Application code | Migration history and data |
| --- | --- | --- |
| Fresh, never deployed, disposable databases only | Remove capability integration before product work | Migration history may be regenerated coherently and verified on an empty database; never edit only one history file |
| Already deployed or shared | Remove runtime integration after draining/revoking as appropriate | Preserve historical migrations and data by default; use a new explicit reviewed migration for intentional destruction |

After either path, `bun run capabilities:status` should report whether the capability remains enabled in the root application. If package source is retained for future reuse, “package source present: yes” and “enabled in reference app: no” is the expected result.
