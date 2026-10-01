# Search

Private opt-in `@repo/nuxt-search` Nuxt module. PostgreSQL and Drizzle are baseline requirements; no hard capability dependencies. Jobs, Object Storage and Organizations are future optional integrations only. Existing PostgreSQL is the sole external service.

Install the package and explicitly add `@repo/nuxt-search` to Nuxt modules. Import `searchRows`, cursor helpers and types from `@repo/nuxt-search/server`. The module creates no database connection, routes, tables or automatic migrations. Application-owned searchable rows supply their vector, timestamp and stable text ID columns, mandatory authorization SQL predicate and a typed domain selection callback. The callback must honor the supplied where/order/limit plan; the helpers cannot authorize a caller or repair a discarded predicate. Default clean-consumer installation is false; the root reference app explicitly enables it.

Root `searchProjects` and authenticated `GET /api/search/projects?q=planet&pageSize=25&cursor=...` use the current user's owner predicate. Results contain `items` (domain fields, stable ID and numeric rank) and nullable `nextCursor`. No HTML snippets or highlights. The search vector stays out of Search results.

Application schema declares a stored generated `tsvector`:

```sql
setweight(to_tsvector('simple', coalesce(name, '')), 'A') ||
setweight(to_tsvector('simple', coalesce(description, '')), 'B')
```

The committed root migration adds `project.search_vector` and `project_search_vector_gin_idx USING gin (search_vector)`; existing rows are indexed automatically by PostgreSQL. No triggers, pg_trgm or central documents table. Migration is an explicit operator action (`bun run db:migrate`), never module startup.

Trim query; accept 2–256 JavaScript string code units and reject whitespace-only/NUL. Use parameterized `websearch_to_tsquery('simple', query)` and `ts_rank_cd(vector, query, 32)`. Sort rank DESC, updatedAt DESC, id DESC. Default page size 25, bounds 1–100, fetch one extra row, no OFFSET. Cursor is canonical unpadded base64url JSON `[1, rank, updatedAtISO, id]`; maximum 1024 encoded characters, ID 1–128 characters with no controls. Rank is the exact PostgreSQL float4 value widened to a JavaScript double, compared back as `real`. UTC ISO timestamps use six fractional digits to preserve existing PostgreSQL timestamp precision. Unsupported versions, alternate encodings, invalid tuples/dates/ranks and excess bounds are rejected. Cursors are not authorization, encryption, signatures or snapshots; concurrent writes may change results. Reuse a cursor only with the original query and scope.

Errors expose only `invalid-query` or `unavailable`, never SQL, parameter values or cause. The root route returns `{ error: true, code }` with HTTP 400/503 directly so the shared sanitized error handler retains those safe codes; Search responses are private/no-store. Helpers emit no logs/spans/metrics. Applications must avoid raw search text and raw SQL error logging; app telemetry remains optional.

## Removal

Remove the Search route/service imports/calls, module entry, root dependency and reference-app enablement. Remove Search-specific tests when pruning. Keep application rows, generated schema objects and committed migration history. Keep the local generated-column declaration (it has no Search-package dependency). Package removal executes no SQL. Any physical column/index removal requires a new explicit reviewed migration. Reinstall and run catalog/typecheck/build verification. The packed fixture owns a disposable example article table, never a universal application model.

See [evaluation](../../SEARCH_MODULE_EVALUATION.md), [pruning](../../docs/STARTING-A-PROJECT.md) and `bun run packages:test search` for real database and removal checks.
