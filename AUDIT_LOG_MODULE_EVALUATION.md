# Audit Log module evaluation

The selected implementation is a small independent Nuxt module with explicit server exports, a reusable Drizzle PostgreSQL table and append/query functions. No API Platform, Jobs, auth library or service dependency is required. Nuxt and Drizzle are peers; applications compose their own database and authentication. The API package's schema-export pattern informed application-owned inclusion/migrations and packed runtime exports, without importing API code.

## Research and decisions (2026-09-30)

Reviewed current official [Drizzle transactions](https://orm.drizzle.team/docs/transactions), [PostgreSQL column types](https://orm.drizzle.team/docs/column-types/pg), [cursor pagination](https://orm.drizzle.team/docs/guides/cursor-based-pagination), PostgreSQL 18 [JSON types](https://www.postgresql.org/docs/current/datatype-json.html), [date/time types](https://www.postgresql.org/docs/current/datatype-datetime.html) and [multicolumn indexes](https://www.postgresql.org/docs/current/indexes-multicolumn.html).

Drizzle transaction callbacks expose the same insert interface and propagate thrown errors to rollback. Therefore append accepts the supplied executor and issues only an insert. JSONB stores validated JSON efficiently, but Drizzle `$type` is compile-time only; recursive runtime validation and serialized byte bounds are essential. PostgreSQL JSONB also rejects invalid database strings/numbers; database errors propagate rather than degrading the audit guarantee.

PostgreSQL timestamptz represents instants and displays according to session timezone. Precision 3 deliberately matches JavaScript Date and cursor ISO strings, avoiding lost microseconds. Application-generated UUID plus createdAt is a deterministic tie-breaker; transaction timestamps can tie. Keyset comparison uses both ordering columns and fetches pageSize+1 instead of OFFSET. It offers continuation, not a snapshot of later concurrent/backdated writes.

B-tree equality constraints on leading columns followed by range/order columns motivate chronological, actor/time/id and subject/time/id indexes. No metadata predicate exists, so no GIN index is justified. Action/outcome filters are bounded exact comparisons; add indexes only after actual workload evidence. No tenant column or authorization model is invented.

## Limits and lifecycle

Append-oriented APIs do not prevent privileged direct SQL changes. The application must enforce access, database roles and retention/privacy policy. Metadata key rejection is defense in depth, not automatic PII/secret detection inside arbitrary values. Consumers must allowlist safe facts. No retention daemon, analytics, SIEM, event sourcing or UI is included.

Root Project mutations commit domain changes and success history together, recording stable user IDs or verified machine credential record IDs only. Application/fixture migrations are explicit and immutable after application. Package/code removal preserves table/history and migrations; dropping a deployed table requires a new explicit destructive migration. Generic catalog-driven package tests own packaging/removal; the fixture owns real PostgreSQL safety/atomicity/query checks.

Production migration verification exposed restrictive checkout permissions: the image now copies committed migration files with ownership for the non-root Node runtime user. This preserves runtime privilege separation and makes history readable without changing migration SQL.

## Verification

Verified frozen Bun installation, agent/catalog validation, all five generic package lifecycle suites (Audit Log, Jobs, API Platform, Observability, Object Storage), strict root lint/typecheck, 41 Vitest tests and two Playwright tests including actual session/machine Project HTTP writes. The PostgreSQL fixture verifies migrations, timestamptz/JSONB/index definitions, deterministic ordering and cursor/filter behavior, atomic domain/audit commit and rollback, rejected metadata and the absence of public update/delete APIs. The shared production image applied migrations to an empty PostgreSQL 18 database and started a healthy application plus worker with startup migrations disabled. Only disposable test databases/stacks were cleaned up.
