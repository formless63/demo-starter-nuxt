---
name: import-export-change
description: Changing durable CSV transfer validation, staging, transactions, cancellation, export publication, retries, reconciliation or cleanup.
---
# Import / Export maintenance

Read [the canonical contract](../../../capabilities/import-export/CAPABILITY.md), evaluation and capability-change workflow before edits.

- Never treat requester/scope/cursor/active organization/browser object pointers as authorization. Resolve current permission in worker/apply/publication/download.
- Bound bytes/rows/fields before buffering; parser arrays and authoritative ordered headers precede safe mapping. Keep fatal UTF-8, exact format and one formula mitigation; never log cells or raw parser issues.
- Validate everything before one locked SQL import callback. Callback must reuse the supplied transaction; no independent commits or irreversible external I/O. Producer enqueue and receipt share the same database transaction.
- Preserve native domain timestamp precision in export keysets; never round PostgreSQL microseconds through JavaScript Date. Check final formula-mitigated field bytes, including the added apostrophe.
- Snapshot export closes SQL before S3. Fresh opaque keys only; pointer publication rechecks locked pending/current authority/deadline. No partial export URL or cross-S3/SQL atomicity claim.
- Keep native Jobs retries, known final-attempt metadata and supported exact job reconciliation. Receipt success wins; shutdown is not user cancellation. Persist user cancel under the row lock before best-effort abort.
- Add migrations; never alter applied SQL/hashes/timestamps/history. No schema/provider work at import/build/start/worker start.
- Removal retains transfer receipts/domain data/objects/migrations/Jobs/Storage. Explicit selected dry-run-first cleanup is separate. Preserve all generic lifecycle gates and run both real providers plus Node24 worker/browser/release checks.
