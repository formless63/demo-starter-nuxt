# Ops / Admin module evaluation

## Cross-framework v1 contract

The dispatch packet is authoritative. Read-only Ops has no persistence, migrations, privileged mutations or capability discovery. A valid human baseline session plus server allowlist is required; optional guards narrow by default, explicit replacement requires a guard. IDs are opaque bounded strings. A static application registry emits only sanitized bounded cards, max16 adapters/max8 count keys/64KiB. Deadlines 3 seconds per adapter/5 seconds total, max3 actual pending inspections and one shared pending invocation per adapter prevent repeated-refresh work multiplication. Disabled configuration and module/build/startup/health never inspect providers. Partial cards return200, access failures401/403, safe configuration failures503. Routes are private/no-store/Vary Cookie and uninstalled routes404.

## Reused implementation and upstream evidence

Launch main was fetched and verified at `6a85212e00181cd6208c9e30476a4b8bf6933024` on 2026-10-01 after the dispatched twelve-capability paired architecture/integration gate. Better Auth1.7.7 and Jobs role repairs are reused. No sibling repository was consulted.

No new framework/service dependency was selected. Reuse Nuxt4.5.2/@nuxt/kit4.5.2/module-builder1.0.3, H3 supported Nitro handlers and Vue3.5.43. Official sources inspected 2026-10-01: [Nuxt modules](https://nuxt.com/docs/4.x/guide/going-further/modules), [Better Auth session API](https://better-auth.com/docs/basic-usage), [pg-boss12.35.0 queue metadata](https://github.com/timgit/pg-boss/blob/12.35.0/docs/api/queues.md). Cached queue statistics are not instantaneous; no force recount or queue creation is allowed. Existing producer lifecycle creates queues, so Ops must not call it. Current reference Jobs/Webhooks conservatively expose sample-unknown, Audit capability-present; no invented metrics or history scans.

Existing Storage `checkStorage` is HEAD-only and Cache `checkCache` is connection/PING-only. Both have older non-cancellable public signatures; pending work is bounded/reused, not claimed cancelled. A future coordinated Storage signal extension may replace this fallback without changing the registry contract. No privileged provider dashboard, logs, payloads, bucket names or environment values are exposed.

## Verification evidence

Implementation verification pending. Status is in-progress; exact run evidence belongs in the draft PR. Full completed-capability lifecycle, root checks, dev/production browser, production image/migration/worker/health and exact-head hosted CI remain required.
