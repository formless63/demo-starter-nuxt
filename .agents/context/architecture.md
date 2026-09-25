# Architecture

Nuxt's `app/` owns Vue pages, layouts, components, middleware, and browser-safe composables. `server/` owns Nitro routes, authentication, authorization, and PostgreSQL access; never import Vue/app code there. `shared/` is reserved for runtime-neutral types and validation.

A page uses `useFetch`/`$fetch` to call `/api`. Each protected server handler calls `requireUser(event)` before reading data and includes `ownerId` in every resource query, update, and delete. Direct Drizzle queries are preferred over an empty repository abstraction. Errors use h3 status errors.

Better Auth owns `/api/auth/**`: OAuth establishes an account, user, and database session. Pages, layouts, and route middleware call `authClient.useSession(useFetch)` so Nuxt forwards incoming cookies during SSR and reuses the payload during hydration. `useAuth` is reserved for request-scoped SSR actions. Middleware is not an authorization boundary—the server session and owner predicate are. GitHub and generic OIDC are independent optional providers; passwords are disabled.

- `app/pages`: routes and page-level fetching
- `app/components`: reusable presentation
- `app/composables`: client integration/state
- `server/api`: HTTP boundary
- `server/utils`: focused server helpers
- `server/database`: Drizzle schema and immutable migrations
- `tests`: unit/integration and Playwright smoke tests

For cross-layer features, validate at the HTTP edge, keep client/server types serializable, enforce authorization in SQL predicates, and add migrations rather than schema push.
