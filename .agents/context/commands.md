# Commands

All commands use Bun. PostgreSQL is required for migrations, authenticated runtime behavior, integration tests, and health checks.

- `bun install --frozen-lockfile`: reproduce dependencies.
- `docker compose up -d postgres`: start PostgreSQL 18.
- `docker compose build app`: build and tag the shared production application/migration image.
- `docker compose run --rm migrate`: explicitly apply committed migrations using the production image; failure blocks release startup.
- `docker compose up -d --wait app`: start healthy PostgreSQL and the production application after migrations.
- `docker compose logs -f app postgres`: follow production-like application and database logs.
- `docker compose down --remove-orphans`: stop the stack without deleting PostgreSQL data; add `--volumes` only for an intentional clean database.
- `bun run db:generate`: generate a reviewed migration after schema changes.
- `bun run db:migrate`: apply committed migrations (never use push in production).
- `bun run dev`: Nuxt development server.
- `bun run lint`: ESLint static checks.
- `bun run typecheck`: strict Nuxt/Vue TypeScript check.
- `bun run test`: Nuxt/Vitest unit and database integration suite; authorization coverage requires `DATABASE_URL` and migrated PostgreSQL.
- `bun run test:e2e`: Playwright browser smoke test, which starts Nuxt itself (install Chromium once with `bunx playwright install chromium`).
- `bun run build` / `bun run start`: produce and serve portable Nitro output.
- `bun run check`: lint, typecheck, Nuxt/Vitest tests, and production build.
- `bun run auth:provision`: idempotently configure a development Pocket ID client using the documented environment.
- Container smoke: build `app`, start `postgres`, run `migrate`, start `app` with `--wait`, curl `/api/health`, then always run `docker compose down --volumes --remove-orphans`.
