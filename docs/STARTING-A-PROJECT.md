# Starting a project

The repository is both a baseline starter and a reference application. Choose which of the twelve completed capabilities belong in the product before building domain features around them.

## Full/reference setup

The root application explicitly registers Jobs, API Platform, Observability, Object Storage, Email, Webhooks, Audit Log, Cache / Coordination, Realtime, Notifications, Search and AI. It includes:

- one Jobs registry and standalone worker with transactional enqueue;
- Better Auth and owner-scoped browser and machine API routes;
- explicit application/API/Audit/Notification migrations, a Projects search vector/index, and separate pg-boss migrations;
- one production image for the app, migration tools and worker;
- lazy optional S3, SMTP, Cache and AI adapters with no provider required at startup;
- transactionally appended audit history and notifications, plus ID-only post-commit hints over authenticated SSE/WebSocket transports;
- all twelve catalog-driven package install/runtime/removal/rebuild checks in generic CI.

Follow the [README quick start](../README.md#quick-start), then remove or rename the demonstration domain pieces as the real application takes shape.

Storage stays unused/backendless until configured. Supply a region explicitly through `STORAGE_REGION`, `AWS_REGION` or `AWS_DEFAULT_REGION`; no implicit region is assumed. Local helpers supply RustFS `us-east-1` / Garage `garage`. Optional Noooste Garage UI v0.13.0 is third-party, not official Garage or required for S3, and stays localhost-bound. Its privileged admin-token login is operator-only; known dev tokens are local-only, never application browser configuration or normal S3 credentials. See the [Storage contract](../capabilities/object-storage/CAPABILITY.md) and [shared baseline](../OBJECT_STORAGE_MODULE_EVALUATION.md#shared-cross-framework-baseline).

## Choose realtime transports

Both adapters are available. Choose **SSE** (`REALTIME_TRANSPORTS=sse`, default recommendation for ordinary server-to-browser updates), **WebSocket** (`websocket`) or **Both** (`sse,websocket`). WebSocket v1 transports the same events and is not generic RPC; clients answer the transport heartbeat and refetch authoritative state on reconnect. Preserve authenticated session/channel policy at the application routes and check deployment proxy streaming/Upgrade support. Optional Cache fanout stays non-durable and does not restore missed events.

## Lean baseline

Remove a capability only after checking its [technical contract](CAPABILITIES.md#capability-status). The recipes below are intentionally explicit because the completed capabilities touch shared auth, schema, migrations, and deployment. There is no automatic source-rewriting uninstaller.

The package-level core of these recipes is continuously verified by `bun run packages:test <id>`: the test installs the packed package into a clean fixture, exercises its runtime contract, removes its dependency and consumer files, clears generated state, and proves the base fixture still typechecks/builds. The root-specific steps below cover the broader reference integration. Update `referenceApplication.enabledCapabilities` whenever root enablement changes; if command aliases are removed, remove their declarations from the capability's catalog `scripts` as well.

## Remove Jobs

Remove Notifications and Webhooks first because both hard-require Jobs. Retain independent Realtime/Email/Audit/Cache when selected.

1. Stop and drain the worker if it has ever processed real work. Decide whether queued jobs must be retained.
2. Remove `'@repo/nuxt-jobs'` from `nuxt.config.ts` and `@repo/nuxt-jobs` from root `package.json`.
3. Remove the `jobs:worker`, `jobs:migrate`, `jobs:doctor`, and `jobs:smoke` root aliases and the thin adapters `scripts/jobs-worker.ts`, `scripts/jobs-migrate.ts`, `scripts/jobs-doctor.ts`, and `scripts/jobs-smoke.ts`.
4. Remove application-owned job definitions and registry under `server/jobs/`, the demonstration route `server/api/jobs.post.ts`, and every remaining `sendJob`/`sendJobInTransaction` call.
5. Remove Jobs-specific tests: `tests/unit/jobs-registry.test.ts`, `tests/unit/jobs.integration.test.ts`, `tests/unit/observability-worker.integration.test.ts` and the Jobs case/import in `tests/unit/observability-integrations.test.ts`. Retain the independent API/Observability assertions when those capabilities remain enabled.
6. Remove Jobs build outputs and commands from `Dockerfile`: `.jobs`, its four Jobs Bun build commands, and its runtime copy. In `compose.yaml`, remove the pg-boss migration/doctor portion from `migrate`, remove the `worker` service, and remove Jobs-only environment values. Keep the application migration service and app service intact.
7. Remove Jobs-only environment examples and documentation references, reinstall dependencies, clear `.nuxt`/`.output`, then run `bun run capabilities:check`, `bun run lint`, `bun run typecheck`, `bun run test`, `bun run build`, `bun run test:e2e`, and the production app/migration container smoke without the worker.

The pg-boss schema is external to Drizzle application migrations. Keep it by default for rollback and queued-work safety. For an already-deployed application, dropping it is a separate destructive database operation that requires explicit review. A fresh, never-deployed project can simply omit `jobs:migrate`; no pg-boss schema will be created.

If a downstream fork will never reuse Jobs, follow the pruning metadata guidance in [Using capabilities](CAPABILITIES.md#prune-from-a-downstream-fork), then optionally delete `packages/nuxt-jobs/`, `fixtures/jobs-consumer/`, `capabilities/jobs/`, `JOBS_MODULE_EVALUATION.md`, and `.agents/skills/jobs-change/`. Do this only after the root no longer imports the package.

## Remove API Platform

1. If deployed, revoke existing keys first when external access must end immediately.
2. Remove `'@repo/nuxt-api'` from `nuxt.config.ts`, its `apiPlatform` module options, and `@repo/nuxt-api` from root `package.json`.
3. Remove the `apiPlatformAuth()` import/call from `server/utils/auth.ts` while preserving GitHub, generic OIDC, hashed magic-link, and database-session behavior.
4. Remove the package `apikey` import/export and its entry in the exported `schema` object from `server/database/schema.ts`.
5. Remove application-owned external API contracts and native routes under `server/api-platform/` and `server/api/v1/`, plus `server/utils/observed-api.ts` and its API-specific integration tests. Observability remains useful without API Platform.
6. Remove human key management under `server/api/api-keys/`, `server/utils/api-keys.ts`, and `app/pages/app/api-keys.vue`; remove its navigation link from `app/layouts/app.vue`.
7. Remove API Platform-specific assertions from `tests/unit/api-platform.test.ts` and delete that file when nothing remains.
8. Reinstall dependencies, clear `.nuxt`/`.output`, then run `bun run capabilities:check`, `bun run lint`, `bun run typecheck`, `bun run test`, `bun run build`, `bun run test:e2e`, and the production application/migration container smoke.

Keep `server/database/migrations/0001_api-platform.sql` and the migration journal/snapshot for an already-deployed application. Historical migrations describe databases that already exist; do not rewrite or delete them. If dropping `apikey` is intentional, add a new reviewed migration after deciding that credential destruction and loss of rollback are acceptable.

For a truly fresh project where no local, shared, CI, staging, or production database has ever applied the API migration, you may remove the API table from the desired schema and regenerate a coherent migration history before the first deployment. Do not delete only the SQL file while leaving Drizzle journal/snapshot metadata inconsistent; verify the regenerated history against an empty database. Retaining the unused table migration is also safe and simpler.

If a downstream fork will never reuse API Platform, follow the pruning metadata guidance in [Using capabilities](CAPABILITIES.md#prune-from-a-downstream-fork), then optionally delete `packages/nuxt-api/`, `fixtures/api-consumer/`, `capabilities/api-platform/`, `API_PLATFORM_MODULE_EVALUATION.md`, and `.agents/skills/api-contract-change/`. Do this only after auth, schema, routes, UI, and tests no longer import the package.

## Remove Observability

1. Remove `'@repo/nuxt-observability'` and `observability` options from `nuxt.config.ts`, its root dependency, and its ID from `referenceApplication.enabledCapabilities`.
2. Restore `defineApiHandler` in both `server/api/v1/projects/` routes; remove `server/utils/observed-api.ts`. Keep API Platform auth/contracts/routes intact.
3. Unwrap `starter.echo` to its plain payload handler. Remove telemetry imports/initialization/callbacks from `scripts/jobs-worker.ts`; keep `runJobsWorker(jobRegistry)`. Remove only telemetry shutdown/imports from `scripts/jobs-smoke.ts`; keep Jobs migrations/CLI/runtime/worker and `migrate:false`.
4. In `server/api/health.get.ts`, remove telemetry imports and `build`/`observability` output fields; preserve the database query and `{status:'ok',timestamp}` output.
5. Remove the Compose telemetry anchor/merges/service-name entries and telemetry environment examples, retaining the existing database/auth configuration. Remove Observability-specific unit/integration tests (or retain independent Jobs/API assertions). No database schema/migration change is needed.
6. Reinstall, clear generated `.nuxt`/`.output`, then run all checks, existing Jobs/API fixtures and production container smoke. The module-owned Nitro plugin/imports/error handler/async-context configuration leave with module registration. Pino/OTel dependencies disappear where no other retained package uses them.

For permanent pruning, consistently update catalog/docs before removing `packages/nuxt-observability`, `fixtures/observability-consumer`, `capabilities/observability`, the evaluation and specific skill. Preserve the roadmap ID when optional integrations reference it. The [capability contract](../capabilities/observability/CAPABILITY.md) details the package-level removal proof.

## Remove Object Storage

1. Remove `'@repo/nuxt-storage'` from Nuxt modules, its root dependency and `object-storage` from `referenceApplication.enabledCapabilities`.
2. Remove `server/utils/observed-storage.ts`, `server/plugins/storage.ts`, `scripts/storage.ts` and `scripts/storage-dev.ts`; remove any product-specific Storage calls/routes. Remove root `storage:*` aliases and their catalog `scripts` declarations. Retained Jobs/API/Observability behavior is unaffected.
3. Remove Storage variables from `.env.example` and app environment in `compose.yaml`. Remove optional `compose.storage.yaml`. If retaining the independent package fixture, retain its provider assets; they do not activate application infrastructure on their own.
4. Remove `tests/unit/storage.test.ts` and `tests/unit/storage-observability.test.ts` (or adapt independent assertions). No SQL migration/schema change exists. Stop only the explicitly named local storage project if no longer used, retaining volumes by default.
5. Clear `.nuxt`/`.output`, reinstall and run capability validation, typecheck/build and normal verification. The package fixture verifies owned AWS dependencies disappear when unused; a temporary reference copy verifies these broader integration steps.

Do not delete remote buckets/objects, revoke remote access keys or delete named-volume data automatically. These resources are operator-controlled and may outlive the application code. For permanent pruning, update catalog/docs consistently before deleting `packages/nuxt-storage`, `fixtures/storage-consumer`, capability contract, `OBJECT_STORAGE_MODULE_EVALUATION.md` and `.agents/skills/storage-change`. Preserve the roadmap ID for File UI/Import/Export and other relationships.

When removing **Observability but retaining Storage**, remove the optional imports/runner in `observed-storage.ts` and use plain `createStorage()`/`getStorage()`; remove initialization/shutdown instrumentation from `scripts/storage.ts`. Keep Storage commands/core API/provider configuration. This does not introduce a hard dependency.

## Remove Email

1. Explicitly disable `NUXT_MAGIC_LINK_ENABLED` and its public UI flag, or replace SMTP with a deliberately reviewed sender. Remove Email imports/config validation/render/send callback from `server/utils/auth.ts`; omit the magicLink plugin when disabled. Never restore console magic-link URLs. Keep password-disabled OAuth/API auth and hashed magic-link token behavior if replacing the sender.
2. Remove `'@repo/nuxt-email'` from Nuxt modules, root workspace dependency, and `email` from `referenceApplication.enabledCapabilities`.
3. If retaining Notifications, remove its optional Email adapter/import from `server/notifications/delivery.ts` and `server/notifications/email-adapter.ts`; leave in-app records/Jobs and other channels intact. Remove `server/utils/observed-email.ts`, `scripts/email.ts`, `compose.email.yaml`, root `email:*` aliases and matching catalog script declarations. Remove SMTP/EMAIL env entries and any consumer-owned mail callers. Delete/adapt Email-specific tests; retain unrelated auth/API coverage.
4. Clear generated output, reinstall, run agents/capability checks and normal typecheck/build/tests/Playwright/container verification. No migration exists. Do not touch external SMTP accounts, DNS or remote credentials. The independent retained package/fixture remains available without activating infrastructure.
5. For permanent pruning, update catalog/docs first, then optionally remove `packages/nuxt-email`, `fixtures/email-consumer`, capability contract, `EMAIL_MODULE_EVALUATION.md` and `.agents/skills/email-change`. Retain the roadmap ID where other capabilities reference it.

When removing **Observability but retaining Email**, replace `sendObservedEmail` with package `sendEmail`, and command verification with `verifyEmailTransport`; remove only the telemetry wrapper. Keep SMTP/auth/canonical validation. Also retain plain Storage helpers as documented above.

## Remove Cache / Coordination

1. Stop application calls/subscriptions and await connection close. Close caller-owned `createCache` instances explicitly; `closeCache` closes/resets only the process singleton. Remove `'@repo/nuxt-cache'` from Nuxt modules, its root dependency and `cache-coordination` from reference enablement.
2. If retaining Realtime, remove Cache imports/subscription/publish composition from `server/realtime/application.ts` and retain only the local hub path. Remove `tests/unit/realtime-cache.test.ts`. Remove `server/utils/observed-cache.ts`, `server/plugins/cache.ts`, `scripts/cache.ts`, `scripts/cache-dev.ts`, Cache call sites and root `cache:*` aliases/catalog script declarations. Remove Cache-specific tests when pruning the reference integration.
3. Remove CACHE_URL/CACHE_KEY_PREFIX/CACHE_DEFAULT_TTL_SECONDS/CACHE_MAX_VALUE_BYTES from server config/environment and optional `compose.cache.yaml`. Stop only `starter-cache-dev` via its helper before removing helpers; local data is disposable. Retain fixture-owned assets if keeping independent package tests.
4. Clear generated `.nuxt`/`.output`, reinstall and run catalog/typecheck/build/normal verification. The generic fixture proves redis-owned dependencies disappear when unused. No persistent data migration exists. **Never issue FLUSH against external Cache as part of removal.**

When removing Observability but retaining Cache, replace the optional wrapper with plain `createCache()`/`getCache()` and remove telemetry initialization/shutdown from the CLI; preserve the independent cache API/config/helpers. Permanent pruning consistently updates catalog/docs before deleting package, fixture, contract, evaluation and skill; retain the roadmap ID for optional relationships.

## Fresh versus deployed removal

| Situation | Application code | Migration history and data |
| --- | --- | --- |
| Fresh, never deployed, disposable databases only | Remove capability integration before product work | Migration history may be regenerated coherently and verified on an empty database; never edit only one history file |
| Already deployed or shared | Remove runtime integration after draining/revoking as appropriate | Preserve historical migrations and data by default; use a new explicit reviewed migration for intentional destruction |

After either path, `bun run capabilities:status` should report whether the capability remains enabled in the root application. If package source is retained for future reuse, “package source present: yes” and “enabled in reference app: no” is the expected result.

## Remove Webhooks

1. Drain or deliberately cancel application webhook delivery work. Remove `'@repo/nuxt-webhooks'` from Nuxt modules, its workspace dependency and `webhooks` from referenceApplication enabled metadata.
2. Remove `server/webhooks/registry.ts` and its import/definition from `server/jobs/registry.ts`. Remove application webhook route/config/calls if added. Keep Jobs, `starter.echo`, the existing worker and migration roles.
3. Remove `scripts/webhooks-smoke.ts`, root `webhooks:smoke` alias/catalog script declaration and Webhooks-only tests; remove the test-only `standardwebhooks` dependency if no retained tests use it. Adjust the expected Jobs registry names in its test.
4. Clear generated Nuxt state, reinstall, then run capability checks, Jobs fixture, normal checks and the production worker path. Keep generic Jobs schema/history and external webhook endpoints untouched.

For permanent pruning, consistently update catalog/docs before removing `packages/nuxt-webhooks`, `fixtures/webhooks-consumer`, its contract/evaluation and skill. Preserve its roadmap ID where planned business integrations reference it. Remove Webhooks first before removing its hard Jobs dependency.

## Remove Audit Log

1. Remove the Nuxt module, root dependency and `audit-log` from referenceApplication.enabledCapabilities.
2. Remove appendAuditEvent imports/calls and actor parameters from Project services; restore plain domain writes or retain transactions as appropriate. Remove the machine actor argument in the v1 creation route. Remove Audit-specific root integration tests.
3. Remove the package schema import/export and schema object entry. Preserve `0002_audit-log.sql`, migration journal/snapshots and existing audit table/history. Retain a local table definition if subsequent schema generation would otherwise propose a drop. Never apply an incidental generated drop.
4. Reinstall, clear generated state, run capabilities:check, typecheck/build, ordinary checks and the production migration/container smoke. No worker or daemon needs draining.

A deployed table drop requires a new explicit destructive migration and a deliberate retention/privacy decision. For permanent pruning, update the catalog/roadmap/docs and remove package, fixture, contract, evaluation and audit-log-change skill only after all imports are gone; preserve the roadmap ID for optional relationships.

## Remove Realtime

1. Close active transports/hubs and stop application event producers. Remove the module, root dependency and `realtime` from reference enablement.
2. Remove `server/api/realtime`, `server/realtime/application.ts`, `server/plugins/realtime.ts`, `server/utils/observed-realtime.ts` and Realtime-only tests. Remove the optional hint import/call from `server/notifications/create.ts`; keep notification commit/enqueue unchanged. Remove realtime assertions from shared E2E while retaining Notifications ownership checks.
3. Remove REALTIME_TRANSPORTS from server environment/Compose. Reinstall/clear generated output and verify the remaining packages/app/worker. Module shutdown/experimental WebSocket configuration leaves with module enablement; no migration or data deletion. Retain independently selected Cache/Notifications/Observability.
4. Permanent pruning updates catalog/docs before removing package/fixture/contract/evaluation/skill, retaining roadmap IDs referenced by optional integrations.

## Remove Notifications

1. Stop notification producers and drain/stop `notifications.deliver` work. Remove module/dependency and `notifications` from reference enablement, retaining Jobs and other independently selected capabilities.
2. Remove `server/api/notifications`, `server/notifications`, `server/plugins/notifications.ts`, `server/utils/observed-notifications.ts`, the notification delivery import/definition from `server/jobs/registry.ts`, and delivery-database shutdown from `scripts/jobs-worker.ts`. Preserve the existing worker lifecycle/other tasks. Remove notification-specific tests and replace its Realtime event/schema/callers if retaining Realtime for other application events.
3. Remove package schema import/export/object entry from `server/database/schema.ts`; preserve notification table/data and applied `0004_notifications.sql`, journal/snapshots. Retain an equivalent application-owned table definition for future schema generation so removal cannot accidentally propose/apply DROP TABLE.
4. Remove NTFY settings and unused worker Email settings from Compose/environment only when no retained integration uses them. Reinstall/clear generated output, run catalog checks, Jobs/retained fixtures, full checks and production migration/app/worker. Never delete remote ntfy resources.
5. `bun run packages:test notifications` retains its disposable database through final rebuild and proves notification rows, indexes, migration history and Jobs survive packed removal. Permanent pruning updates all metadata/docs before package/fixture/contract/evaluation/skill deletion; preserve roadmap ID references.

When removing **Observability while retaining Realtime/Notifications**, remove only their observed wrappers and wrapper imports/calls. Keep plain event publication, transactional notification operations and adapters. These are optional application integrations, not hard dependencies.

## Remove Search

1. Remove the Projects search route and searchProjects service imports/function, Search module entry and dependency, and `search` reference enablement. Remove Search tests if pruning its reference integration.
2. Preserve application rows, generated vector/index declarations and committed migration history. The schema declaration does not depend on the package. Package removal applies no SQL; physical removal requires a new explicit reviewed migration.
3. Reinstall, clear generated Nuxt output, and run catalog/typecheck/build checks. Permanent pruning updates metadata/docs before deleting package/fixture/evaluation/skill; preserve the roadmap ID for optional relationships.

## Remove AI

1. Remove `@repo/nuxt-ai` module/dependency and `ai` from reference enablement. Cancel/drain active consumer streams.
2. Remove `server/utils/observed-ai.ts`, `scripts/ai-smoke.ts`, `ai:smoke` alias/catalog script declaration, AI-specific tests and all application AI call sites. Remove AI_PROVIDER/AI_MODEL/AI_API_KEY/AI_BASE_URL/AI_TIMEOUT_SECONDS config/environment, including Compose/example entries.
3. Clear generated output, reinstall and run catalog checks, normal typecheck/build/tests and production verification. No schema/data migration exists. The packed fixture proves provider SDK removal when unused; shared Zod may remain.

Never delete/revoke external provider accounts or secrets automatically. Removing Observability while retaining AI replaces the optional wrapper with plain package generation. Permanent pruning updates catalog/docs before removing package/fixture/contract/evaluation/ai-change skill, retaining the roadmap ID where referenced.

## Remove Import / Export

Stop transfer producers and drain or preserve pending work before unregistering `transferService.runJob` from `server/jobs/registry.ts`. Remove `server/api/transfers`, `server/transfers`, `scripts/transfers.ts`, the two transfers scripts, `ProjectTransfers.vue` and its Projects-page use, and the transfer resource shutdown hook. Remove the package root dependency/module; keep Jobs/Storage and their data. Remove the transfer schema export only if generation is no longer needed; retain applied migration0006, its immutable history, transfer tables/receipts and source/output objects. Never drop retained data or delete buckets as code removal. Operator `transfers:purge <selected-uuid...>` is dry-run; explicit `--execute` is separate physical cleanup, retaining history/domain data. Rebuild/typecheck/test after pruning. [Contract](../capabilities/import-export/CAPABILITY.md).
