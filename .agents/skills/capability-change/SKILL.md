---
name: capability-change
description: Installing, removing, creating, or changing reusable capabilities or their dependency, integration, external-service, script, migration, or deployment contracts.
---

# Capability change workflow

Read `ROADMAP.md`, `capabilities/catalog.json`, and the capability's `capabilities/<id>/CAPABILITY.md` when it exists.

1. Distinguish hard `requires` edges from optional `integratesWith` edges and non-capability `externalRequirements`. Check baseline requirements, environment, migrations, scripts, runtime processes, and deployment impact.
2. Never silently add a hard dependency. Keep optional integrations optional and avoid hard-dependency cycles.
3. Use Nuxt 4 `moduleDependencies` for a true Nuxt-module dependency when the framework can enforce it. Mark optional Nuxt-module integrations `optional: true`. Do not represent npm libraries or starter baseline services such as Drizzle or Better Auth as fake Nuxt modules.
4. A completed Nuxt package capability must declare its package, fixture, and package-test contract in `capabilities/catalog.json`. Keep capability-specific runtime checks in its fixture hook; keep pack/install/build/removal mechanics in the generic `packages:*` orchestration. Do not add a handwritten capability CI job.
5. Update `ROADMAP.md`, `capabilities/catalog.json`, and the capability's `CAPABILITY.md` together when their shared contract changes.
6. Test clean installation and removal with `bun run packages:test <id>` when applicable. Run capability-specific migrations and smoke tests, `bun run capabilities:check`, and normal repository verification.

Do not create empty module-specific skills for capabilities that are not implemented.
