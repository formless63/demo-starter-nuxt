# Import / Export evaluation

Status: in-progress, not release accepted. Canonical API/lifecycle contract is [CAPABILITY.md](../../capabilities/import-export/CAPABILITY.md). No sibling repository was consulted.

## Dependency selection

Rechecked official upstream stable changelogs on2026-10-01: [CSV Parse7.0.3](https://github.com/adaltas/node-csv/blob/master/packages/csv-parse/CHANGELOG.md), [CSV Stringify6.9.0](https://github.com/adaltas/node-csv/blob/master/packages/csv-stringify/CHANGELOG.md), September25 entries. Exact server-only package pins; existing pg-boss12.35.0/AWS SDK3.1143.0 retained. Fixtures reuse pinned PostgreSQL18/RustFS1.0.0/Garage2.4.1 protocol services. Package metadata is not a passed Node24/Bun runtime test.

## Cross-framework v1 contract

The dispatch packet defines the shared observable v1 contract. Requires Jobs/Storage, optional application Notifications/Audit; PostgreSQL/Drizzle/Node baseline, Authentication optional integration. Trusted exact requester+scope, opaque identities, generated UUID receipts, bounded fatal-UTF8 strict CSV, one formula function, durable request identity, one committed import application, snapshot export, explicit cancellation/expiry/reconciliation/cleanup, no startup I/O/schema mutation. Server transport is native Nitro and the only durable execution engine is existing Jobs.

Import receipt/S3 staging is explicitly non-atomic. Domain writes+terminal receipt and producer receipt+Jobs enqueue are same-database SQL atomic. Export transaction closes before S3 upload; pointer publishes only after fresh permission/locked pending checks. Removal preserves records/objects/migration history/dependency packages. CSV round-trip creates fresh personal Projects and intentionally changes formula strings. Already issued GET bearer URLs survive revocation until expiry.

## Verification

Release acceptance requires targeted regressions, both real storage providers, generic packed clean consumer install/runtime/removal/rebuild, all completed capability lifecycles, root checks, development/production browser checks, production image/app/explicit migration/worker/health checks, and exact-final-head hosted CI. Run-specific evidence belongs in the draft PR. This document makes no unrun verification claim.

### Database timeout ordering

[PostgreSQL18 documents](https://www.postgresql.org/docs/18/runtime-config-client.html) that transaction_timeout ≤ statement_timeout suppresses the longer statement timeout. Keep transaction timeout within min30sec/remaining budget and statement timeout500ms shorter, reserving time for safe rollback. This avoids relying on a terminated session for normal long-query cancellation; the transaction limit still bounds paused transactions. Drizzle can wrap driver SQLSTATE in cause; classification walks a bounded cause chain without exposing messages/SQL/values.

Worker receipt resolution and current authorization run in a deadline-bounded PostgreSQL transaction before Storage acquisition. Final-error housekeeping has separate short database bounds; a lost catch remains recoverable through explicit reconciliation. Executing selected artifact cleanup expires its download permission before physical deletion, retaining receipt pointers and the attempt ledger for inspection or cleanup retry.

### Export boundary regressions

The root personal Project reader carries a native UTC microsecond timestamp string in its keyset boundary and casts it back to timestamptz for the next page. Baseline Project timestamp precision is retained; transfer-owned timestamps remain milliseconds. The actual root reader regression covers253 rows,250 tied microsecond timestamps, adjacent microseconds, ID ordering and exact termination. CSV field bounds apply after the single formula mitigation so its apostrophe counts toward65536 UTF-8 bytes; boundary vectors include multibyte strings and unchanged numeric negatives. Removal witnesses retain both source/output SHA-256 digests and compare the exact native job via supported Jobs APIs after actual removal and final rebuild.

CSV boundary coverage includes lone CR/LF data cells, unchanged trusted formula-like headers, exact header rejection and actual personal Project export/reimport. Deadline SQL always uses a strictly smaller statement timeout, rejecting a remaining budget below2ms instead of disabling/suppressing the statement bound. Attempt-owned transactions preserve an observed safe timeout if driver rollback replaces its cause. Native-worker coverage uses the real30sec SQL cap with90sec total budget, asserts complete rollback/pending native retry, and safe terminal timeout only with genuine exhausted metadata; no hidden retry loop.
