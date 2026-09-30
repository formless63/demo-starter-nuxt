# API Platform capability

User-owned machine credentials and explicit OpenAPI contracts implemented by the independently installable Nuxt package `@repo/nuxt-api`. `@repo/*` is an internal workspace scope, not a publication decision, and the package remains private. Implementation findings are in [`API_PLATFORM_MODULE_EVALUATION.md`](../../API_PLATFORM_MODULE_EVALUATION.md).

`defaultInstalled` is false: clean consumers do not receive API Platform without selecting it. The root reference application enables it deliberately for integration testing.

## Requirements

Requires:

- No other reusable capability.
- Baseline Nuxt/Nitro, Better Auth, PostgreSQL, and Drizzle.

Integrates with:

- Audit Log for credential and external-API activity.
- Observability for request and verification telemetry.
  The root uses an application-owned `defineObservedApiHandler` wrapper with registered operation IDs/method/status and safe exception capture. Machine keys/bodies are never logged; the existing API envelopes and 401/403/429 behavior remain authoritative. API Platform has no Observability package dependency.
- Authorization for future application-wide policy decisions.
- Organizations / Tenancy for future organization-owned credentials and scoping.

External:

- None beyond the starter's baseline PostgreSQL service.

The module has no hard dependency on Jobs or another Nuxt capability module and declares none.

## Adds

### Dependencies

- `@better-auth/api-key` 1.7.6 provides key generation, hashing, verification, expiry, permissions, metadata, revocation, last-use tracking, and per-key rate limits.
- `zod-openapi` 6.0.2 generates OpenAPI 3.1.1 from the same Zod 4 schemas used at runtime.
- `@scalar/nuxt` 0.6.75 renders the interactive API reference.
- Nuxt 4, Better Auth, Drizzle, and Zod are compatible peers supplied by the consumer. They are baseline libraries, not capability dependencies.

### Environment

- `DATABASE_URL`: PostgreSQL containing the application and Better Auth tables.
- `NUXT_AUTH_SECRET`: existing Better Auth secret, at least 32 characters.
- `NUXT_PUBLIC_APP_BASE_URL`: existing canonical Better Auth/application URL.

The package adds no client-visible credential configuration. API keys are accepted only through the `X-API-Key` header.

### Scripts

- `bun run db:migrate`: apply the consumer's reviewed Drizzle migrations, including `apikey`.
- `bun run packages:build api-platform`: build the publish-shaped module.
- `bun run packages:test api-platform`: pack/install the real artifact, run the fixture security/contract checks, remove it, and prove the remaining application still builds.

### Database/migrations

The consumer deliberately exports the package's `apikey` Drizzle table from its application schema and commits an incremental SQL migration. Nitro startup and API-key verification never mutate schema. Better Auth stores only the key hash plus safe prefix/start metadata; the raw secret exists only in the create response.

Removing the package does not drop `apikey`. Keep credential rows for rollback, or remove them through a separately reviewed destructive migration after deciding that rollback and existing credentials are no longer needed.

### Runtime processes

No additional process is required. Credential verification, OpenAPI JSON, Scalar docs, and native application routes run in the existing Nitro application.

### Compose/infrastructure

No service is added. The existing application image contains the explicitly enabled module, and the existing one-shot application migration job applies its committed migration. PostgreSQL remains the only infrastructure requirement.

## Application API

The package root is the Nuxt module. `@repo/nuxt-api/server` exports:

- `apiPlatformAuth()` for deliberate addition to the application's single Better Auth plugin list;
- the `apikey` Drizzle table;
- `ApiPrincipal`, contract/registry helpers, OpenAPI generation, and small runtime request/response helpers.

After module opt-in, Nitro auto-imports `requireApiKey`, `defineApiHandler`, `readApiBody`, and `parseApiResponse`. An external route remains an ordinary Nitro route:

```ts
export default defineApiHandler(async (event) => {
  const principal = await requireApiKey(event, { projects: ['read'] })
  return listProjects(useDb(), principal.userId)
})
```

`ApiPrincipal` is currently `{ type: 'user', userId, keyId, permissions }`. V1 keys are user-owned PAT/API keys; a fake service principal is deliberately not modeled. Organization or true service-principal variants can extend this discriminated type later.

Contracts explicitly register only public `/api/v1/...` operations. Native Nitro files remain authoritative handlers, while shared Zod schemas drive request parsing, response validation, and OpenAPI 3.1.1. `/api/openapi.json` exposes the deterministic document and `/docs/api` exposes Scalar. Better Auth routes, management routes, and other internal Nitro routes are absent unless deliberately registered.

The reference app demonstrates `GET /api/v1/projects` with `projects.read` and `POST /api/v1/projects` with `projects.write`. Both reuse the existing project service and scope all data by the key owner's user ID. Errors use `{ "error": { "code", "message" } }` for 400, 401, 403, 404, 422, 429, and 500 responses without stack details.

Human-session management at `/app/api-keys` creates named keys with selected project permissions and optional expiry, reveals the new secret once, lists only safe metadata, and supports revoke/delete. Rotation is create replacement, save its one-time secret, then explicitly revoke the old key. API keys cannot create a browser session and cannot reach management as a human user.

The shared v1 defaults are `X-API-Key`, hashing enabled, user ownership, no default expiry, a 64-character generated secret, `app_` prefix, 1,000 requests per 60 seconds, and `enableSessionForAPIKeys: false`. The demonstrated permissions are `projects.read` and `projects.write`. The typed helper permits non-security-weakening customization where the package API supports it; hashing, header-only credentials, database storage, user references, and browser-session separation remain fixed.

## Installation

1. Add the private workspace package `@repo/nuxt-api` to a compatible Nuxt 4 application with `workspace:*`. It is not currently resolvable from npm; choose a real scope before publishing it.
2. Add `'@repo/nuxt-api'` to `nuxt.config.ts` and configure the application-owned auth and contract-registry paths if they differ from the defaults.
3. Add `apiPlatformAuth()` to the existing Better Auth instance; do not create a second instance.
4. Export `apikey` from the application Drizzle schema, generate/review a committed incremental migration, and apply it explicitly.
5. Define an explicit application contract registry and native `/api/v1` Nitro routes using shared Zod schemas.
6. Add authenticated human-session management endpoints/UI only if the consumer needs user-managed keys.
7. Configure API metadata and verify `/api/openapi.json` and `/docs/api`.

`fixtures/api-consumer` is the minimal external-style example. The module never rewrites consumer auth, schema, routes, scripts, Docker, or CI.

## Removal

1. Revoke keys if external access must end immediately.
2. Remove the module from `nuxt.config.ts`, remove `apiPlatformAuth()` from Better Auth, and remove the package dependency.
3. Remove package-specific API routes, contract registry, management endpoints/UI, and schema export.
   Remove `server/utils/observed-api.ts` with the routes; Observability remains independently usable.
4. Clear generated Nuxt state, reinstall, and typecheck/build so stale auto-imports cannot hide a dependency.
5. Retain the `apikey` table for rollback by default. Drop it only with an explicit reviewed migration when credential destruction is intended.

The catalog-driven package test executes this removal contract in a clean consumer and verifies package-owned dependencies disappear while retained database data is never automatically touched.

## Upgrade considerations

- Review Better Auth and `@better-auth/api-key` migration/security notes together and regenerate the application migration if the plugin schema changes.
- Preserve `disableKeyHashing: false`, `enableSessionForAPIKeys: false`, header-only credentials, user ownership, and explicit migration behavior.
- Treat permission names, public paths, request/response schemas, operation IDs, and error codes as versioned external contracts.
- Rebuild the packed artifact and rerun key hashing, revoked/expired key, permission, rate-limit, session-isolation, owner-isolation, OpenAPI, docs, and removal checks.
- Before adding Organizations or Authorization integration, keep it optional and update the principal variant deliberately; do not silently add a hard dependency.

## Verification

```sh
bun run capabilities:check
bun run packages:build api-platform
bun run packages:test api-platform
bun run db:migrate
bun run test
bun run check
bun run test:e2e
```

The fixture runtime hook proves migration, key create/verify, hash-at-rest, missing/invalid/revoked/expired behavior, read/write permissions, 429 rate limiting, last-use tracking, owner isolation, browser-session separation, existing Better Auth session behavior, OpenAPI contents, and Scalar availability. Generic orchestration proves tarball installation, owned dependency arrival/removal, typecheck/build, generated-state cleanup, and post-removal build.

## Agent guidance

Use `.agents/skills/capability-change/SKILL.md`, `.agents/skills/auth-change/SKILL.md`, and `.agents/skills/api-contract-change/SKILL.md` for changes to this capability. Use the database-migration workflow when its schema changes. Keep native Nitro routes authoritative, Zod runtime behavior aligned with OpenAPI, operation IDs stable and unique, permissions security-sensitive, raw credentials absent from storage/logs/list responses, and API keys unable to become browser sessions.
