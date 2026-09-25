# Nuxt full-stack starter

A deliberately small but production-sensible Nuxt 4 evaluation repository. It combines a portable Nitro application, OAuth-only authentication, PostgreSQL, and owner-scoped Projects CRUD without a second API framework or client cache.

## Stack and prerequisites

Nuxt 4 / Vue 3, strict TypeScript, Better Auth, Drizzle/PostgreSQL 18, Tailwind CSS 4 with an initialized shadcn-vue component layer, Reka UI, Tabler Icons, vue-sonner, Vitest, and Playwright. Install **Node 24**, **Bun 1.4.2**, and Docker with Compose. Versions are pinned; see `.agents/context/stack.md`.

## Setup

```sh
cp .env.example .env
docker compose up -d postgres
bun install --frozen-lockfile
bun run db:migrate
bun run dev
```

Generate a strong `NUXT_AUTH_SECRET` (at least 32 characters). `DATABASE_URL` and secrets are server-only; only `NUXT_PUBLIC_APP_BASE_URL` and explicit public capability flags are sent to browsers. Production startup fails clearly when the database URL, auth secret, or an absolute non-localhost application URL is missing. OAuth providers remain optional.

## Authentication

Password authentication is disabled. For GitHub, create an OAuth application with homepage `http://localhost:3000` and authorization callback `http://localhost:3000/api/auth/callback/github`, then set `NUXT_GITHUB_CLIENT_ID` and `NUXT_GITHUB_CLIENT_SECRET`.

Generic OIDC is provider-neutral. Set `NUXT_OIDC_ISSUER`, client ID/secret, and base URL. Better Auth 1.7 treats generic OAuth as a standard social provider, so register redirect URI `${NUXT_PUBLIC_APP_BASE_URL}/api/auth/callback/oidc` (not the retired `/oauth2/callback/` route) and post-logout URI `${NUXT_PUBLIC_APP_BASE_URL}`. Discovery, issuer checks, OAuth state, and PKCE are handled by Better Auth. GitHub remains independent.

Magic links are opt-in with `NUXT_MAGIC_LINK_ENABLED=true`. The starter logs the link only for local development; replace that callback with a transactional email sender before production.

### Optional Pocket ID development provisioning

Set `DEV_OIDC_ADMIN_URL`, `DEV_OIDC_API_KEY`, and `APP_BASE_URL`, then run `bun run auth:provision`. It authenticates with Pocket ID's `X-API-KEY` header, creates or updates the named client, and uses the dedicated client-secret endpoint when no usable local secret exists. It preserves matching local credentials, replaces managed keys instead of appending duplicates, writes ignored `.env.local` with mode `0600`, and exits with actionable diagnostics when configuration or the IdP is unavailable. Revalidate the current Pocket ID API when upgrading that external service.

## Development and database

`bun run dev` starts Nuxt. Modify `server/database/schema.ts`, run `bun run db:generate`, review generated SQL, and apply with `bun run db:migrate`. Production uses migrations—not schema push. All Project queries include the authenticated owner in their SQL predicate.

## Verification

```sh
bun run lint
bun run typecheck
bun run test
bun run test:e2e
bun run check
```

Playwright may first need `bunx playwright install chromium`. E2E starts its own Nuxt development server and needs migrated PostgreSQL because session restoration runs during SSR. The authorization integration test also uses `DATABASE_URL`; it skips only when no database is available. See `.agents/context/commands.md` for what each check proves.

## Production and Docker

`bun run build && bun run start` serves Nitro's portable Node output. The production image contains that same Node output plus a small, explicit migration runner. Both the one-shot migration job and application service use the image tagged by `APP_IMAGE`; normal application startup never mutates the database. The image runs as the unprivileged `node` user, has no source bind mounts, and persists no application state.

Set a production `NUXT_AUTH_SECRET` and absolute `NUXT_PUBLIC_APP_BASE_URL` in `.env`. OAuth variables remain optional, and the application always connects to the Compose service hostname `postgres`, never host-local PostgreSQL. `APP_PORT` controls the published application port, `POSTGRES_PORT` controls the development database port, and `APP_IMAGE` controls the reusable image tag.

The release flow is intentionally explicit. A failed migration command is a failed deployment; do not start or update the application after it fails.

```sh
# Build the production image once for both migration and runtime.
docker compose build app

# Development: start only PostgreSQL (unchanged workflow).
docker compose up -d postgres

# Release: apply committed migrations, then start the production-like stack.
docker compose run --rm migrate
docker compose up -d --wait app

# Operate and inspect the stack.
docker compose logs -f app postgres
curl --fail http://localhost:${APP_PORT:-3000}/api/health
docker compose down --remove-orphans
```

To deploy a new application revision, pull or check out the revision, set `APP_IMAGE` to the intended tag, and run:

```sh
docker compose build app
docker compose run --rm migrate
docker compose up -d --wait app
```

Compose reuses the newly built image for the migration job and application. For a registry-provided image, pull the tag first with `docker compose pull app migrate`, then run the same migration and startup commands without rebuilding. Add `--volumes` to `docker compose down` only when intentionally deleting PostgreSQL data. `GET /api/health` verifies both process and database readiness.

## Repository conventions

`AGENTS.md` is concise canonical guidance. Load a relevant note or skill under `.agents/` only when needed. Browser code belongs in `app/`, trusted code in `server/`, authorization is enforced in handlers/SQL, and schema changes always include migrations. `STACK_EVALUATION.md` records integration tradeoffs.
