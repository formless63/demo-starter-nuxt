# Nuxt full-stack starter

A deliberately small but production-sensible Nuxt 4 evaluation repository. It combines a portable Nitro application, OAuth-only authentication, PostgreSQL, and owner-scoped Projects CRUD without a second API framework or client cache.

## Stack and prerequisites

Nuxt 4 / Vue 3, strict TypeScript, Better Auth, Drizzle/PostgreSQL 18, Tailwind CSS 4 with shadcn-vue's Reka UI foundation, Tabler Icons, vue-sonner, Vitest, and Playwright. Install **Node 24**, **Bun 1.4.2**, and Docker with Compose. Versions are pinned; see `.agents/context/stack.md`.

## Setup

```sh
cp .env.example .env
docker compose up -d postgres
bun install --frozen-lockfile
bun run db:migrate
bun run dev
```

Generate a strong `NUXT_AUTH_SECRET` (at least 32 characters). `DATABASE_URL` and secrets are server-only; only `NUXT_PUBLIC_APP_BASE_URL` is sent to browsers. The app intentionally boots without OAuth providers so health/database work remains testable, but attempting an unconfigured provider produces an auth error.

## Authentication

Password authentication is disabled. For GitHub, create an OAuth application with homepage `http://localhost:3000` and authorization callback `http://localhost:3000/api/auth/callback/github`, then set `NUXT_GITHUB_CLIENT_ID` and `NUXT_GITHUB_CLIENT_SECRET`.

Generic OIDC is provider-neutral. Set `NUXT_OIDC_ISSUER`, client ID/secret, and base URL. Register redirect URI `${NUXT_PUBLIC_APP_BASE_URL}/api/auth/oauth2/callback/oidc` and post-logout URI `${NUXT_PUBLIC_APP_BASE_URL}`. Discovery, issuer checks, OAuth state, and PKCE are handled by Better Auth. GitHub remains independent.

Magic links are opt-in with `NUXT_MAGIC_LINK_ENABLED=true`. The starter logs the link only for local development; replace that callback with a transactional email sender before production.

### Optional Pocket ID development provisioning

Set `DEV_OIDC_ADMIN_URL`, `DEV_OIDC_API_KEY`, and `APP_BASE_URL`, then run `bun run auth:provision`. It creates or updates the named client through Pocket ID's API and appends generated credentials to ignored, mode-0600 `.env.local`. It is safe to rerun and exits with actionable diagnostics when configuration or the IdP is unavailable. API permissions and API surface can vary by Pocket ID release; the implementation targets the current v2 OIDC-client API and this integration should be verified when upgrading Pocket ID.

## Development and database

`bun run dev` starts Nuxt. Modify `server/database/schema.ts`, run `bun run db:generate`, review generated SQL, and apply with `bun run db:migrate`. Production uses migrations—not schema push. All Project queries include the authenticated owner in their SQL predicate.

## Verification

```sh
bun run lint
bun run typecheck
bun test
bun run test:e2e
bun run check
```

Playwright may first need `bunx playwright install chromium`. E2E needs PostgreSQL because Nuxt initializes authentication on protected requests. See `.agents/context/commands.md` for what each check proves.

## Production and Docker

`bun run build && bun run start` serves Nitro's portable Node output. Build the container with `docker build -t nuxt-starter .`; run it with required environment and a reachable PostgreSQL URL. `GET /api/health` verifies process and database readiness. The runtime is provider-neutral and persists no application state in the container.

## Repository conventions

`AGENTS.md` is concise canonical guidance. Load a relevant note or skill under `.agents/` only when needed. Browser code belongs in `app/`, trusted code in `server/`, authorization is enforced in handlers/SQL, and schema changes always include migrations. `STACK_EVALUATION.md` records integration tradeoffs.
