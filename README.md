# Nuxt Full-Stack Starter

A deployable, modular Nuxt 4 and Vue 3 starter using Bun, PostgreSQL with Drizzle, Better Auth, Tailwind CSS with shadcn-vue and Tabler Icons, Docker Compose, and a complete test/CI path. The repository includes a reference application plus optional Nuxt capability packages that can be kept or removed independently.

## Why this starter

- Production-sensible, provider-neutral defaults with portable Nitro output.
- Explicit reviewed migrations instead of startup-time schema mutation.
- Passwordless authentication with GitHub OAuth, generic OIDC, and optional magic links.
- Native Nitro server routes without a second backend framework.
- A health-checked production image and Compose release workflow.
- Optional capabilities built as normal Nuxt workspace packages.
- Lint, strict typecheck, integration tests, browser tests, package fixtures, and container smoke coverage.
- Concise agent guidance and machine-readable architecture metadata.

This is an opinionated starting point, not a universal application architecture. Keep the pieces that fit the product you are building.

## Base stack

| Baseline | Included |
| --- | --- |
| Application | Nuxt 4, Vue 3, Nitro, strict TypeScript |
| Tooling/runtime | Bun for dependencies and scripts; Node 24 production output |
| Data | PostgreSQL 18, Drizzle ORM, committed SQL migrations |
| Authentication | Better Auth sessions; GitHub OAuth; generic OIDC; optional hashed-token magic links; passwords disabled |
| UI | Tailwind CSS 4, shadcn-vue/Reka UI, Tabler Icons |
| Deployment | Multi-stage Docker image and provider-neutral Compose stack |
| Quality | ESLint, Vitest, Playwright, package lifecycle tests, CI, container smoke |

Optional capabilities are not baseline features. Their source may exist in the repository without making them part of a clean consumer application.

## Available capabilities

| Capability | Status | Default | Requirements | Purpose |
| --- | --- | --- | --- | --- |
| Jobs | Available (`done`) | Optional | Baseline PostgreSQL; external PostgreSQL service | Typed pg-boss jobs, explicit queue migrations, and a standalone worker |
| API Platform | Available (`done`) | Optional | Baseline Nuxt, Better Auth, PostgreSQL, and Drizzle | User-owned API keys, permissions, native `/api/v1` routes, OpenAPI 3.1.1, and Scalar docs |

`defaultInstalled: false` means a clean consumer must explicitly select and enable the capability. The root reference application deliberately enables both completed capabilities so their integration is continuously tested.

See [Using capabilities](docs/CAPABILITIES.md) for installation and removal guidance and [ROADMAP.md](ROADMAP.md) for the future design plan.

## Quick start

Install Node 24, Bun 1.4.2, and Docker with Compose, then:

```sh
cp .env.example .env
docker compose up -d postgres
bun install --frozen-lockfile
bun run db:migrate
bun run jobs:migrate
bun run dev
```

Set a strong `NUXT_AUTH_SECRET` of at least 32 characters. The checked-out reference app enables Jobs and API Platform; `db:migrate` applies the application/API tables and `jobs:migrate` applies the separately owned pg-boss schema. OAuth providers are optional for local startup.

## Authentication notes

Password authentication is disabled. For GitHub, create an OAuth application with homepage `http://localhost:3000` and authorization callback `http://localhost:3000/api/auth/callback/github`, then set `NUXT_GITHUB_CLIENT_ID` and `NUXT_GITHUB_CLIENT_SECRET`.

Generic OIDC is provider-neutral. Set `NUXT_OIDC_ISSUER`, client ID/secret, and base URL. Better Auth 1.7 treats generic OAuth as a standard social provider, so register redirect URI `${NUXT_PUBLIC_APP_BASE_URL}/api/auth/callback/oidc` (not the retired `/oauth2/callback/` route) and post-logout URI `${NUXT_PUBLIC_APP_BASE_URL}`. Discovery, issuer checks, OAuth state, and PKCE are handled by Better Auth. GitHub remains independent.

Magic links are opt-in with `NUXT_MAGIC_LINK_ENABLED=true`. The starter logs the link only for local development; replace that callback with a transactional email sender before production.

### Pocket ID development provisioning

Set `DEV_OIDC_ADMIN_URL`, `DEV_OIDC_API_KEY`, and `APP_BASE_URL`, then run `bun run auth:provision`. It authenticates with Pocket ID's `X-API-KEY` header, creates or updates the named client, and uses the dedicated client-secret endpoint when no usable local secret exists. It preserves matching local credentials, replaces managed keys instead of appending duplicates, writes ignored `.env.local` with mode `0600`, and exits with actionable diagnostics when configuration or the IdP is unavailable. Revalidate the current Pocket ID API when upgrading that external service.

## Starting a project

Choose one of two supported paths:

1. **Use the full reference application.** Keep Jobs and API Platform enabled when they are likely to be useful. This preserves the integrated worker, API-key UI, external API, and production Compose path.
2. **Start lean.** Keep the baseline and remove Jobs, API Platform, or both before product work. Capabilities can be re-enabled later from their local packages and contracts.

[Starting a project](docs/STARTING-A-PROJECT.md) contains verified, capability-specific removal recipes and distinguishes a disposable never-deployed project from an already-deployed application.

## Verification

```sh
bun install --frozen-lockfile
bun run capabilities:status
bun run capabilities:check
bun run packages:test jobs
bun run packages:test api-platform
bun run check
bun run test:e2e
```

PostgreSQL and committed migrations are required for database integration tests and E2E session restoration. Playwright may first require `bunx playwright install chromium`. See [.agents/context/commands.md](.agents/context/commands.md) for the full command contract.

## Deployment

Normal runtime startup never mutates the database. Build one image, use it for the explicit migration gate and runtime services, then verify health:

```sh
docker compose build app
docker compose run --rm migrate
docker compose up -d --wait app worker
curl --fail http://localhost:${APP_PORT:-3000}/api/health
docker compose logs -f app worker postgres
docker compose down --remove-orphans
```

Set production `NUXT_AUTH_SECRET` and `NUXT_PUBLIC_APP_BASE_URL` values in the environment. Compose connects to the `postgres` service rather than localhost. `APP_IMAGE`, `APP_PORT`, and `POSTGRES_PORT` are configurable. A failed migration is a failed deployment; do not update the runtime services after it fails. Add `--volumes` to `docker compose down` only when intentionally deleting PostgreSQL data.

For an image update, check out the intended revision or select a registry tag with `APP_IMAGE`, build or pull that image, run `migrate`, and only then recreate `app` and `worker` with `--wait`.

## Repository and capability development

- `app/` and `server/` contain the reference application.
- `packages/nuxt-*` contains private, publish-shaped optional Nuxt packages.
- `fixtures/*-consumer` proves tarball installation, runtime behavior, and clean removal like an external consumer.
- `capabilities/*/CAPABILITY.md` is the technical installation/removal contract for each completed capability.
- `capabilities/catalog.json` drives validation, package discovery, and the CI matrix.
- `ROADMAP.md` records planned capabilities and their dependency relationships.
- `.agents/` contains focused maintenance context and workflows.

The private `@repo/*` package scope means “inside this workspace.” These packages are not published; choose a real npm scope deliberately before any future release. Nuxt's module system remains the integration mechanism—there is no custom installer or runtime capability manager.
