# Nuxt capability wave integration

Integration branch: `codex/integrate-nuxt-wave`, isolated worktree `/workspace/nuxt-integration`, based on current main `272a0b5f295a570bca25add3fff6b92fab9a7ffd`. No source branch was rewritten or unrelated capability implemented.

## Source commits and reconciliation

| Capability | Source commit | Integrated cherry-pick |
| --- | --- | --- |
| Webhooks | `c7c57dfb30cc24541e3989b0c588e15d1f89fe43` | `81f07a3` |
| Audit Log | `0e88a210c575b09177deb266366788c0148ff3d2` | `39242ba` |
| Cache / Coordination | `3883cf92ae15aeda2f31d97657a2e07c1ae72ab2` | `6dfb861` |

The commits were cherry-picked in this order, followed by reconciliation. Shared conflicts in package.json, bun.lock, Nuxt modules, catalog/reference enablement, README, ROADMAP, capability/removal docs, agent context and .env.example were merged by field or section. Existing Email dependencies, scripts, module, catalog state, SMTP magic links and Mailpit remain intact. Every pre-existing locked package record/version was retained; only wave additions were merged. No wholesale stale shared file was adopted.

The root explicitly enables Jobs, API Platform, Observability, Object Storage, Email, Webhooks, Audit Log and Cache / Coordination. These eight are done and defaultInstalled=false; other catalog entries remain planned. AGENTS.md, hook implementation and client adapters are unchanged. The three domain skills are present; harness tests now derive the worktree basename rather than assuming a checkout directory name.

## Contracts retained and normalized

Generic package tooling resolves the catalog hard-dependency closure for preparation, build and testing, builds dependencies first, packs staged copies, replaces workspace references with dependency tarballs, and uses local artifact overrides for private peer resolution. Install/removal mechanics remain generic. Removing a selected package retains its required packages and their owned dependencies. Webhooks removal retains Jobs; all independent fixtures, including Email, still pass. The two explicit Jobs #imports corrections remain necessary for clean packed consumption.

Webhooks retains the Jobs peer/module/catalog hard edge and existing native worker. Standard Webhooks HMAC interoperability, raw-byte inbound verification, serialized stable body/ID, per-attempt secret resolution, URL policy, application-owned durable idempotency and queued-payload privacy are preserved. Defaults: body 64 KiB/direct maximum 1 MiB; delivery/read timeout 10 seconds with 100 ms–30 second bounds; timestamp tolerance 300 seconds/maximum 900; five retries after the first attempt; initial delay 30 seconds; exponential backoff capped at 900 seconds. Initial-delay overrides are also capped at 900 seconds. Redirects and ordinary permanent 4xx outcomes remain terminal; network/timeouts, 408/425/429 and 5xx remain retryable.

Audit validates lowercase namespaced action identifiers on append and action filtering. Root writes use exactly projects.create, projects.update and projects.delete. Session actors use user IDs; API actors use verified API-key record IDs, never credentials. Encoded metadata is limited to 8 KiB, depth 6, 50 object keys, 100 array items and 1,024 nodes, retaining strict secret/container/non-JSON rejection. The action/createdAt DESC/id DESC B-tree index is added through explicit new root and fixture migrations; original migration history is retained. No metadata GIN, tenant, authorization, retention service or UI was added. Removal retains deployed table/history/migrations by default.

Cache remains independent, server-only and lazy, with redis 6.3.0 and real Valkey 9.1.2. Expiring writes, bounded string/byte values, atomic increment/expiry, token-checked leases and non-durable pub/sub are preserved. Temporary-CA TLS verification remains deterministic. Additive development Compose has no persistence or default startup/readiness dependency. Removal never issues FLUSH or other external destructive operations.

Docker keeps USER node and Audit’s migration ownership correction. Optional BuildKit proxy_ca secret mounts extend trust only during build; TLS verification stays enabled and no CA/credentials enter image layers. Default production Compose starts neither Valkey nor SMTP/Mailpit.

## Verification results

All commands below passed in this integration worktree. PostgreSQL 18 used a dedicated Compose project on port 55432; package fixtures used disposable independent databases/schemas.

| Check | Result |
| --- | --- |
| bun install --frozen-lockfile | Passed, including root postinstall; repeated after reconciliation |
| bun run agents:check | Passed |
| bun run agents:test | 98 passed, 0 failed |
| bun run capabilities:status / capabilities:check | Valid catalog: 29 capabilities, eight done |
| bun run packages:matrix | All eight completed package IDs discovered |
| bun run packages:test jobs | Packed install, runtime and removal passed |
| bun run packages:test api-platform | Packed install, PostgreSQL/auth/API/OpenAPI/docs and removal passed |
| bun run packages:test observability | Packed install, local OTLP/runtime/shutdown and removal passed |
| bun run packages:test object-storage | Packed install, backendless boot, real RustFS/Garage/CORS/UI and removal passed |
| bun run packages:test email | Packed install, real Mailpit SMTP/MIME/Chaos/partial/security and removal passed; repeated after generic lifecycle reconciliation |
| bun run packages:test webhooks | Automatic packed Jobs closure, actual Jobs worker/local receiver, inbound/retry/permanent/exhaustion and retained Jobs removal passed; repeated after normalization |
| bun run packages:test audit-log | Explicit PostgreSQL migrations, action index, action/metadata rejection, keyset filters/pagination, transaction commit/rollback and removal passed |
| bun run packages:test cache-coordination | Real Valkey Node/Bun, verified/untrusted TLS, bounds/TTL/counters/leases/pub-sub/reconnect and independent removal passed |
| bun run db:migrate / jobs:migrate / jobs:doctor | Passed |
| bun run webhooks:smoke | Signed delivery/inbound, retries and terminal outcomes passed |
| bun run lint / typecheck | Passed |
| bun run test | 19 files, 67 tests passed with migrated PostgreSQL; no skipped database suites |
| bun run build | Portable production Nitro build passed |
| bun run test:e2e | Three tests passed: landing/access protection, Project session/machine audit, health/API/OpenAPI/docs startup |
| bun fixtures/email-consumer/.fixture/reference-smoke.ts | Built Nitro SMTP magic-link delivery, canonical origin, redemption/session and private logs passed |

Repeated development E2E used NUXT_IGNORE_LOCK=1 only after confirming Nuxt’s recorded PID was defunct in this container. Package rebuilds and root development verification were run separately for the final successful E2E result. Production E2E uses the secure session-cookie prefix required by existing root production auth; no auth setting was weakened.

## Production path

The repository Dockerfile built nuxt-wave:integration with a fresh frozen install and source build. Verified image: sha256:2cba32982cb25eeab3f9e35eae0510d00b1e3053256a2f61ead9c9f202550323, USER node. An environment-only Compose override selected a fresh disposable nuxt_wave_production database and supplied build trust; it did not replace the production Dockerfile or seed dependencies.

The normal explicit migrate service applied application migrations, Jobs migrations and Jobs doctor. App and worker then started normally. Health, API/OpenAPI/docs, unauthenticated API rejection and actual Project machine/session mutations with audit assertions all passed against this image using:

```sh
PLAYWRIGHT_BASE_URL=http://127.0.0.1:33001 bun run test:e2e
```

The production test command also supplied that disposable DATABASE_URL and matching test auth secret. All three tests passed. `docker compose exec -T worker node .jobs/smoke.mjs` completed with verified execution. Cache URL and SMTP config were absent, magic links disabled, and no Webhook endpoint configured. The app/worker depended only on PostgreSQL. Disposable integration containers were stopped after verification; the pre-existing checkout/database was untouched.

## Publication limits

These are private @repo workspace packages. Selecting a public npm scope and reviewing publication metadata remain separate publication work. Hosted GitHub CI was not triggered because this task did not push or publish the integration branch; its local package/application/container checks passed. No production credentials or external production services were used.
