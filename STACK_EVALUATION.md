# Stack evaluation (September 2026)

## Versions and scaffold

The exact reproducible graph is in `package.json`/`bun.lock`. Major versions: Bun 1.4, Node 24 LTS, Nuxt 4, Vue 3, TypeScript 5, PostgreSQL 18, Better Auth 1, Drizzle 0.45, Tailwind 4, Reka UI 2, Vitest 5, Playwright 1. The repository began nearly empty, so none of create-nuxt's generated demo UI was retained. The result follows its Nuxt 4 `app/` layout and Nitro conventions manually.

Nuxt modules are `@nuxt/eslint` and `@nuxtjs/color-mode`; Tailwind uses its official Vite plugin. Official Nuxt docs and the credential-free Nuxt MCP endpoint informed conventions; MCP is documented for capable agents rather than tied to an editor or application runtime.

## Packages added and manual wiring

Meaningful additions are Better Auth plus its Drizzle adapter/plugins; Drizzle ORM/Kit and postgres; Tailwind, Reka UI (the current shadcn-vue primitive layer), tailwind-merge, Tabler Icons, vue-sonner, Zod; Nuxt ESLint/test-utils, Vitest/happy-dom, and Playwright. Manual work included runtime config mapping, the auth catch-all, complete auth tables, generic OIDC and optional magic-link plugins, session composable/middleware, owner-scoped CRUD routes, migration, shell/theme, test runners, Docker, CI, and maintenance configuration.

## Friction and findings

- **Auth:** Better Auth is framework-neutral rather than a first-party Nuxt module. h3's Web Request bridge is clean, but provider callback paths and client plugins require care. The optional email transport is deliberately not faked for production. Account linking behavior belongs to Better Auth's provider/account model; unique provider identity and email indexes are explicit.
- **Database:** Drizzle is direct and predictable, but Better Auth schema ownership means upgrades must be checked against its CLI/schema documentation. Migrations remain a separate operational step, correctly avoiding auto-push.
- **UI:** Tailwind 4's Vite plugin is simpler than the former PostCSS/module path. Reka is installed as shadcn-vue's primitives foundation; the intentionally small hand-owned components avoid importing Lucide or generating a large component tree.
- **Bun:** Bun works well for install/scripts/tests. Nitro's documented portable Node server remains the conservative production runtime. A restricted build environment may block Bun's installer, so the supported version is recorded rather than downloaded by project scripts.
- **Nitro/Docker:** Multi-stage output is small and portable; database migrations intentionally run as a release step, not on every process start.
- **Testing:** Nuxt test-utils has more initialization cost than plain Vitest. Database authorization is strongest when exercised against PostgreSQL; CI provisions it. Browser OAuth itself cannot be deterministic without external credentials, so the committed smoke path verifies landing and protection.
- **Agent tooling:** Nuxt MCP is useful and vendor-neutral at the protocol level, but editor configurations differ. Documentation is safer than committing user settings. Layered context/skills work better than a large always-loaded file.
- **Undocumented/workarounds:** Pocket ID administration APIs have changed across releases. The provisioner targets the current `/api/oidc/clients` contract, detects response failures loudly, and should be revalidated with the selected IdP version. Runtime OIDC remains generic.

No prerelease dependency is intentionally used.

## If this became the permanent starter

Add a real transactional-email adapter only when magic links are wanted; add PostgreSQL-backed API integration fixtures with a supported auth test-session hook; generate selected shadcn-vue components as the product design emerges; and pin a tested Pocket ID Compose profile if that IdP becomes a permanent development dependency. Do not add Pinia, a repository layer, or a client cache until feature complexity proves the need.
