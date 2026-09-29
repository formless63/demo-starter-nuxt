# Using capabilities

## What is a capability?

The baseline starter always includes Nuxt/Nitro, strict TypeScript, Bun tooling, PostgreSQL and Drizzle, Better Auth, the UI stack, explicit migrations, Docker/Compose, testing/CI, and agent scaffolding.

A capability is an optional, independently maintained feature package layered onto that baseline. Package source existing under `packages/` does not activate anything. A consumer must keep the workspace dependency, register the Nuxt module, and perform the capability's documented application integration. Unused packages do not become modules, routes, workers, or runtime services merely because their source exists.

The root application deliberately enables every completed capability for continuous integration. That is separate from `defaultInstalled`: this field means “will a clean consumer/base application receive this capability without explicitly selecting or enabling it?” Both current capabilities answer no.

`@repo/*` is the private internal workspace scope. The packages are not published, so commands such as `bun add @repo/nuxt-jobs` will not work in an unrelated external repository. A real npm scope will be chosen deliberately if publication happens later.

## Capability status

| ID | Package | Reference app | Default installed | Hard capability dependencies | External | Contract |
| --- | --- | --- | --- | --- | --- | --- |
| `jobs` | `@repo/nuxt-jobs` | Enabled | No | None | PostgreSQL (required) | [Jobs](../capabilities/jobs/CAPABILITY.md) |
| `api-platform` | `@repo/nuxt-api` | Enabled | No | None | None | [API Platform](../capabilities/api-platform/CAPABILITY.md) |

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
