---
name: webhooks-change
description: Changing webhook raw-body verification, signing, durable delivery, retry classification, target policy, replay handoff or privacy boundaries.
---

# Webhooks change workflow

Read the capability-change workflow, `capabilities/webhooks/CAPABILITY.md`, `WEBHOOKS_MODULE_EVALUATION.md` and Jobs contracts.

1. Preserve explicit Nuxt opt-in and the hard Jobs edge in catalog/module/peer metadata. Compose definitions into the existing Jobs registry; never add another worker/router or implicit routes.
2. Authenticate exact raw bytes before JSON parsing. Bound Content-Length, actual bytes and read duration. Use constant-time HMAC comparison, Standard Webhooks ID/timestamp/signature headers, strict timestamp syntax and bounded rotation secrets. Keep IDs and timestamps free of dots.
3. Serialize the outbound envelope once before enqueue; retries reuse the body and ID, refresh attempt timestamp and resolve current endpoint secret at execution. Queue no URLs, secrets, auth headers or unrelated transport fields.
4. Keep shared defaults: 64 KiB body (1 MiB maximum), 10-second read/delivery timeout (100 ms–30 seconds), timestamp tolerance 300 seconds (900 maximum), five retries, 30-second initial delay and exponential backoff capped at 900 seconds. Keep pg-boss migration explicit, bounded retries/backoff, and runtime migrate:false. Throw only sanitized retryable errors; permanent rejection is a terminal business outcome because Jobs retries every thrown handler failure.
5. Default to HTTPS; reject credentials, fragments, local names and private/link-local/loopback IP literals. Disable redirects. App policies must address DNS/egress and user-configured destinations; do not claim DNS rebinding protection from string checks.
6. Timestamp checks alone cannot prevent replay inside tolerance. Require an application durable atomic idempotency hook for exactly-once acceptance, with tenant/source scoping, adequate retention and a transaction coupling the ID claim to application work/Jobs enqueue. Jobs singleton windows are not durable replay storage. Remote execution remains at least once.
7. Never log or attach body, URL, secret, signature, event ID or raw exceptions. Optional application telemetry may use registered event type, direction, outcome/status, duration and attempt only. Audit/API/Observability remain optional without package imports.
8. Run the packed fixture and Webhooks smoke, security/interoperability tests, Jobs regression, normal checks and production image/worker startup without external targets. Removal retains Jobs schema/history and external endpoints.
