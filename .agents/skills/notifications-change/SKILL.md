---
name: notifications-change
description: Changing persistent notifications, recipient-scoped queries/read state, transactional delivery enqueue, ntfy or optional Email/realtime notification integrations.
---

# Notifications change

Read `capabilities/notifications/CAPABILITY.md`, `docs/evaluations/NOTIFICATIONS_MODULE_EVALUATION.md`, Jobs transaction API and Email/Audit contracts. Apply `capability-change`, `jobs-change` and `database-migration` when applicable.

- Jobs is the only hard capability edge. Keep optional Email/Realtime/Audit/Observability application-owned. Package exports schema; application owns inclusion/SQL/migrations and session routes. Never migrate at startup or contact optional services on boot.
- Create owns UUID/createdAt/unread state; metadata/input bounds reject secret keys/runtime objects/accessors/control strings. No automatic copying of notification title/body/metadata into Audit or logs. Plain text only in v1.
- Server-supplied recipient predicates belong in every browser query/update. Foreign IDs equal missing. Read/unread idempotent. Default page25,1–100, timestamp/idDESC canonical versioned base64url keyset; no OFFSET.
- Domain mutation/notification/Jobs enqueue must share caller transaction. Payload only notificationId/channel (email/ntfy); worker reloads record and current target. Five retries after initial,30sec exponential/jitter cap900,expiry60,retention1day. Throw only safe transient; permanent returns rejected because thrown handlers retry.
- Email adapter uses existing Email once. Honor partial/ambiguous/non-retryable delivery; do not duplicate SMTP or blindly retry uncertain sends.
- ntfy explicit server root/no public default, optional Bearer secret, timeout10sec1–30, topic resolved at execution, official JSON root POST/manual redirects. Retry network/timeouts/408/425/429/5xx, reject other4xx/redirects. Never consume/log response bodies or queue topic/token/config.
- Realtime ID-only hint only after commit; failure leaves durable state committed. Telemetry finite operation/channel/outcome/duration/retry count only.
- Verify actual PostgreSQL/Jobs atomic commit/rollback, ownership/read/unread/cursor, current stable disposable local ntfy, optional Email and post-commit hints, backendless boot and `bun run packages:test notifications`. Data/migration witness runs `.fixture/removal-data.ts` around the generic lifecycle.
- Removal stops producers/delivery, preserves notification table/data/applied migrations and retains Jobs/other selected capabilities. Never modify remote ntfy resources.

Delivery preparation checks the native Jobs cancellation signal before loading and races record/current-target resolution, handling late rejection without late SMTP. A composed 50-second safety deadline settles terminally before the 60-second Jobs expiry. Once SMTP begins, cancellation cannot undo acceptance; the underlying operation may finish after the wrapper returns rejected, with no retry from that terminal result. Unknown adapter failures are terminal; only explicit safe typed transient errors retry. Pre-delivery application loading retries only known connection/serialization failures. External delivery remains subject to worker crash/claim loss and cannot promise exactly once. ntfy network/deadline retry can duplicate an accepted publication. Jobs output contains only allowlisted outcome/code, never provider extras.

The generic Notifications lifecycle retains its disposable database through packed removal and final rebuild, then compares notification rows/indexes/applied migration history and Jobs schema before cleanup in finally. Root check and ordinary production verification also run actual disposable Mailpit compatibility.
