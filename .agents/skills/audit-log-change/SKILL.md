---
name: audit-log-change
description: Changing application audit events, metadata validation, query cursors, audit schema or history lifecycle.
---
# Audit log change

Read `capabilities/audit-log/CAPABILITY.md` and `AUDIT_LOG_MODULE_EVALUATION.md`. Use capability-change for package contracts and database-migration for schema/index changes.

- Await appendAuditEvent on the caller's existing Drizzle transaction alongside domain writes. Never create a hidden independent transaction/connection; test both commit and rollback on PostgreSQL.
- Preserve append-oriented events and stable actor/subject IDs. Never add public update/delete APIs or claim tamper-proof history. No actor/subject FK may cascade-delete history.
- Bound all strings and JSON metadata bytes/depth/nodes/keys/arrays. Reject Error/class instances, unsupported JSON, accessors and secret-key variants recursively. Error messages must not echo rejected data.
- Deliberately allowlist metadata; never copy request/session/body/headers/principals. Prefer stable IDs over names/emails or other PII. Record verified machine credential record IDs, never raw keys.
- Keep read authorization app-owned. Preserve bounded exact filters and deterministic createdAt/id keyset pagination; no arbitrary SQL/full-text query API.
- Applications own schema inclusion and explicit committed migrations. No startup schema mutation. Preserve deployed table/history and applied migrations on code/package removal. Any deployed drop needs a new explicit destructive migration.
- Retention, archival and privacy deletion are explicit application/operator policies. Do not introduce an automatic retention daemon or incidental cleanup of real history.
- Verify packed install/query/rollback/removal with generic packages:test audit-log, root Project integration, relevant regressions and the production migration/container path.
