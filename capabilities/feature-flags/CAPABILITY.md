# Feature Flags

Status: in-progress; defaultInstalled:false. `@repo/nuxt-feature-flags` is an independent private native Nuxt module with server-only boolean PostgreSQL evaluation. It imports no Organizations, Authorization, Audit or other capability. No environment variables beyond baseline DATABASE_URL, provider service, implicit client projection, management HTTP route, startup fetch/migration/cache/seed or cross-request context exists.

## Public API and definitions

`defineFeatureFlags(options)` returns `evaluateBoolean`, `evaluateBooleanDetails`, `evaluateMany` (at most50 unique keys), explicit `evaluateManyTx`, management `createDefinition`, `updateDefinition`, `setOverride`, `removeOverride`, `listDefinitions`, `listOverrides`, and corresponding mutation Tx APIs. Management requires an injected trusted actor guard; absent guard is forbidden. Optional application audit uses the same actual caller transaction. Browser input never establishes trusted identity/operator authority.

Immutable key ASCII `[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*` max128. Plain description max200; boolean enabled/defaultValue defaultfalse; rolloutBasisPoints nullable/defaultnull or integer0–10000. Revision starts1; each semantic mutation increments it, no-op with current revision preserves it. Update/set/remove require exact expectedRevision; stale revision conflicts without writes. Create duplicate conflicts. No definition deletion, arbitrary JSON/metadata or recursive segments. Targets are exact user/tenant kind and opaque IDs1–128 UTF16 units without C0/DEL controls. No Organizations foreign key or membership/permission meaning.

Owned UTC timestamps are PostgreSQL timestamptz(3), serialized ISO milliseconds. Definition listing default25/max100, newest `(createdAt,key)`; canonical unpadded base64url `[1,createdAtISO,key]`. Override listing newest `(createdAt,targetKind,targetId)`, canonical `[1,createdAtISO,targetKind,targetId,flagKey]` binding the definition. Reject malformed/noncanonical/>2048byte cursors and reapply filters. Management responses are server-only; clients never receive definitions/targets/reasons.

## Evaluation contract

Validate key and trusted context locally; unknown flag false/not-found. Disabled false/disabled wins over all targeting. Enabled: exact tenant override, then exact user override, then rollout with tenant identity preferred over user, then default. No identity with percentage uses default, never randomness. Details contain only value/reason/revision/errorCode. Dependency timeout/outage/malformed definition fails false/error, never stale true or a caller's true fallback.

Canonical rollout bytes are UTF8 of JavaScript `JSON.stringify(['feature-flags-v1',key,kind,id])`; SHA256 first4 bytes unsigned big-endian; `floor(uint32*10000/4294967296)`. No salt/casefold/modulo/Math.random. Golden `beta.dashboard`: tenant-a4307, tenant-b7830, user-a2910, user-b6109. Compare bucket strictly `< basisPoints`; 4307 excludes tenant-a,4308 includes it;0 none,10000 every stable identity. Same key/identity preserves nested cohorts across runtimes/restarts.

`evaluateMany` reads definitions and only relevant overrides in one SQL snapshot, with actual statement timeout1000ms. Management timeout5000ms/lock2000ms, local to an actual Drizzle transaction. Convenience operations own one transaction; Tx variants never commit/rollback/reconnect/retry the caller's transaction. No automatic retry or cross-request cache. Updates are visible to subsequent post-commit authoritative evaluations; in-flight snapshots may reflect earlier state. Safe errors expose static `{code,message,retryable}` codes configuration, invalid-input, unauthenticated, forbidden, not-found, conflict, timeout, unavailable, unknown. No raw cause/target/context/key metric labels or environment logging.

## Installation, reference and removal

Explicit Nuxt registration, `/schema` application composition and reviewed additive migrations are required; installation/startup does not touch the database. Root composition uses an authenticated fixed allowlist endpoint with private,no-store boolean values, re-resolves tenant membership and ignores/aborts stale identity-switch responses. The demonstration `beta.dashboard` is explicitly seeded disabled by a local operator command, never startup. An innocuous extra panel never bypasses normal server authorization.

Remove package/module/schema/client allowlist integration and restore explicit product false defaults, retaining definitions/overrides/indexes/history and all authentication/authorization predicates. See [evaluation](../../docs/evaluations/FEATURE_FLAGS_MODULE_EVALUATION.md). Independent and root release checks are pending.
