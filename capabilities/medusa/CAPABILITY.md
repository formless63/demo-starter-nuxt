# Medusa v1

`@repo/nuxt-medusa` is an independent private Nuxt4 package. Hard dependencies: Jobs and Webhooks. Optional application wiring: Object Storage, Organizations and Search. Clean consumers retain `defaultInstalled:false`; the root reference app explicitly enables Medusa. No provider configuration is needed to install/build/start the app or worker.

## Install and server wiring

Install the packed private package and its Jobs/Webhooks peers, then add `@repo/nuxt-jobs`, `@repo/nuxt-webhooks`, `@repo/nuxt-medusa` to Nuxt modules. Import the four tables from `@repo/nuxt-medusa/schema` into the application's Drizzle schema; generate/review additive migrations. The reference SQL is `0013_medusa.sql`. Run explicit app and Jobs migrations plus doctor before runtime startup; no startup migration or provider registration exists.

Compose `createMedusaService` into the existing Jobs registry using `operationJob` and `inboxJob`. Supply the existing same-database Jobs boss and application database. Native Nitro routes are application-owned under `/api/integrations/medusa/...`; removal does not depend on a provider loader. The root reference supplies an authenticated `/integrations/medusa` page and closed no-store HTTP results.

`TrustedContext` is server-only: authenticated actor, opaque user/tenant scope and cancellation signal. User scope must match actor. Explicit `authorizeScope`, `authorizeBoundResource` and `authorizeMedusaResource` policies deny when absent. Tenant membership is application wiring and has no default grant. The Admin key's store visibility and sales-channel filters do not authorize local resource access.

`createBindingInTransaction` and `retireBindingInTransaction` are trusted server extensions. Browser requests and callbacks cannot create/remap bindings or select credentials/connection endpoints/provider IDs. Bindings enforce scoped local uniqueness and unambiguous connection/kind/remote uniqueness. Retired bindings stay retained and cannot be remapped. Root user policy requires an existing local owner and a current server-owned binding.

Callback workers use `authorizeReconciliation(binding,signal)` to recheck current application ownership before fetch and before commit. They do not invent a human actor from provider metadata. Absence denies. User commands retain their actor/scope and reauthorize both at execution and commit.

## Configuration and protocol

Operation-lazy `MEDUSA_BASE_URL`, `MEDUSA_SECRET_API_KEY`; optional current/previous `MEDUSA_BRIDGE_WEBHOOK_SECRET` and `MEDUSA_BRIDGE_WEBHOOK_SECRET_PREVIOUS`. Missing API configuration yields static503 on refresh. Missing bridge secret disables only the receiver. One default connection named `default`; optional trusted `resolveConnection`, `selectConnection`, `registeredConnection` and `resolveBridgeSecrets` functions select registered machine identities. Never accept these functions or configuration from a browser.

Provider pin2.21.2. Native fetch uses Basic base64(key+":"), never legacy x-medusa-access-token, login/password/key creation or SDK hidden retries. Only GET `/admin/products/{id}`, `/admin/orders/{id}`, `/admin/products`, `/admin/orders`, with closed fields and server filters. HTTPS required; HTTP allowed only test/development with the original literal loopback hostname. No userinfo, fragments, redirects, automatic pagination, image fetching or startup network I/O.

Fixed deadlines: outbound15s, worker45s, raw receipt/transaction5s. Callers can shorten outbound bounds. Signals abort actual transport and remain active through body consumption. Stream limits: inbound1MiB, provider2MiB including errors, public JSON256KiB, signature header8192bytes. GETs have no outbound body. Public errors are static code/message/retryable objects; queues carry only operation/inbox UUIDs and closed processed/ignored results.

Products expose bound ID/title/handle/closed status/timestamps/deleted; orders expose closed state summaries/currency/exact major-unit decimal total/timestamps/deleted. Numeric lexemes are retained before JSON parsing; unsafe/exponent or over-bound totals fail instead of silently rounding. Never divide totals by100. No address/email/metadata/images/provider responses or credentials are stored. Unknown native enum values map to unknown. Confirmed authenticated404 can tombstone an existing projection while retaining prior safe values;403/transient responses cannot.

## APIs and durability

Local-only `getProduct`, `getOrder`, `listProducts`, `listOrders`, `getOperation`; explicit `requestResourceReconciliation`, `requestSyncPage`, `getSyncResult`, `cancelOperation`. List pages default25, max100, descending immutable(createdAt,id), strict canonical versioned base64url ISO-ms/UUID cursor and scope filters on every query. Sync pages default25/max100 with kind/connection/offset cursor, no arbitrary filters or auto-binding. Progress/result exposes only processed count and next cursor. Offset pages/counts are advisory, neither a snapshot nor full-store export.

Convenience commands/`receive` explicitly own short transactions. Their `...InTransaction` counterparts never commit/rollback/reconnect/retry caller transactions; caller must commit before announcing durable success. Operation/receipt insertion and same-database Jobs enqueue are atomic. Trusted caller keys deduplicate immutable intent and reject changed input. Public commands have no arbitrary property bags.

No SQL transaction spans provider I/O. Conditional attempts, per-binding leases and revisions fence projection and ledger/inbox commits. A sync page discovers IDs only; each already-bound authorized resource is fetched again after acquiring its own lease, so an older list snapshot cannot overwrite a newer reconciliation. The whole page still shares the45s worker bound and does not automatically continue. Reads retry only typed transient unavailable/deadline errors through Jobs: five retries,30s exponential backoff capped900s. Exhaustion records safe failure. Page failures retain current processed progress rather than claim full-store success. `repair` is an explicit trusted operator API accepting at most100 local operation/inbox IDs; it requeues failed/expired reads transactionally. No recovery daemon or startup network scan exists.

Callbacks authenticate exact raw bytes before parsing. Receipt uniqueness is connection+deliveryUUID; raw bodies are dropped after SHA256. Authenticated unsupported/unbound hints return durable200 without ownership creation. Duplicates do not enqueue storms. Different digest with the same delivery ID preserves the original identity/hint/digest and schedules a fenced authoritative refresh of that original binding. Latest GET state provides projection idempotency independently of event ordering or delivery IDs.

## Application-owned bridge

The packed package ships [`provider-bridge/subscriber.ts`](../../packages/nuxt-medusa/provider-bridge/subscriber.ts) for explicit manual installation in a separate provider project. [Operator guide](provider-bridge/README.md). Protocol `application-bridge.standard-webhooks-v1` uses existing Webhooks raw HMAC id.timestamp.body/signature framing,300s absolute replay window and rotation. It is not Medusa-native commerce signing or Medusa Cloud build/deployment signing.

Subscribe only to workflow product.created/product.updated/product.deleted and order.placed. Pinned internal ProductEvents instead use product.product.*; direct module mutations can miss workflow hints. Native retries can generate fresh delivery UUIDs; retained explicit delivery records can reuse an ID. Provider event infrastructure owns delivery durability; this artifact is not a durable outbox and promises no universal exactly-once behavior. Manual/page reconciliation repairs missed hints.

## Verification and compatibility limits

Generic `bun run packages:test medusa` owns private pack/install/type/build/runtime/remove/rebuild and retained database proof. Fixture contracts run on pinned Bun1.4.2 and actual Node24 with PostgreSQL18; root unit/browser suites exercise local and authenticated reference behavior. The matrix selects authored in-progress fixture contracts as well as completed packages.

Mocked wire fixtures prove scope/forgery, canonical cursors, secret rotation/replay/tampering/duplicates, out-of-order authoritative refresh, body/deadline/cancellation bounds, rollback, current authorization, explicit recovery, queue/public privacy and removal retention. Separate pinned backend fixture installs Medusa2.21.2 in an isolated temporary project/database with telemetry disabled. It seeds local products/orders, inspects native Basic Admin GETs/exact major-unit totals, runs the exact operator subscriber artifact, and couples received hints to existing Jobs/scoped projection updates. Order.placed payload is checked against pinned complete-cart source and emitted through the real native event infrastructure; no checkout/payment workflow or payment provider is invoked. This is disposable compatibility proof, not financial or production event-infrastructure certification.

Current work remains in-progress until all exact-SHA hosted checks pass. No live/sandbox provider service, Cloud account, remote registration, provisioning, payment, legal acceptance, main merge, deployment or registry publication is part of verification.

## Remove independently

1. Stop accepting Medusa HTTP work and call `service.stop()` to abort/drain bounded read attempts before unregistering handlers. Stop all workers holding the old registry, or let45s leases expire and explicitly repair retained reads before later reinstall.
2. Remove Medusa job definitions from the app/standalone registry and its app/plugin/routes/page. Retain Jobs/Webhooks if still used; close Medusa resources on app and worker shutdown.
3. Remove the Nuxt module/root dependency and update reference catalog enablement. Keep tables/schema/migrations and bindings/projections/operations/inbox rows/history. Rebuild to prove routes and runtime handlers are absent.
4. Remote bridge deregistration, credential revocation, resource deletion and data-retention policy are separate explicit operator actions. Capability removal never performs them.

The feature journal's contiguous idx8 and coherent snapshot are provisional against the frozen main; SQL prefix0013 is reserved. Parent integration preserves the original eight histories/authored SQL bytes and regenerates combined metadata in Invoice/Stripe/Medusa order. Slot0008 remains unused for SQL; Identity remains separately paused.
