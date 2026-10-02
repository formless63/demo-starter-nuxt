# Stripe v1

Implementation in progress. Optional private Nuxt capability; hard dependencies are Jobs and Webhooks. Existing fourteen completed capabilities remain unchanged.

Target: stripe-node 23.0.0, API 2026-09-30.endive, Node 24 and Bun 1.4.2. Hosted one-time Checkout only, trusted customer/offer bindings, local payment projections, durable operation ledger and native signed-event inbox. Configuration is lazy; missing configuration must not prevent base application startup.

Application-owned scope and binding authorization are mandatory. Callback reconciliation requires an explicit trusted server authorizeReconciliation seam; no provider metadata actor. Checkout parameters are frozen before dispatch and replay keeps the operation UUID idempotency key within a strict 23-hour horizon. Cancellation after dispatch preserves uncertainty.

Migration allocation: 0011/0012 only, additive against frozen main 7d2490cd964d0d76be25c300104d3412a3f7cead. Retain existing migrations and all provider data on removal. No Identity changes.

Acceptance requires generic packed install/runtime/remove/rebuild, official SDK local wire/signature fixtures on both runtimes, PostgreSQL receipt/ledger/Jobs rollback and retention, reference UI/browser tests, production image/health/worker and exact-SHA hosted CI. Until those pass this capability is not complete or certified.

No external Stripe API calls, CLI login, sandbox account creation, callback registration, credentials creation, payments, publication, deployment or main merge are authorized. Local protocol fixtures are not financial certification.

## Server composition

`createStripeService` accepts lazy database/Jobs factories and explicit trusted `authorizeScope`, `authorizeBoundResource`, `authorizeReconciliation`, `resolveConnection`, `resolveOffer` and `approvedRedirects` functions. Missing authorization denies. Browser context is restored from the native session and never selects a scope, connection, customer ID, Price ID or provider headers. Tenant use requires application membership wiring; root supports user scopes only and callback checks a current active server binding plus existing local owner.

Caller-owned `requestCheckoutInTransaction`, `requestPaymentReconciliationInTransaction` and `receiveInTransaction` neither settle nor retry the caller transaction. `receiveInTransaction` requires a previously verified native hint from `verifyStripeWebhook`; do not expose it publicly or call it with parsed unverified input. Convenience methods explicitly own transactions. Only local operation/inbox UUIDs enter existing Jobs. Writes freeze approved immutable parameters privately; key reuse conflicts on changed normalized intent. `replayCheckout` is an explicitly invoked trusted server operation, retrieves a known accepted Checkout identity through GET only, including beyond23h. If the identity is unknown, it uses the original `gs-stripe:<UUID>` key/intent and denies at/after23h. Changed account/mode always denies. An accepted identity is durably bound before child payment retrieval; later projection errors remain uncertain and never masquerade as provider rejection. It has no browser route and no automatic cached-500 escape.

Resources are local projections; getters/list never contact Stripe. Workers fetch current provider state outside SQL transactions, require matching response IDs/mode, recheck current authorization and commit using token-fenced leases. Checkout-derived PaymentIntent reads claim the same payment binding lease used by independent payment reconciliation before HTTP; the parent and child projections commit atomically behind their fences. Recovery releases both claims for the expired attempt token. `recoverExpiredAttempts` is an explicit bounded operator scan; `repairReceiptInTransaction` conditionally requeues a failed receipt once. Neither runs automatically at startup. Stop all workers and expire/settle attempts before unregistering handlers.

## Reference and operator configuration

`/stripe` restores native authentication and exposes queue/read/reconcile/cancel actions with repeated intent-key semantics and request cancellation. Stopping a browser request does not undo provider activity. The reference registers only `starter.one-time` using application-owned `STRIPE_REFERENCE_PRICE_ID`/`STRIPE_REFERENCE_CURRENCY` and HTTPS redirect settings. Operators must explicitly bind an existing customer through trusted server code. There is no browser customer onboarding. Compose supplies the same optional settings to app and worker; base startup needs none.

Conflicting authenticated event IDs retain the first digest and binding. A new differing digest triggers one authoritative recheck of that original binding; repeated conflicting bytes coalesce. If it arrives during processing, one follow-up is atomically enqueued with completion. The additive0012 migration preserves existing receipts and prior0011 SQL.

Native callback route: `POST /api/integrations/stripe/webhooks/default`. Operator endpoint API version must independently be configured to2026-09-30.endive. Registration, secret provisioning, sandbox access and live payments remain separate unauthorized external actions.

## Removal

Drain/stop Stripe processing, recover expired attempts deliberately, then remove application routes/page/plugin/registry wiring and the Nuxt module/package dependency. Preserve the four tables, bindings, projections, ledgers, inbox and applied SQL/journal/history. Move schema declarations to application-owned code when package imports are removed. Do not delete remote resources, deregister callbacks or revoke credentials implicitly. The packed consumer retains Jobs/Webhooks and proves exact rows plus Drizzle migration history survive removal/rebuild.
