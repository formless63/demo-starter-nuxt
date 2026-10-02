# Stripe v1

Implementation in progress. Optional private Nuxt capability; hard dependencies are Jobs and Webhooks. Existing fourteen completed capabilities remain unchanged.

Target: stripe-node 23.0.0, API 2026-09-30.endive, Node 24 and Bun 1.4.2. Hosted one-time Checkout only, trusted customer/offer bindings, local payment projections, durable operation ledger and native signed-event inbox. Configuration is lazy; missing configuration must not prevent base application startup.

Application-owned scope and binding authorization are mandatory. Callback reconciliation requires an explicit trusted server authorizeReconciliation seam; no provider metadata actor. Checkout parameters are frozen before dispatch and replay keeps the operation UUID idempotency key within a strict 23-hour horizon. Cancellation after dispatch preserves uncertainty.

Migration allocation: 0011/0012 only, additive against frozen main 7d2490cd964d0d76be25c300104d3412a3f7cead. Retain existing migrations and all provider data on removal. No Identity changes.

Acceptance requires generic packed install/runtime/remove/rebuild, official SDK local wire/signature fixtures on both runtimes, PostgreSQL receipt/ledger/Jobs rollback and retention, reference UI/browser tests, production image/health/worker and exact-SHA hosted CI. Until those pass this capability is not complete or certified.

No external Stripe API calls, CLI login, sandbox account creation, callback registration, credentials creation, payments, publication, deployment or main merge are authorized. Local protocol fixtures are not financial certification.
