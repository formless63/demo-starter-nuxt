# Notifications module evaluation

Use an application-included Drizzle table and the existing Jobs registry/worker. In-app records are authoritative; Email, ntfy and realtime hints are optional delivery integrations. No SMTP duplication, second queue, browser destination configuration or auto-migration.

## Cross-framework v1 contract

The supplied prompt alone defines shared v1; no other repository is consulted. Requires Jobs; integratesWith Email/Realtime/Audit/Observability; baseline PostgreSQL/Drizzle with optional authentication; ntfy optional; defaultInstalled false. Optional capabilities are not package dependencies.

Generated UUID id, recipientId≤128, namespaced lowercase type≤128, plain title≤200, plain body≤4096UTF-8bytes, JSONB metadata default{}, generated createdAt timestamptz(3), nullable readAt timestamptz(3). No caller create override of id/createdAt/readAt or HTML body. Three recipient indexes with createdAtDESC/idDESC, including readAt and type variants.

Metadata: plain root object≤8KiB; depth6,50keys/object,100arrayitems,1024nodes,key64,string1024; reject non-JSON/runtime/accessor/cycle/prototype/control input. Normalize credential-key substrings password/passwd/pwd/secret/token/authorization/cookie/apikey/credential; reject request/session/body/header/headers containers. Errors never expose input.

Server-supplied recipient predicate for query/read/unread. Filters unreadOnly/type, page25 default1–100, newest first keyset cursor canonical base64url `[1, createdAtISO, id]`, no OFFSET. Read/unread idempotent and ownership predicate inside update, owned existence boolean; foreign equals missing. Append accepts DB/tx to atomically mutate domain, append and enqueue Jobs.

Job `notifications.deliver` queues only `{ notificationId, channel }` with email/ntfy channels. Reload durable record and resolve current recipient target per attempt; never queue title/body/recipient/address/topic/token/config. Five retries after initial,30-second exponential/jitter delay capped900,expiry60,retention1day. Transient throws safe retryable; permanent returns terminal rejected. No exactly-once guarantee.

Email is an application adapter calling existing Email once and honoring ambiguity. Optional ntfy native HTTP uses explicit required-on-use NTFY_BASE_URL (no public default), optional secret NTFY_TOKEN, timeout10 seconds1–30. Official JSON root POST, current topic lookup, manual redirects, no response reading/logging. Network/timeout/408/425/429/5xx retry; redirects/other4xx reject. No optional external adapters needed for build/boot.

Only **after commit**, optional `notifications.created` hint contains `{ notificationId }`. Realtime failure cannot roll back committed notifications; clients fetch authoritative records. Audit never automatically copies content/metadata. Telemetry finite operation/channel/outcome/duration/retrycount, never recipient/email/content/metadata/topic/token. Removal stops producers/work, preserves table/data/applied migrations, retains Jobs/other selected capabilities, and never changes ntfy resources.

## Nuxt-specific packaging

Private module uses Jobs peer and moduleDependencies, public `/server` runtime plus `/schema` Drizzle entry. The separate schema export avoids importing the ESM Jobs runtime through Drizzle Kit's schema loader. Schema and SQL inclusion belong to the consumer. Root migration0004 adds only notification table/indexes; pre-existing applied migrations are unchanged. No module routes, startup client or worker duplication.

Native session-authenticated Nitro routes derive recipient from Better Auth. Root worker reloads notifications and current email using lazy PostgreSQL; the application must define its ntfy topic resolver rather than guessing a public topic. Reference producer uses the existing Nitro transactional enqueue API; consumers can use the portable Jobs transaction API. Optional integrations remain application-owned.

## ntfy compatibility and verification

Pinned stable **ntfy2.28.0** runs as a disposable loopback Docker server with temporary SQLite cache, no public publish endpoint. The packed fixture publishes through the actual adapter, polls only its generated test topic to assert official title/message compatibility, then removes its own container. No remote provisioning/removal. Tests also verify status classification, timeout cancellation, response discard and payload privacy.

| Boundary | Proof |
| --- | --- |
| Schema/index/migration | Actual disposable PostgreSQL migration applied twice |
| Domain/notification/enqueue atomicity | Commit/rollback on one Drizzle transaction |
| Ownership/query/read/unread/cursor | Packed consumer DB assertions |
| Metadata/input bounds | Root units and packed boundary checks |
| Job policy/retry/permanent/privacy | Actual pg-boss plus deterministic adapter tests |
| Email ambiguity/current lookup | Existing Email adapter tests and disposable SMTP compatibility |
| Post-commit hints/both transports | Root producer unit tests and Better Auth browser E2E |
| Backendless/removal/data | Generic lifecycle plus independent removal-data witness |

Sources: [official ntfy JSON publish/authentication](https://docs.ntfy.sh/publish/), [ntfy2.28.0 release](https://github.com/binwiederhier/ntfy/releases/tag/v2.28.0), existing [Jobs](capabilities/jobs/CAPABILITY.md), [Email](capabilities/email/CAPABILITY.md) and [Audit](capabilities/audit-log/CAPABILITY.md) contracts. Canonical install/config/removal: [capability contract](capabilities/notifications/CAPABILITY.md).

Delivery preparation checks the native Jobs cancellation signal before loading and races record/current-target resolution, handling late rejection without late SMTP. A composed 50-second safety deadline settles terminally before the 60-second Jobs expiry. Once SMTP begins, cancellation cannot undo acceptance; the underlying operation may finish after the wrapper returns rejected, with no retry from that terminal result. Unknown adapter failures are terminal; only explicit safe typed transient errors retry. Pre-delivery application loading retries only known connection/serialization failures. External delivery remains subject to worker crash/claim loss and cannot promise exactly once. ntfy network/deadline retry can duplicate an accepted publication. Jobs output contains only allowlisted outcome/code, never provider extras.

The generic Notifications lifecycle retains its disposable database through packed removal and final rebuild, then compares notification rows/indexes/applied migration history and Jobs schema before cleanup in finally. Root check and ordinary production verification also run actual disposable Mailpit compatibility.

Contract alignment: create and supplied list filters share strict lowercase dot-separated type validation; undefined means no filter. Titles use JavaScript string length ≤200, require non-whitespace text and preserve markup-looking characters for escaped rendering. Metadata keys are nonempty and ≤64, retained verbatim including whitespace, with existing structural/privacy/depth/size checks. Typed Email retryable pre-send connection and temporary-rejection errors retry; timeout/reset/unknown/partial outcomes and wrapper cancellation after invocation remain terminal. Shared source/distributable/packed-runtime vectors and composed Jobs tests cover these boundaries. Compose defaults worker concurrency to the canonical 4 and preserves explicit overrides.
