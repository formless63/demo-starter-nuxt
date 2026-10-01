# Import / Export evaluation

Status: in-progress, not release accepted. Canonical API/lifecycle contract is [CAPABILITY.md](capabilities/import-export/CAPABILITY.md). No sibling repository was consulted.

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
