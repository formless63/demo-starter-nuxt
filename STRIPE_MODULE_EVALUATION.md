# Stripe v1 design and compatibility

Pinned official stripe-node 23.0.0 and API 2026-09-30.endive. Node 24 and Bun operation-local FetchHttpClient instances avoid shared cancellation state. SDK retries and telemetry are disabled. Native official raw-body verification is augmented with strict absolute timestamp checks, including future timestamps. This is not Standard Webhooks.

Local protocol fixtures exercise exact Checkout form encoding and authentication/API headers, native signature rotation and multiple signatures, mode/account/context rejection, unsupported version handling, one transport attempt on provider 500, actual cancellation and bounded response consumption. No Stripe service requests or financial certification.

V1 uses existing customers and one-time registered Price offers, server-approved redirects and hosted checkout.stripe.com URLs only. The application owns scope, binding and callback authorization. Provider metadata and redirects never establish entitlement or payment success. Completion and payment status remain distinct.

Private immutable parameters stay in the ledger, not Jobs. Provider key gs-stripe:<local UUID> is stable. Ambiguous creation is reconciliation_required; no automatic fresh create. Any explicitly permitted same-operation replay must remain strictly inside 23 hours and retain frozen account/mode/parameters. No refund/subscription/Connect/custom metadata/fulfillment implementation.

Receipt and Jobs enqueue share the caller database transaction. Workers retrieve authoritative state outside SQL transactions and use leases/token fencing before committing projections. Removal must stop workers/settle attempts, unregister routes/handlers and remove application wiring while retaining schemas, migrations, bindings, projections, inbox and ledger history; no remote deletion/deregistration/revocation.

Full acceptance remains pending: PostgreSQL commit/rollback/race/recovery/retention, packed lifecycle, reference UI/browser, migrations, production container/health/worker and exact-SHA hosted CI. Remote endpoint API-version configuration is an operator action; SDK pinning does not update it. Stripe CLI/sandbox/account registration/payments are not run.

Primary sources: [SDK pin](https://github.com/stripe/stripe-node/releases/tag/v23.0.0), [API version](https://raw.githubusercontent.com/stripe/stripe-node/v23.0.0/src/apiVersion.ts), [FetchHttpClient](https://raw.githubusercontent.com/stripe/stripe-node/v23.0.0/src/net/FetchHttpClient.ts), [idempotency](https://docs.stripe.com/api/idempotent_requests), [signature verification](https://docs.stripe.com/webhooks/signature).
