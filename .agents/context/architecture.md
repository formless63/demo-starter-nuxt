# Architecture

Nuxt's `app/` owns Vue pages, layouts, components, middleware, and browser-safe composables. `server/` owns Nitro routes, authentication, authorization, and PostgreSQL access; never import Vue/app code there. `shared/` is reserved for runtime-neutral types and validation.

A page uses `useFetch`/`$fetch` to call `/api`. Each protected server handler calls `requireUser(event)` before reading data and includes `ownerId` in every resource query, update, and delete. Direct Drizzle queries are preferred over an empty repository abstraction. Errors use h3 status errors.

Better Auth owns `/api/auth/**`: OAuth establishes an account, user, and database session. Pages, layouts, and route middleware call `authClient.useSession(useFetch)` so Nuxt forwards incoming cookies during SSR and reuses the payload during hydration. `useAuth` is reserved for request-scoped SSR actions. Middleware is not an authorization boundary—the server session and owner predicate are. GitHub and generic OIDC are independent optional providers; passwords are disabled.

External machine routes live under `/api/v1/**` and remain native Nitro handlers. `@repo/nuxt-api` supplies user-owned Better Auth API keys, a typed machine principal, permission enforcement, and an explicit Zod contract registry; it does not create a second auth instance or router. Contracts generate only deliberately registered OpenAPI 3.1.1 operations at `/api/openapi.json`, with Scalar at `/docs/api`. API keys use `X-API-Key`, never become browser sessions, and scope project access through the same owner-aware services as browser routes.

- `app/pages`: routes and page-level fetching
- `app/components`: reusable presentation
- `app/composables`: client integration/state
- `server/api`: HTTP boundary
- `server/utils`: focused server helpers
- `server/database`: Drizzle schema and immutable migrations
- `packages/nuxt-*`: independently installable capability packages; source presence never activates them
- `packages/nuxt-jobs`: Jobs Nuxt module, server-only pg-boss runtime, public API, and CLI
- `packages/nuxt-api`: API Platform Nuxt module, Better Auth integration helper, server API, schema, and contract/OpenAPI runtime
- `server/jobs`: application-owned job registry and handlers shared by Nitro and the worker
- `fixtures/jobs-consumer`: minimal external-style Jobs package consumer and removal fixture
- `server/api-platform`: application-owned external API contracts and serializers
- `fixtures/api-consumer`: minimal external-style API package consumer, security/runtime check, and removal fixture
- `tests`: unit/integration and Playwright smoke tests

For cross-layer features, validate at the HTTP edge, keep client/server types serializable, enforce authorization in SQL predicates, and add migrations rather than schema push.

The base starter, optional capability packages, and fixture applications are separate concerns. `defaultInstalled` means a clean consumer receives a capability without selecting it; it does not mean enabled in the reference app. The root reference app explicitly enables both completed packages in `nuxt.config.ts` for integration testing. Future packages follow Nuxt's native module model and own their dependencies; do not put optional capabilities in root `modules/`, where local discovery would activate them automatically, and do not add a custom capability loader. Completed package/fixture pairs are discovered from `capabilities/catalog.json` by generic build/test preparation tooling and CI. Capability-specific runtime verification belongs to an optional fixture script, not root orchestration. `@repo/*` is only the private internal workspace scope; choose a deliberate public scope before publishing.

The production Docker image contains Nitro's portable Node output plus bundled application migration and jobs entrypoints. Compose uses that same tagged image for the one-shot `migrate` service and long-running `app` and `worker` services. Operators run application migrations—including optional capability tables such as `apikey`—and pg-boss migrations explicitly before starting or updating runtime services; application and worker startup never change schema. Runtime jobs use `migrate: false`, validate payloads at execution, and use pg-boss's Drizzle adapter when enqueueing must commit atomically with application writes. Services depend on healthy PostgreSQL, and `/api/health` is the application readiness contract.
