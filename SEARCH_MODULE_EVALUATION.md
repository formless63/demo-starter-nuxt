# Search module evaluation

Search v1 uses PostgreSQL 18 FTS on application-owned domain rows. A stored generated vector plus GIN works with Drizzle ORM 0.45.3 / drizzle-kit 0.31.11, avoiding triggers or an external indexing lifecycle. The package owns reusable query/cursor/error contracts; the root Projects integration owns authorization, schema and migrations. No database client is created by module installation.

## Cross-framework v1 contract

- Explicit FTS configuration: `simple`; weighted `to_tsvector('simple', ...)`, title/name A and body/description B.
- User query: trim, minimum 2, maximum 256 characters; whitespace-only invalid. Only parameterized `websearch_to_tsquery('simple', query)`; never raw tsquery input or interpolated strings.
- Ranking: `ts_rank_cd(vector, query, 32)`.
- Ordering: rank DESC, updatedAt DESC, id DESC, deterministic ties.
- Cursor: versioned canonical bounded validated base64url JSON `[1, rank, updatedAtISO, id]`. Preserve PostgreSQL float4 rank exactly by widening to double and casting the bound cursor back to real. Preserve microseconds using six fractional UTC ISO digits. No encryption, signature, authorization or snapshot claim.
- Pagination: default 25, allowed 1–100; descending keyset with one extra row and nullable nextCursor, no unbounded OFFSET.
- Ownership: application owns owner/tenant authorization predicates. Root Projects always filters the current owner's rows. Stable domain ID, numeric rank and nextCursor; no HTML snippets/highlights.
- No external search service: existing PostgreSQL only. No central search_documents table, pg_trgm, vectors, embeddings, OCR, semantic search or crawlers.

The supplied prompt defines this contract; no other repository or parallel implementation was consulted. JavaScript query bounds count UTF-16 code units. IDs are bounded to 128 characters and cursor payloads to 1024 encoded characters. Queryless punctuation passes validation but PostgreSQL may return an empty tsquery and no results.

## PostgreSQL implementation

```sql
ALTER TABLE project ADD COLUMN search_vector tsvector GENERATED ALWAYS AS (
  setweight(to_tsvector('simple', coalesce(name, '')), 'A') ||
  setweight(to_tsvector('simple', coalesce(description, '')), 'B')
) STORED;
CREATE INDEX project_search_vector_gin_idx ON project USING gin (search_vector);
```

Search matches `search_vector @@ websearch_to_tsquery('simple', $query)` with application owner predicate. Keyset compares `(rank, updated_at, id) < ($rank::real, $updatedAt::timestamptz, $id::text)`. GIN accelerates matching; rank ordering still requires a sort on matching rows. Broad queries may remain expensive; v1 promises bounded output, not bounded scan cost.

## Nuxt-specific differences

Normal private Nuxt module-builder package, explicit module enablement and server export. Nitro exposes only the application-authored authenticated Projects endpoint. Drizzle callers supply a selection callback rather than a package-owned database connection or universal table. The application returns bounded 400/503 `{ error: true, code }` responses directly because its shared Observability error handler intentionally replaces thrown messages. Responses are private/no-store. No additional service/process/worker; Jobs, Storage and Organizations remain optional future relationships.

## Verification

The independent packed consumer creates a disposable database and applies its own committed generated-vector migration twice. It checks PostgreSQL 18, vector/GIN catalog presence, title/body weights, phrases/OR/exclusion, query and page bounds, forgiving syntax, owner isolation, tied and microsecond pagination, exact rank cursor continuation, malformed/canonical cursors, safe actual SQL failure and no console output. Generic lifecycle tooling verifies clean pack/install/typecheck/build/removal. Root integration tests check its committed migrations, real owner-scoped Projects searches and generated vector refresh after writes. CI discovers Search through completed catalog metadata, with no handwritten Search job.

## Official references

- [PostgreSQL 18 tables/indexes](https://www.postgresql.org/docs/18/textsearch-tables.html)
- [PostgreSQL 18 query parsing/ranking](https://www.postgresql.org/docs/18/textsearch-controls.html)
- [Drizzle generated columns, including FTS](https://orm.drizzle.team/docs/generated-columns)
- [Drizzle indexes](https://orm.drizzle.team/docs/indexes-constraints)

Removal preserves domain rows, schema objects and immutable applied migration history. Physical index/column removal needs a new reviewed migration. Safe failures contain only invalid-query/unavailable, and no query text belongs in logs/spans/metric labels.
