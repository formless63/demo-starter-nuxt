---
name: jobs-change
description: Changing background jobs, queues, workers, pg-boss migrations, or transactional enqueue behavior.
---

# Jobs change workflow

Read `.agents/context/architecture.md`, `.agents/context/stack.md`, and `.agents/context/commands.md` before editing.

1. Keep pg-boss and database code server-only. Job definitions shared by Nitro and the standalone worker must not depend on Vue or browser/Nitro globals.
2. Keep every application, enqueue client, and worker instance on `migrate: false`. Schema creation/upgrades belong only in the explicit `jobs:migrate` release step.
3. Define each job in `server/jobs/tasks/`, register it in `server/jobs/registry.ts`, and validate its payload with Zod at the worker execution boundary. The enqueue helper may validate earlier as well.
4. When an application database write and job creation describe one operation, enqueue through `sendJobInTransaction` inside the existing Drizzle transaction. Test both commit and rollback against PostgreSQL.
5. Keep reusable module/runtime/CLI code in `packages/nuxt-jobs` and application definitions in `server/jobs`. Import only the package's public API from consumers. Use the shared registry from both Nitro and the standalone worker; do not duplicate handler registration.
6. Before upgrading pg-boss, review its migration and release notes, apply its supported migrations on a clean database, run `jobs:doctor`, and confirm all long-running instances still reject pending migrations.
7. Verify `packages:test jobs`, `jobs:smoke`, payload failures, transactional integration, graceful worker shutdown, the production image, and Compose startup alongside the ordinary repository checks.

Do not recreate pg-boss migration SQL, migrate during app/worker startup, expose jobs code to the browser, or add a dashboard/API framework as part of routine queue work.
