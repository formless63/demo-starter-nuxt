# Using capabilities

## What is a capability?

The baseline starter always includes Nuxt/Nitro, strict TypeScript, Bun tooling, PostgreSQL and Drizzle, Better Auth, the UI stack, explicit migrations, Docker/Compose, testing/CI, and agent scaffolding.

A capability is an optional, independently maintained feature package layered onto that baseline. Package source existing under `packages/` does not activate anything. A consumer must keep the workspace dependency, register the Nuxt module, and perform the capability's documented application integration. Unused packages do not become modules, routes, workers, or runtime services merely because their source exists.

The root application deliberately enables every completed capability for continuous integration, recorded in `referenceApplication.enabledCapabilities`. That is separate from `defaultInstalled`: this field means “will a clean consumer/base application receive this capability without explicitly selecting or enabling it?” All current capabilities answer no.

`@repo/*` is the private internal workspace scope. The packages are not published, so commands such as `bun add @repo/nuxt-jobs` will not work in an unrelated external repository. A real npm scope will be chosen deliberately if publication happens later.

## Capability status

| ID | Package | Reference app | Default installed | Hard capability dependencies | External | Contract |
| --- | --- | --- | --- | --- | --- | --- |
| `jobs` | `@repo/nuxt-jobs` | Enabled | No | None | PostgreSQL (required) | [Jobs](../capabilities/jobs/CAPABILITY.md) |
| `api-platform` | `@repo/nuxt-api` | Enabled | No | None | None | [API Platform](../capabilities/api-platform/CAPABILITY.md) |
| `observability` | `@repo/nuxt-observability` | Enabled | No | None | OTLP destination (optional) | [Observability](../capabilities/observability/CAPABILITY.md) |
| `object-storage` | `@repo/nuxt-storage` | Enabled | No | None | S3-compatible service when used | [Object Storage](../capabilities/object-storage/CAPABILITY.md) |
| `email` | `@repo/nuxt-email` | Enabled | No | None | SMTP on use; Mailpit optional | [Email](../capabilities/email/CAPABILITY.md) |

Run `bun run capabilities:status` for the catalog-derived status of completed and planned capabilities and their current root-reference enablement.

## Adding or enabling a capability

For a clone or downstream fork that retains the package source:

1. Keep or add the package as a `workspace:*` dependency in the consuming application's `package.json`.
2. Add the package name to `modules` in `nuxt.config.ts`.
3. Complete the consumer-owned integration described by its `CAPABILITY.md`.
4. Review and run any explicit database migrations.
5. Run the capability package test and normal repository verification.

### Jobs

Keep `"@repo/nuxt-jobs": "workspace:*"`, add `'@repo/nuxt-jobs'` to the Nuxt modules array, and define the application registry/tasks under `server/jobs/` using `@repo/nuxt-jobs/server`. Add the `nuxt-jobs` command aliases and a worker deployment role only when the application needs them. Apply `bun run jobs:migrate`, run `bun run jobs:doctor`, and verify with `bun run packages:test jobs`. See the [Jobs contract](../capabilities/jobs/CAPABILITY.md).

### API Platform

Keep `"@repo/nuxt-api": "workspace:*"`, add `'@repo/nuxt-api'` to the Nuxt modules array, compose `apiPlatformAuth()` from `@repo/nuxt-api/server` into the application's single Better Auth instance, export the package's `apikey` table from the application schema, and commit/apply a reviewed migration. Add an application-owned contract registry and native Nitro `/api/v1` routes. Key-management routes/UI are consumer features, not hidden module side effects. Verify with `bun run packages:test api-platform`. See the [API Platform contract](../capabilities/api-platform/CAPABILITY.md).

The current API defaults are `X-API-Key`, hashing enabled, user-owned keys, no default expiry, a 64-character generated secret, `app_` prefix, 1,000 requests per 60 seconds, no browser sessions from API keys, `projects.read`/`projects.write`, OpenAPI 3.1.1 at `/api/openapi.json`, and Scalar at `/docs/api`.

### Observability

Keep `@repo/nuxt-observability: workspace:*` and explicitly register its Nuxt module. JSON logs, request IDs, local span correlation and safe build metadata work with no backend. Set `OTEL_EXPORTER_OTLP_ENDPOINT` only for an optional OTLP/HTTP JSON destination, with independent trace/metric `otlp`/`none` selection. Request bodies, raw headers/query, job payloads and auth objects are omitted; extend `redactKeys` and use deliberate safe free text/attributes. v1 is server-only. Jobs/API wrappers are optional consumer-owned integrations, not dependencies. See the [contract](../capabilities/observability/CAPABILITY.md) for the complete configuration/safe uncaught-error/shutdown model and fixture proof.

Removal restores ordinary Jobs handlers/API handlers and baseline health output, removes module/dependency/env configuration, then clears generated state and rebuilds. There is no schema to drop. [Starting a project](STARTING-A-PROJECT.md#remove-observability) lists the root-specific files.

### Object Storage

Keep `@repo/nuxt-storage: workspace:*` and explicitly register the module. Installation/build/startup need no backend. When used, supply an existing private bucket and server-only S3 configuration; absent static credentials preserves the AWS default chain. Region resolves `STORAGE_REGION` → `AWS_REGION` → `AWS_DEFAULT_REGION` → safe configuration error on use, not build/boot. Root `storage:dev:rustfs` / `storage:dev:garage` explicitly bootstrap local-only RustFS 1.0.0 / Garage 2.4.1 with explicit regions. `storage:check` is read-only; `storage:smoke` uses package-owned unique-key cleanup. The same packed fixture verifies real RustFS/Garage object/signing/multipart contracts and post-removal builds, independently of Jobs/API/Observability. Optional third-party Noooste Garage UI v0.13.0 is localhost-bound operator tooling, not official Garage or needed for S3; privileged admin credentials never belong in application browser code or normal S3 clients. Known development credentials are local-only. See the [shared defaults](../OBJECT_STORAGE_MODULE_EVALUATION.md#shared-cross-framework-baseline).

Authorization, files records and UI remain app-owned. The optional root operation runner instruments bounded operation/outcome/duration/known bytes without keys or signed URLs; Storage has no Observability dependency. Removal means code/config removal, **not deleting remote objects/buckets or revoking credentials**. See the [contract](../capabilities/object-storage/CAPABILITY.md) and [root removal recipe](STARTING-A-PROJECT.md#remove-object-storage).

### Email

Keep `@repo/nuxt-email` and register its Nuxt module explicitly. SMTP config is server-only and lazy; enable magic links only with structural SMTP configuration and canonical app URL. `email:check` verifies without sending; `email:smoke [recipient]` intentionally sends once. Mailpit is an optional local sink. No DB/Jobs/Observability dependencies, queues or SMTP health requirement. See [Email contract](../capabilities/email/CAPABILITY.md) and [removal](STARTING-A-PROJECT.md#remove-email).

## Disabling, removing, and pruning

These are different operations:

### Disable

Stop registering or using the capability in the application. The private package source and capability metadata can remain in the repository for later reuse. Remove runtime services such as the Jobs worker when they are no longer used.

### Remove from the application

Remove the Nuxt module registration, root workspace dependency, and consumer-owned integrations listed in the capability contract. Clear generated Nuxt state, reinstall, and typecheck/build so stale generated types cannot hide a dependency. Preserve database data and migration history by default; application removal does not authorize dropping tables or schemas.

### Prune from a downstream fork

After application removal, a fork that will not develop or reuse the capability may delete its `packages/nuxt-<capability>/` source, consumer fixture, capability contract, evaluation document, and capability-specific skill/testing metadata.

Do not leave the catalog pointing at deleted files. The least disruptive roadmap-preserving change is to set the catalog entry back to `planned` and remove its implemented-only fields: scripts, environment variables, migrations, runtime processes, documentation/evaluation/skill paths, package name/path, fixture path, and package-test configuration. Update `ROADMAP.md`, this guide, and `docs/STARTING-A-PROJECT.md` in the same change. Keep the capability ID if other planned capabilities still reference it; deleting the entry requires updating every `requires` and `integratesWith` reference. Run `bun run capabilities:check` afterward.

Never delete an already-applied migration or automatically drop PostgreSQL data merely to make a fork look clean. Database destruction requires a separate, reviewed decision.

## Dependency handling

- **Requires** is a hard dependency on another capability. Webhooks will require Jobs; File UI will require Object Storage.
- **Integrates with** is an optional enhancement. Email can integrate with Jobs without requiring it, so Email's core remains usable without Jobs.
- **External** is infrastructure or a remote service outside the capability catalog, such as PostgreSQL, SMTP, or S3-compatible storage.

Baseline features such as authentication and Drizzle are recorded separately rather than invented as module dependencies. Hard dependencies must remain explicit, sparse, and acyclic.

## Verification after capability changes

```sh
bun run capabilities:check
bun run packages:test <id>
bun run check
```

Package tests build and pack the real artifact, install it into an external-style fixture, exercise capability-owned runtime checks, remove it, clear generated state, and prove the remaining fixture still typechecks and builds. They validate package-level removal without acting as a source-rewriting uninstaller.
