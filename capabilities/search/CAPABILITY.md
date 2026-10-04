# Search

Private opt-in `@repo/nuxt-search` Nuxt module. PostgreSQL and Drizzle are baseline requirements; no hard capability dependencies. Jobs, Object Storage and Organizations are future optional integrations only. Existing PostgreSQL is the sole external service.

Install the package and explicitly add `@repo/nuxt-search` to Nuxt modules. Import `searchRows`, cursor helpers and types from `@repo/nuxt-search/server`. The module creates no database connection, routes, tables or automatic migrations. Application-owned searchable rows supply their vector, timestamp and stable text ID columns, mandatory authorization SQL predicate and a typed domain selection callback. The callback must honor the supplied where/order/limit plan; the helpers cannot authorize a caller or repair a discarded predicate. Default clean-consumer installation is false; the root reference app explicitly enables it.

Root `searchProjects` and authenticated `GET /api/search/projects?q=planet&pageSize=25&cursor=...` use the current user's owner predicate. Results contain `items` (domain fields, stable ID and numeric rank) and nullable `nextCursor`. No HTML snippets or highlights. Explicit domain projections keep the search vector and future internal columns out of Search and existing human/machine CRUD responses, preserving each existing response contract.

Application schema declares a stored generated `tsvector`:

```sql
setweight(to_tsvector('simple', coalesce(name, '')), 'A') ||
setweight(to_tsvector('simple', coalesce(description, '')), 'B')
```

The committed root migration adds `project.search_vector` and `project_search_vector_gin_idx USING gin (search_vector)`; existing rows are indexed automatically by PostgreSQL. No triggers, pg_trgm or central documents table. Migration is an explicit operator action (`bun run db:migrate`), never module startup.

Trim query; accept 2–256 UTF-16 code units and reject whitespace-only/NUL/lone surrogates. Use parameterized `websearch_to_tsquery('simple', query)` and `ts_rank_cd(vector, query, 32)`. Sort the PostgreSQL real rank DESC, updatedAt DESC, id DESC. Default page size 25, bounds 1–100, fetch one extra row, no OFFSET.

Cursor is canonical unpadded base64url of UTF-8 JSON `[1, rankNumber, updatedAtISO, id]`, exactly four elements and version 1, at most 2048 encoded ASCII characters. Both encoders and decoders enforce the same contract and a byte-identical JSON/base64url round trip. Rank must be a finite JSON number in [0, 1], not negative zero, with `Math.fround(rank) === rank`. Produce it with `ts_rank_cd(..., ..., 32)::double precision` (or `Math.fround(Number(realRankText))` for PostgreSQL real text); return that same widened float4 number in results, without display rounding. Compare the bound continuation rank as `::real` against the original `ts_rank_cd(..., ..., 32)` expression.

IDs remain opaque and byte-for-byte unchanged: 1–128 UTF-16 code units, no trimming/normalization, no Unicode Cc controls (NUL, DEL and C1 included), no lone surrogates. Timestamps are exactly `YYYY-MM-DDTHH:mm:ss.ffffffZ`, with valid calendar/time and year 0001–9999. All six fractional digits are preserved without Date conversion. Unsupported versions, rank strings/rounded non-float4 numbers, invalid UTF-8/Unicode, padding/whitespace/alternate encodings, extra fields and excess bounds are rejected as `invalid-query` before database access. Pre-release rank-string tokens are invalidated; there is no permanent dual codec. Cursors are not authorization, encryption, signatures or snapshots; concurrent writes may change results. Reuse a cursor only with the original query and scope.

Golden tuple `[1,0.2857142984867096,"2026-01-01T00:00:00.000001Z"," Ω界😀 "]` encodes as `WzEsMC4yODU3MTQyOTg0ODY3MDk2LCIyMDI2LTAxLTAxVDAwOjAwOjAwLjAwMDAwMVoiLCIgzqnnlYzwn5iAICJd`. PostgreSQL real text `0.2857143` widens via `Math.fround` to that number (real hex `3e924925`).

Errors expose only `invalid-query` or `unavailable`, never SQL, parameter values or cause. The root route returns `{ error: true, code }` with HTTP 400/503 directly so the shared sanitized error handler retains those safe codes; Search responses are private/no-store. Helpers emit no logs/spans/metrics. Applications must avoid raw search text and raw SQL error logging; app telemetry remains optional.

## Removal

Remove the Search route/service imports/calls, module entry, root dependency and reference-app enablement. Remove Search-specific tests when pruning. Keep application rows, generated schema objects and committed migration history. Keep the local generated-column declaration (it has no Search-package dependency). Package removal executes no SQL. Any physical column/index removal requires a new explicit reviewed migration. Reinstall and run catalog/typecheck/build verification. The packed fixture retains an independent disposable example article database through package removal and the final post-removal typecheck/rebuild. Generic optional `postRemovalScript` and `cleanupScript` hooks verify exact rows, generated vector, GIN and immutable migration hashes before teardown, including failure cleanup. No table is destroyed to simulate a SQL failure. Root upgrade regressions apply the unchanged pre-Search migrations to existing rows, then the committed Search migration, proving domain and prior-hash preservation.

See [evaluation](../../docs/evaluations/SEARCH_MODULE_EVALUATION.md), [pruning](../../docs/STARTING-A-PROJECT.md) and `bun run packages:test search` for real database and removal checks.
