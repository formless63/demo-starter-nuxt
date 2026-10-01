# Webhooks capability

`@repo/nuxt-webhooks` is a private Nuxt 4 package, explicitly selected by consumers (`defaultInstalled: false`). The root reference app enables it deliberately. It requires **Jobs**; `requires: ["jobs"]`, the Jobs peer (`>=0.1.0 <0.2`) and Nuxt 4 `moduleDependencies` enforce that relationship. Install both packages and supply the consumer-owned Jobs registry. Audit Log, Observability and API Platform are optional integration patterns with no imports/dependencies.

The package root is the Nuxt module; `/server` exports server-only helpers. The module adds imports only, with no routes, UI, endpoint CRUD, subscriptions, router, worker or database table. It uses the existing Jobs worker and explicit pg-boss migration. Remote endpoints are required only for real outbound use; build, boot and health require no target configuration. See [evaluation](../../WEBHOOKS_MODULE_EVALUATION.md).

## Installation and API

Install `@repo/nuxt-jobs` and `@repo/nuxt-webhooks` (currently `workspace:*` internally or both packed tarballs externally), plus compatible Nuxt 4/Zod/Drizzle peers. Explicitly list both modules. `moduleDependencies` can register Jobs if omitted, but cannot install its npm package or create the application registry. Keep application secrets and target selection server-only.

```ts
import { z } from 'zod'
import { defineJobRegistry } from '@repo/nuxt-jobs/server'
import { createWebhookEvent, createWebhookJobs, defineWebhookEvents } from '@repo/nuxt-webhooks/server'

const events = defineWebhookEvents({ 'order.created': z.object({ orderId: z.string() }).strict() })
const webhooks = createWebhookJobs({ events, resolveTarget: ref => lookupCurrentTarget(ref) })
export const jobRegistry = defineJobRegistry(existingJob, webhooks.delivery)
const event = createWebhookEvent(events, 'order.created', { orderId: '123' })
await sendJob('webhooks.deliver', webhooks.prepare('trusted-target-ref', event))
```

`resolveTarget(targetRef, signal)` returns `{ url, secret }` on every execution. Throw a safe nonretryable `WebhookError` for absent/disabled targets; unknown exceptions become safe retryable resolution errors. Jobs validates a strict payload `{ targetRef, id, type, body }` before enqueue and execution. Never put URLs, secrets or auth headers into it. Authorization, mapping an event to targets and transactional application writes are application responsibilities. Use Jobs `sendJobInTransaction` for atomic writes/enqueue. Register lowercase event names matching `^[a-z][a-z0-9._-]{0,127}$` with Zod; validators should be pure and deterministic across enqueue/execution, and accept their own JSON output (avoid non-idempotent transforms).

The stable JSON envelope is `{ id, type, createdAt, data }`, with a generated UUID and UTC ISO timestamp. It is serialized once; retries reuse exactly the same UTF-8 bytes and ID. A fresh attempt timestamp and current signing secret are used each time. Default direct body bound is 64 KiB; configurable up to 1 MiB. Jobs-backed delivery stays capped at 64 KiB. Schema output must itself be JSON-safe: Date/class/function/undefined, sparse/custom arrays and accessors cannot be silently coerced or discarded. Inbound helpers return the registered schema output only after authentication; the queued/signed body is never rewritten.

## Signing and delivery

HMAC-SHA256 signs `webhook-id.webhook-timestamp.raw-body`, with `v1,<base64>` signatures. Secrets are standard base64 with optional `whsec_` prefix, 24–64 decoded bytes; generate random per-endpoint secrets (32 bytes recommended). Outbound uses one current secret. Inbound accepts 1–8 secrets and multiple space-delimited signatures, using Node `timingSafeEqual`.

Native Node 24 fetch sends POST with redirects disabled. 2xx succeeds; network/timeout/408/425/429/5xx retries; other statuses (including redirects and normal 4xx) are permanent. Response bodies are cancelled without reading **any** bytes, never exposed or logged. Target resolution/policy/fetch share a bounded timeout (10 seconds default, 100 ms–30 seconds configurable), and the Jobs cancellation signal is composed with it. Resolvers/policies should honor the provided abort signal.

Defaults: 5 retries after the first attempt, 30-second delay, exponential pg-boss jitter/backoff capped at 900 seconds, 60-second job execution expiry, one-day completed retention (`deleteAfterSeconds`); existing seven-day queued retention (`retentionSeconds`) remains independent. Retry count can be 0–20 and initial delay 1–900 seconds. Options live in the definition's `send` contract, so enqueue overrides queue defaults. Existing Jobs queue creation semantics do not update existing queues; send options keep these delivery bounds explicit. Permanent rejection returns `{ outcome: 'rejected', code, status? }` and pg-boss marks it completed; applications must inspect business outcomes separately from scheduler success. Retry exhaustion produces pg-boss failed state with only safe error fields. `Retry-After` is not used; no remote-controlled scheduler delay is introduced. Every deliberate outbound enqueue may create delivery work; retained pg-boss IDs provide no scheduler-level duplicate suppression. Applications own domain/outbound idempotency in durable transactional state. Delivery remains at least once; a timeout can occur after a receiver accepted a request.

## Target safety

HTTPS is the default. URL parsing rejects credentials/fragments/local names and obvious loopback/private/link-local IP literals (including canonicalized numeric IPv4 and IPv4-mapped IPv6). DNS names are **not** resolved or pinned: this is not DNS rebinding protection. For user-configured endpoints, add `targetPolicy.validate(url, signal)` to enforce application allowlists/DNS rules and network egress restrictions. The callback receives a copy; it cannot mutate the validated destination. `allowLocalHttp: true` explicitly relaxes HTTP/private/local restrictions for trusted fixture receivers only; credentials/fragments remain rejected. Never enable it for untrusted targets.

## Inbound and durable handoff

Applications choose their native Nitro route and pass `toWebRequest(event)` from h3 **before any body parser**:

```ts
const verified = await verifyWebhookRequest(toWebRequest(event), {
  events, secrets: [currentSecret, retiringSecret],
})
await handoffWebhook(verified, (event, tx) =>
  sendJobInTransaction(tx, 'application.process-webhook', event), durableIdempotency)
```

`verifyWebhookRequest` checks Content-Length and actual stream bytes, bounds read time, verifies exact bytes and strict Unix timestamp within 300 seconds (configurable 1–900), then parses fatal UTF-8/JSON and validates the registered envelope. Body ID must match the authenticated header. A consumed body is rejected. Catch `WebhookError` at the application edge and return a safe status; never expose raw errors or signed material.

Timestamp tolerance permits replay inside its window. `WebhookIdempotency<Transaction>.runOnce(id, operation)` is an explicit **application-implemented durable** interface; `runOnce` passes the claim transaction/context into `operation`, and `handoffWebhook` passes verified work through it and returns its duplicate/result outcome. Implement an atomic unique ID claim scoped by trusted receiver/source/tenant, sufficient retention for retry/manual-redelivery horizons, rollback on failure and one transaction coupling claim to work/Jobs enqueue. An in-memory set is insufficient. Jobs singleton windows cannot prove permanent idempotency, so no webhook events table or false built-in exactly-once guarantee is provided. The fixture demonstrates verification and Jobs handoff, not durable replay storage.

## Optional integration and privacy

Application wrappers may instrument registered event type, direction, outcome, HTTP status, duration and attempt. Never emit URL, payload/body, signature, secret, event ID or underlying exceptions. Audit/API/Observability wrappers belong to the application and are optional. No Audit implementation or dependency is added.

## Verification and removal

`bun run packages:test webhooks` packs Webhooks **and catalog hard dependencies**, installs a clean external fixture, builds/typechecks, migrates Jobs, runs its standalone worker and a local receiver, verifies signed bytes/inbound Nitro handoff, retry success/exhaustion and permanent rejection. It then removes Webhooks files/module/dependency, clears generated state and rebuilds while retaining Jobs and its registry. `bun run webhooks:smoke` explicitly runs the local receiver through Jobs in the reference worktree. Neither needs external endpoints.

Remove the Nuxt module, workspace dependency, application event/target registry, Webhooks delivery definitions/calls, route/config and smoke alias. Drain or deliberately cancel pending webhook delivery work first. Keep `@repo/nuxt-jobs`, its remaining registry/tasks, worker and migrations. Clear generated state, reinstall and rebuild. Never delete generic Jobs schema/history or alter external endpoints automatically. See [root removal recipe](../../docs/STARTING-A-PROJECT.md#remove-webhooks).
