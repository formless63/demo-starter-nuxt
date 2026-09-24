# Commands

All commands use Bun. PostgreSQL is required for migrations, authenticated runtime behavior, integration tests, and health checks.

- `bun install --frozen-lockfile`: reproduce dependencies.
- `docker compose up -d postgres`: start PostgreSQL 18.
- `bun run db:generate`: generate a reviewed migration after schema changes.
- `bun run db:migrate`: apply committed migrations (never use push in production).
- `bun run dev`: Nuxt development server.
- `bun run lint`: ESLint static checks.
- `bun run typecheck`: strict Nuxt/Vue TypeScript check.
- `bun test`: Vitest unit/integration suite.
- `bun run test:e2e`: Playwright browser smoke test (install Chromium once with `bunx playwright install chromium`).
- `bun run build` / `bun run start`: produce and serve portable Nitro output.
- `bun run check`: lint, typecheck, tests, and production build.
- `bun run auth:provision`: idempotently configure a development Pocket ID client using the documented environment.
