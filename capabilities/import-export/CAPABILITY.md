# Import / Export

Completed opt-in private `@repo/nuxt-import-export`, native Nuxt module-builder packaging. Hosted CI and integration review remain release gates. [Evaluation](../../docs/evaluations/IMPORT_EXPORT_MODULE_EVALUATION.md).

Requires Jobs and Object Storage. Baseline PostgreSQL, Drizzle and Node 24; optional baseline Authentication. Optional Audit and Notifications adapters belong to the application. Clean consumers explicitly opt in (`defaultInstalled:false`). Installation alone performs no database/provider work.

## Server contract

One application-owned typed registry declares version, exact ordered columns, authoritative Zod schema, fresh trusted-context authorization, transaction-level import callback and ordered snapshot-export reader. Definition names match `[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*`, maximum64; maximum64 definitions. The application creates `{requesterId,scope:{kind:'user'|'tenant',id}}` after authentication and scope verification. Opaque identity IDs are nonempty, at most128 UTF-16 units, no controls. User scope must match requester; tenant selection alone never grants permission. No captured session/role is persisted as authority.

`createTransferService` receives lazy database/Jobs/Storage factories and the registry. `stageImport`, `startImport`, `requestExport`, `getTransfer`, `listTransfers`, `cancelTransfer`, `getExportDownload` use trusted context. No browser key/path/URL/filename/scope is accepted. Transfer IDs/timestamps are generated. Public summaries omit private pointers, payloads and source rows. Request identity is `(requesterId,scopeKind,scopeId,direction,idempotencyKey)`; printable ASCII keys1–128 remain retained with history. Same identity/different fingerprint conflicts. Lists default25,1–100, newest `(createdAt DESC,id DESC)`, canonical unpadded base64url JSON `[1,createdAtISO,id]`, max2048 bytes. Visibility applies on each page; cursor is no authority.

Source staging hashes SHA-256 while reading, bounds bytes, uploads a fresh private key and verifies HEAD size. Source digest/length are rechecked on worker download; ETag is not a hash. Staging/S3 and SQL are not atomic; interrupted uploads may leave receipt/object orphans. `uploading → staged → pending → succeeded|failed|cancelled`; exports start pending. Source/output expiry is assigned at staging/publication completion. Expiry denies access without deleting physical objects.

Start/request own short SQL transactions and use existing Jobs transactional enqueue on the same database. No caller-owned transaction is committed or retried. Queue payload contains only transferId. Existing worker executes five retries after initial,30sec exponential native backoff/max900, expiry timeout+30, retention86400. No second retry loop. Worker rechecks current authority. All import rows validate before a single row-locked application transaction; callback/domain mutations and receipt success commit together. Callback must perform SQL only, never independently commit or perform irreversible external I/O. Duplicate worker attempts may validate concurrently; only a pending locked receipt applies. This is one committed application per transfer, not exactly-once execution or cross-transfer business dedupe.

Exports use a bounded read-only REPEATABLE READ transaction and stable application order, then close SQL before uploading a fresh object. Snapshot time is worker-attempt time; retry may observe a newer snapshot. Under a row lock, fresh authorization, pending state and deadline precede publication. Partial/orphan output receives no URL. Fresh output attempt keys are recorded privately before PUT so selected terminal receipt cleanup can also remove failed-attempt artifacts. Database transaction/statement timeouts are min30sec/remaining attempt; lock timeout ≤5sec. I/O uses actual AbortSignal cancellation and destroys supported streams. Cancellation first persists under the receipt lock; native Jobs cancel is best effort. A committed import can win the lock race; success conflicts and is never undone.

`getExportDownload` rechecks authority and success/expiry, then issues GET TTL min600/remaining lifetime. Remaining <30sec is expired. Revocation prevents a fresh URL; an already issued bearer URL may survive until its expiry. `reconcileTransfer(s)` uses exact recorded queue/job and supported pg-boss APIs under the receipt lock. Success wins; active/created/retry are not failed merely because time elapsed. Native failure/cancellation or missing retained job reconciles terminal status. Explicit root `transfers:reconcile <uuid...>`; no daemon.

`purgeTransferArtifacts(ids,{execute?:boolean})` defaults dry-run and selects at most100 receipts, only terminal or abandoned uploads; no prefix deletion. Explicit `transfers:purge <uuid...> --execute` deletes only selected private pointers and retains domain/history. No automatic retention deletion.

## Configuration and CSV

Server-only lazy settings; undefined/empty defaults, strict decimal integers, no permissive parseInt/exponents:

| Variable | Default | Range |
| --- | --- | --- |
| IMPORT_EXPORT_MAX_BYTES |16777216|1024–67108864|
| IMPORT_EXPORT_MAX_ROWS |10000|1–100000|
| IMPORT_EXPORT_TIMEOUT_SECONDS |60|5–300|
| IMPORT_EXPORT_ARTIFACT_TTL_SECONDS |86400|300–604800|

Fixed limits:64 columns; header64 UTF-16; field65536 UTF-8 bytes; row262144 UTF-8 bytes; cumulative normalized JSON ≤2×max bytes;100 safe issues then errorsTruncated. Fatal UTF-8, optional BOM, comma/double quote, LF/CRLF, quoted multiline; no guessing/compression/workbooks/remote downloads. Exact mandatory header/order; duplicates/unknown/missing/prototype-related names fail. Arrays precede safe-object mapping. No parser conversion/trim. Blank records invalid; final terminator normal; header-only succeeds zero rows. Zod owns semantic conversion; validation issues expose only row ordinal, registered field and closed code, never cells/parser messages.

Export pins csv-parse7.0.3/csv-stringify6.9.0, server only. Header + ordered cells, CRLF/final CRLF/no BOM. Null/undefined empty; booleans true/false; finite numbers JavaScript String. Dates require explicit registered formatter; other objects/nonfinite unsupported. One spreadsheet mitigation prepends one apostrophe to dangerous strings (`=+-@`, TAB/CR/LF, whitespace then operators, fullwidth variants). Actual numbers stay numeric. This deliberately changes strings: CSV is content transfer, not lossless arbitrary-data backup; no spreadsheet import configuration is universally safe.

Root personal Projects columns exactly `name,description`, existing trimmed1–120/0–1000 validator, empty description null. Import create-only, fresh IDs/current owner; no IDs/owner input or updates. Export only that owner's personal Projects, createdAt ASC/id ASC. Reimport creates new Projects. Optional Audit uses the supplied transaction; completion Notifications append there too. No organization sharing.

Errors `{code,message,retryable}` use closed static messages: configuration,invalid-input,unauthenticated,forbidden,not-found,conflict,limit-exceeded,invalid-format,validation-failed,expired,cancelled,timeout,unavailable,execution-lost,unsupported,unknown. Only timeout/unavailable are advisory retryable before terminal completion. Never expose raw causes, SQL, cells, object keys, URLs or environment values in default logs.

## Installation and removal

Install packed private package plus Jobs/Storage and enable all three modules. Include `/schema` transfer table in application Drizzle schema; generate/review/apply additive migrations explicitly alongside Jobs migration. Register `service.runJob` in the existing worker. No migration at setup/build/start/worker. S3 is needed only for use; normal health needs none.

Removal stops producers and drains/preserves pending work, removes routes/UI/application registry handler/package/module/config. Keep Jobs/Storage packages, transfer tables, applied migration files/journal, receipt history and all source/output objects. Explicit operator cleanup is separate; never delete buckets or persistent data as package removal.
