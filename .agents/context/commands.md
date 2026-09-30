# Commands

All commands use Bun. PostgreSQL is required for migrations, authenticated runtime behavior, integration tests, and health checks.

- `bun install --frozen-lockfile`: reproduce dependencies.
- `bun run capabilities:check`: validate capability catalog schema, relationships, files, and declared package scripts.
- `bun run capabilities:status`: read the catalog and root Nuxt configuration to report availability, clean-consumer defaults, package-source presence, reference-app enablement, requirements, and external services; it does not modify the application.
- `docker compose up -d postgres`: start PostgreSQL 18.
- `docker compose build app`: build and tag the shared production application/migration image.
- `docker compose run --rm migrate`: explicitly apply application migrations, supported pg-boss migrations, and the jobs doctor using the production image; failure blocks release startup.
- `docker compose up -d --wait app worker`: start healthy PostgreSQL and the production application and standalone worker after migrations.
- `docker compose logs -f app worker postgres`: follow production-like application, worker, and database logs.
- `docker compose down --remove-orphans`: stop the stack without deleting PostgreSQL data; add `--volumes` only for an intentional clean database.
- `bun run db:generate`: generate a reviewed migration after schema changes.
- `bun run db:migrate`: apply committed migrations (never use push in production).
- `bun run jobs:migrate`: explicitly create/upgrade the pg-boss schema; uses `PGBOSS_DATABASE_URL` when set, otherwise `DATABASE_URL`.
- `bun run jobs:doctor`: fail on pg-boss schema drift or pending migration problems.
- `bun run jobs:worker`: run the standalone worker with migrations disabled.
- `bun run jobs:smoke`: enqueue `starter.echo`, run the real worker registration, and verify completion output.
- `bun run packages:prepare`: prepare done/in-progress catalog packages that the root reference application actually depends on; root postinstall runs this before Nuxt preparation.
- `bun run packages:build <id>`: produce a completed capability's publish-shaped package artifact without publishing it; omit IDs to build all completed package capabilities.
- `bun run packages:test <id>`: pack a completed capability, install it in its catalog-declared fixture, run common typecheck/build and its optional fixture-owned runtime check, remove it, and prove the remaining app typechecks/builds; omit IDs to test all.
- `bun run packages:matrix`: emit the catalog-derived JSON matrix used by CI for completed package capabilities.
- Explicit `packages:build <id>` / `packages:test <id>` may target an in-progress package while developing it; unqualified commands and the CI matrix still select only completed packages.
- Observability package verification: `bun run packages:test observability`; the fixture owns safe-output/context/span/metric tests, actual local OTLP/HTTP JSON receiving, no-backend/independent-signal checks and bounded app/standalone shutdown. No external collector is needed.
- API package verification: `bun run packages:build api-platform` and `bun run packages:test api-platform`; the fixture owns database/auth/permission/OpenAPI/docs checks while generic orchestration owns packed install and removal.
- Package CLI: `nuxt-jobs <worker|migrate|doctor|smoke>`; registry commands accept `--registry`, and smoke also requires `--job` plus JSON `--payload`.
- `bun run dev`: Nuxt development server.
- `bun run lint`: ESLint static checks.
- `bun run typecheck`: strict Nuxt/Vue TypeScript check.
- `bun run test`: Nuxt/Vitest unit and database integration suite; authorization coverage requires `DATABASE_URL` and migrated PostgreSQL.
- `bun run test:e2e`: Playwright browser smoke test, which starts Nuxt itself (install Chromium once with `bunx playwright install chromium`).
- `bun run build` / `bun run start`: produce and serve portable Nitro output.
- `bun run check`: lint, typecheck, Nuxt/Vitest tests, and production build.
- `bun run auth:provision`: idempotently configure a development Pocket ID client using the documented environment.
- Container smoke: build the shared image, start `postgres`, run `migrate`, start `app worker` with `--wait`, curl `/api/health`, confirm the worker is running, then always run `docker compose down --volumes --remove-orphans`.
