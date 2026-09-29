# Jobs module evaluation (September 2026)

## Chosen package layout

Jobs now lives at `packages/nuxt-jobs` as the private workspace package `@wicaso/nuxt-jobs`. `src/module.ts` is the Nuxt Kit entry, `src/runtime/server/` owns the server-only pg-boss implementation and the public `/server` API, and `src/cli/` owns the `nuxt-jobs` executable. The official Nuxt module builder emits the publish-shaped module, declarations, runtime, and CLI artifacts.

The root remains the feature-complete reference application. It depends on and explicitly enables the package, while `server/jobs/` remains application-owned. `fixtures/jobs-consumer` is a minimal independent Nuxt application that consumes the same package entrypoint an external application will use. The catalog declares this package/fixture pair and its test contract. The package stays `private` until an intentional npm release.

This is the least invasive maintainable move from the proven prototype: queue, migration, transaction, validation, and shutdown behavior are unchanged. Only repository-relative package internals became public package imports.

## Why this scales

Future capabilities can use sibling packages such as `packages/nuxt-api`, `packages/nuxt-observability`, and `packages/nuxt-storage`, each with its own dependencies, runtime, commands if needed, and fixture. Package presence does not activate a capability. A consumer must install the package and name it in Nuxt's `modules` array, so adding packages to this repository cannot silently enable them in generated applications.

Nuxt remains the integration model. There is no capability loader, manifest interpreter, source rewriter, or custom package manager. The catalog is architecture metadata, not an installer.

Root orchestration is intentionally generic. `scripts/packages.ts` discovers completed package-backed capabilities from `capabilities/catalog.json`; it prepares only packages referenced by the root application, builds named packages, emits the CI matrix, and runs the common packed-artifact lifecycle. Capability-specific behavior stays in the fixture: Jobs supplies `package:test:runtime` for registry, migration, doctor, worker, and queue checks. This gives future packages a shared release-shaped test without forcing them to imitate Jobs runtime behavior.

## Rejected alternatives

- **Keep every capability under root `modules/`:** Nuxt auto-discovers local modules there, which becomes surprising with dozens of optional capabilities and does not exercise a publishable boundary.
- **One large feature-flagged module:** this would ship unrelated dependencies and couple install and release concerns.
- **A proprietary installer or script rewriter:** it duplicates package-manager/Nuxt responsibilities and makes removal fragile.
- **Nuxt layers as the primary boundary:** layers suit template/application composition; Jobs is server runtime/package behavior and fits a normal module directly.
- **Separate repositories now:** that adds release coordination before APIs stabilize. This package can split later without changing consumer imports.
- **Consumer-owned command copies:** these drift. The package CLI is canonical; thin root adapters remain only to bundle the reference registry into the existing lean production image.
- **One root test script or CI block per package:** this would duplicate artifact lifecycle code and make every new capability edit CI. The catalog-driven matrix owns common mechanics instead.
- **A universal runtime smoke contract:** capabilities need different services and assertions. A fixture-owned optional runtime script keeps those checks deep without coupling unrelated packages.

## Dependency and command contract

`pg-boss` 12.35.0 is a direct package dependency, so it arrives with Jobs. Nuxt, Drizzle, and Zod are peers because the module integrates with consumer framework, transaction, and schema types. No other reusable capability is required.

The package root is the Nuxt module and `@wicaso/nuxt-jobs/server` is the typed application/worker API. The package exposes `nuxt-jobs worker`, `migrate`, `doctor`, and `smoke`. Registry commands accept `--registry`; smoke also requires `--job` and a JSON `--payload`, so the package assumes no application task name or schema. Consumer scripts may alias the bin, but the module never rewrites them. Nuxt Kit still owns runtime configuration, server imports, the registry alias, and shutdown cleanup; browser bundles receive no pg-boss code.

## Clean consumer proof

`bun run packages:test jobs` builds and packs the actual artifact, installs it into a fresh copy of `fixtures/jobs-consumer`, checks that pg-boss arrived, and runs strict typecheck/build. The fixture-owned runtime hook loads the application registry, migrates and diagnoses a unique schema, starts and gracefully stops the standalone worker, and executes a queued smoke job. Generic orchestration then removes the package and catalog-declared consumer-owned Jobs files, clears generated Nuxt state, verifies package-owned dependencies are gone, and typechecks/builds the remaining app.

This is a verification harness, not an installer. It proves the documented install/removal contract has no hidden root imports or generated-type residue.

## Production and removal

The existing `compose.yaml` was extended instead of adding `compose.jobs.yaml`. A single file makes the normal production-like stack and CI invocation unambiguous, while the `worker` remains opt-in in practice because `docker compose up -d postgres` still names and starts only PostgreSQL. The tradeoff is that removal touches the shared Compose file rather than deleting one additive file.

The production image bundles Nitro, the application migrator, and all jobs entrypoints once. The one-shot `migrate` service applies application migrations, applies supported pg-boss migrations, then runs the pg-boss doctor. `app` and `worker` use that exact image revision. Every long-running pg-boss instance sets `migrate: false`; a failed explicit migration/doctor command blocks release startup.

Removal now means removing the package from the Nuxt modules array and dependencies, then removing the consumer-owned registry/tasks, aliases, deployment roles, tests, and docs. The application schema remains independent. The `pgboss` schema may be retained for rollback or dropped explicitly after queued work is no longer needed.

## Findings and publication boundary

Framework-specific glue remains small: one module entry, one consumer-registry alias, two Nitro server imports, and one shutdown plugin. The official pg-boss Drizzle adapter keeps an application mutation and enqueue in one PostgreSQL transaction.

The module builder produces normal ESM and declarations for both workspace consumption and the tarball build. Bun still emits the reference application's Node-targeted worker/tool adapters for the non-root production image. pg-boss owns its separate schema and migration lifecycle; keeping migration authority out of startup remains a mandatory, explicit release step. LISTEN/NOTIFY stays off by default for pooler portability.

No dashboard was added. A later optional module/profile could add one, but it should not introduce Hono, Fastify, or Express into this starter merely to mount UI.

Before publishing, choose the permanent npm scope, add license/repository/release metadata, test a supported Nuxt/Node version matrix, and define a release/versioning policy. None requires moving runtime code or changing consumer integration.
