# Stack evaluation (September 2026)

## Versions and scaffold

The exact reproducible graph is in `package.json`/`bun.lock`. Major versions: Bun 1.4, Node 24 LTS, Nuxt 4, Vue 3, TypeScript 5, PostgreSQL 18, Better Auth 1, Drizzle 0.45, Tailwind 4, Reka UI 2, Vitest 5, Playwright 1. The repository began nearly empty, so none of create-nuxt's generated demo UI was retained. The result follows its Nuxt 4 `app/` layout and Nitro conventions manually.

Nuxt modules are `@nuxt/eslint`, `@nuxtjs/color-mode`, and `shadcn-nuxt`; Tailwind uses its official Vite plugin. Official Nuxt docs and the credential-free Nuxt MCP endpoint informed conventions; MCP is documented for capable agents rather than tied to an editor or application runtime.

## Packages added and manual wiring

Meaningful additions are Better Auth plus its Drizzle adapter/plugins; Drizzle ORM/Kit and postgres; Tailwind, `shadcn-nuxt`, Reka UI, class-variance-authority, clsx, tailwind-merge, VueUse, Tabler Icons, vue-sonner, Zod; Nuxt ESLint/test-utils, Vitest/happy-dom, and Playwright. Manual work included runtime config mapping and startup validation, the auth catch-all, complete auth tables, generic OIDC and optional magic-link plugins, SSR-safe session middleware/layouts, owner-scoped CRUD services/routes, migration, shell/theme, test runners, Docker, CI, and maintenance configuration.

## Friction and findings

- **Auth:** Better Auth is framework-neutral rather than a first-party Nuxt module. Version 1.7 moved generic OAuth onto the standard social-provider flow and `/api/auth/callback/:providerId`; older examples using `/oauth2/callback/` are wrong. Its current Vue client adds a Nuxt-specific `useSession(useFetch)` overload, which is necessary for incoming-cookie forwarding and hydration-safe SSR. The optional email transport is deliberately not faked for production.
- **Database:** Drizzle is direct and predictable, but Better Auth schema ownership means upgrades must be checked against its CLI/schema documentation. Migrations remain a separate operational step, correctly avoiding auto-push.
- **UI:** Tailwind 4's Vite plugin is simpler than the former PostCSS/module path. Installing Reka alone was not enough to initialize shadcn-vue: the starter also needs `shadcn-nuxt`, `components.json`, CSS tokens, aliases, and generated-style component sources. Only Button, Input, Textarea, and Card primitives are retained, and icon configuration is explicitly `none` so shadcn tooling does not introduce Lucide.
- **Bun:** Bun works well for install/scripts/tests. Nitro's documented portable Node server remains the conservative production runtime. The verification container exposed Bun 1.2.14 and blocked the official installer even though the repository pins current Bun 1.4.2; frozen installation and all scripts remained compatible, but CI and Docker deliberately test the pinned version.
- **Nitro/Docker:** Multi-stage output is small and portable; database migrations intentionally run as a release step, not on every process start.
- **Testing:** Nuxt test-utils has more initialization cost than plain Vitest. Owner authorization now runs through the actual project data service against migrated PostgreSQL; it verifies read/update/delete denial for a second user. Playwright starts Nuxt itself, and CI installs Chromium before exercising landing-page SSR and route protection. Browser OAuth itself cannot be deterministic without external credentials.
- **Agent tooling:** Nuxt MCP is useful and vendor-neutral at the protocol level, but editor configurations differ. Documentation is safer than committing user settings. Layered context/skills work better than a large always-loaded file.
- **Undocumented/workarounds:** Pocket ID administration APIs have changed across releases. The current source uses `X-API-KEY`, paginated client responses, client IDs in `id`, and `/api/oidc/clients/:id/secrets`; plaintext secrets are returned only at creation. The provisioner preserves an existing matching local secret and rewrites managed `.env.local` keys to avoid duplicates. This external API should still be revalidated when Pocket ID is upgraded. Runtime OIDC remains generic.

No prerelease dependency is intentionally used.

## If this became the permanent starter

Add a real transactional-email adapter only when magic links are wanted; add PostgreSQL-backed API integration fixtures with a supported auth test-session hook; generate selected shadcn-vue components as the product design emerges; and pin a tested Pocket ID Compose profile if that IdP becomes a permanent development dependency. Do not add Pinia, a repository layer, or a client cache until feature complexity proves the need.
