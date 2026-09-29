---
name: capability-change
description: Installing, removing, creating, or changing reusable capabilities or their dependency, integration, external-service, script, migration, or deployment contracts.
---

# Capability change workflow

Read `ROADMAP.md`, `capabilities/catalog.json`, and the capability's `capabilities/<id>/CAPABILITY.md` when it exists.

1. Distinguish hard `requires` edges from optional `integratesWith` edges and non-capability `externalRequirements`. Check baseline requirements, environment, migrations, scripts, runtime processes, and deployment impact.
2. Never silently add a hard dependency. Keep optional integrations optional and avoid hard-dependency cycles.
3. Use Nuxt 4 `moduleDependencies` for a true Nuxt-module dependency when the framework can enforce it. Mark optional Nuxt-module integrations `optional: true`. Do not represent npm libraries or starter baseline services such as Drizzle or Better Auth as fake Nuxt modules.
4. Update `ROADMAP.md`, `capabilities/catalog.json`, and the capability's `CAPABILITY.md` together when their shared contract changes.
5. Test clean installation and removal when applicable. Run capability-specific migrations and smoke tests, `bun run capabilities:check`, and normal repository verification.

Do not create empty module-specific skills for capabilities that are not implemented.
