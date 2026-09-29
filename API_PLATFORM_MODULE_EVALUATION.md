# API Platform module evaluation (September 2026)

## Selected stack and package boundary

The capability is the private publish-shaped workspace package `@repo/nuxt-api` under `packages/nuxt-api`. The `@repo/*` scope is repository-local and intentionally says nothing about a future npm scope. It targets Nuxt 4.5.2/Nitro 2.13.4, Better Auth 1.7.6, `@better-auth/api-key` 1.7.6, Zod 4.6.5, `zod-openapi` 6.0.2, and `@scalar/nuxt` 0.6.75. Nuxt module builder emits the package root module and its server-only public API. `fixtures/api-consumer` consumes a packed tarball the same way a future external application will.

The package is explicitly enabled through Nuxt's normal modules array. Source presence does nothing. It has no Jobs dependency and no `moduleDependencies` entry because Better Auth, PostgreSQL/Drizzle, and Nitro are starter baseline requirements rather than reusable Nuxt capability modules.

## Better Auth and machine credentials

The official API-key plugin was selected instead of a custom credential implementation. It already provides cryptographically generated keys, hash-at-rest storage, safe prefix/start identity, expiry, permissions, metadata, enable/disable, verification, last-use fields, and per-key database-backed rate limiting. The wrapper fixes the security-sensitive contract to the `X-API-Key` header, hashing enabled, database storage, user references, and `enableSessionForAPIKeys: false`. Shared v1 defaults are no expiry, a 64-character generated secret, `app_` prefix, and 1,000 requests per 60 seconds. Rate and presentation defaults can be overridden through the typed helper without weakening the fixed security invariants; no cache service is introduced.

The existing Better Auth instance remains application-owned. The package exports the small typed `apiPlatformAuth()` helper, and a consumer deliberately puts it in the existing plugins tuple. It neither rewrites auth source nor creates a second instance. The root's GitHub social-provider path, optional generic OIDC plugin, hashed magic-link plugin, and SSR/database session behavior remain in the same configuration. Tests prove the optional plugin/provider composition, and the clean fixture proves a database session still resolves while an API key cannot resolve as a human session.

V1 credentials are user-owned PAT/API keys. Verification returns a package-owned `ApiPrincipal` discriminated as `type: 'user'`, containing only user ID, key ID, and permissions. Better Auth's user reference is used as the project owner. A true non-user service principal is not cleanly represented by that ownership model, so no fake user, parallel credential table, or pretend service-account type was added. Future Organizations or service-principal work can add a principal variant and explicit storage/ownership rules without changing route call sites.

## Schema and explicit migration

The package exports the Better Auth `apikey` Drizzle table shape. The application explicitly includes it in its own schema and commits `0001_api-platform.sql`; the migration adds only that table and indexes. Drizzle's generated `0001_snapshot.json` records the complete current schema so later generation stays incremental even though the original starter migration predates snapshots.

Normal Nitro startup, verification, and package installation never mutate schema. The existing one-shot application migration path applies the new SQL before runtime. Package removal deliberately leaves `apikey` and credential rows in place for rollback; destroying them requires a separate reviewed migration.

## Contracts, OpenAPI, and Scalar

Native Nitro route files remain the HTTP router. The package defines a small application-owned contract registry describing method, path, stable operation ID, summary/description, tags, Zod params/query/body, Zod responses, and required machine permissions. Routes import the same contract schemas for runtime request and response validation.

`zod-openapi` was selected because it consumes Zod 4 metadata directly and generates OpenAPI 3.1.1 without owning routing. Nitro's built-in OpenAPI generation was evaluated and deliberately not used because it remains experimental and would couple this package's public contract to internal route scanning. Explicit registration also prevents Better Auth, management, health, and other internal endpoints from leaking into the external specification.

The package's `/api/openapi.json` handler generates deterministic paths/tags, rejects duplicate operations and operation IDs, adds an accurate `X-API-Key` security scheme, emits `x-required-permissions`, and documents the small shared error envelope. Better Auth's optional OpenAPI plugin is not used as an application API source. The official Scalar Nuxt module renders the generated document at `/docs/api`; Scalar remains documentation UI, not a router.

## Public API and framework glue

The package root exports the Nuxt module. `@repo/nuxt-api/server` exports the auth helper, Drizzle table, principal type, contract/registry/OpenAPI helpers, and small request/response utilities. The Nuxt module contributes four server auto-imports, aliases the application-owned auth and contract modules, adds one Nitro OpenAPI handler, records non-secret API metadata in server runtime config, and installs Scalar. That is the entire framework-specific glue.

The root reference app owns everything domain-specific: Better Auth composition, schema/migration, project contracts, native routes, project service calls, human-session credential management endpoints, and `/app/api-keys` UI. The API routes reuse the existing owner-scoped project service; no second Projects implementation was created.

## Clean installation and removal

The completed catalog entry lets the existing generic package matrix build and pack the actual tarball, install it into `fixtures/api-consumer`, verify package-owned dependencies arrived, typecheck, and build. Its fixture-owned runtime hook applies the committed migration, creates real Better Auth keys, checks that the raw key is absent from PostgreSQL, and starts the production Nitro output.

The hook covers missing/invalid/revoked/expired credentials, read/write permission boundaries, 422 validation, 429 rate limits, last use, one-user project isolation, key-versus-session separation, an existing signed browser session, OpenAPI 3.1.1 contents, permission metadata, operation-ID uniqueness, internal-route exclusion, and Scalar availability. Generic orchestration then removes the package, consumer-owned API server files, and migration tooling from a temporary fixture copy, clears generated output and dependencies, reinstalls from the lockfile, confirms owned dependencies disappeared, and typechecks/builds the base Nuxt app. No API-specific root orchestrator or CI job was added.

Removal from a real application additionally removes the deliberate auth helper call and schema export. Credential data is retained unless an operator separately authorizes its destruction.

## Files outside the package

- `nuxt.config.ts` and `package.json` opt the root reference application into the package.
- `server/utils/auth.ts` deliberately composes the helper into the existing Better Auth instance.
- `server/database/schema.ts` plus `server/database/migrations/0001_api-platform.sql` add committed storage.
- `server/api-platform/`, `server/api/v1/`, and the existing `server/services/projects.ts` expose the application contract and native interface.
- `server/api/api-keys/`, `server/utils/api-keys.ts`, `app/pages/app/api-keys.vue`, and the app navigation provide human-session management.
- tests, capability metadata, roadmap, context, and the API-contract skill record and verify the contract.

No Jobs runtime, pg-boss migration, shadcn component source, SSR session mechanism, Pocket ID provisioner, Docker topology, or provider-specific infrastructure was redesigned.

## Optional integrations and rejected scope

Audit Log, Observability, Authorization, and Organizations remain optional catalog integrations. None is installed, required, or approximated. No Jobs integration, generated SDK, GraphQL, MCP endpoint, service-account model, Valkey/Redis service, alternate router, or provider-specific API gateway was added.

## Comparison with Jobs packaging

Jobs established the package/module/fixture boundary and the catalog-driven artifact lifecycle. API Platform reuses that convention unchanged and demonstrates why capability-local runtime hooks matter: Jobs owns a CLI, worker, and separate pg-boss schema, whereas API Platform owns no process or CLI and instead needs an application auth composition point, a Drizzle table, native routes, and HTTP/security checks. Both package their actual runtime dependencies, keep framework peers with the consumer, use explicit migrations, and prove generated-state-free removal. The second package required only a catalog row and fixture, not another orchestration script or CI block.

## Before publication

Choose the permanent npm scope and release/versioning policy, add repository/license/provenance metadata, publish supported Nuxt/Node/Better Auth compatibility ranges, and test those ranges. Define semantic-versioning rules for the package server API separately from each application's `/api/v1` contract. Review API-key plugin schema/security release notes on every upgrade and document a migration path for any future organization or true service-principal ownership model. None of these publication steps requires an architectural rewrite.
