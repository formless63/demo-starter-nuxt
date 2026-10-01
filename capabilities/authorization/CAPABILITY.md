# Authorization

Status: in-progress; defaultInstalled:false. `@repo/nuxt-authorization` is a server-only Nuxt module and code-defined policy registry with independent exact-scope PostgreSQL assignments. It imports no Organizations, API Platform, Audit or other capability.

## API and authority

`defineAuthorization(registry, options)` validates at construction: at most256 action IDs (max128, machine grammar with a dot), at most64 role IDs (max64), unique explicit registered action references. No database work or seeding occurs at construction/module/startup. Actions may require a code-owned resource predicate.

The returned asynchronous APIs take an explicit database and trusted context: `can`, `authorize`, `requirePermission`, `listAssignments`, `grantRole`, `revokeRole`; evaluation/permission/grant/revoke have explicit Tx variants. Context carries authenticated userId, exact user/tenant scope, and optional verified machine credential restrictions. User scope must equal the actor; tenant evaluation always requires an authoritative application resolver. No current-user global, cross-request cache, wildcard/global scope, inferred administrator or browser authority exists.

Evaluation unions registered persisted assignments and explicit adapter/code roles, then intersects mandatory resource predicates and credential grants. Unknown/stale roles do not grant. Resource predicates never replace SQL owner/tenant filtering. Missing required resource/adapter denies. Decisions contain only allowed/reason and optional safe errorCode; reasons are allowed, unauthenticated, unknown-action, no-grant, scope-mismatch, resource-denied, error. Operational failure returns false/error and never masquerades as ordinary no-grant. `requirePermission` throws unavailable/timeout for service failure and forbidden for normal authenticated denial.

Management requires an injected trusted management guard; absence forbids. Targets are exact validated scopes/subjects/registered roles. Grant existing and revoke absent are idempotent. IDs are generated UUIDs and timestamps database-owned timestamptz(3). Listing defaults25/max100, ordered createdAt/id descending; cursors are canonical unpadded base64url JSON `[1,createdAtISO,id]`, bounded2048bytes. Reapply scope/subject predicates on every page; a cursor is never an authorization token.

## Transactions and composition

Convenience mutators own exactly one transaction. Tx variants require an actual Drizzle PostgreSQL transaction and never commit/rollback/reconnect/retry it. Capability operations set local statement timeout5000ms and lock timeout2000ms; no shared pool is reconfigured. `forWrite=true` evaluation locks assignment rows for sharing and requests locked membership facts from the injected tenant adapter. Application code must authorize and mutate using that same transaction and appropriate resource row lock or single conditional SQL predicate.

Organizations adapter is application-owned and maps native owner/admin/member to code roles deliberately, rechecking membership even with retained assignments. API Platform adapter first verifies its key/grants/rate limits, then exact-scope user policy; neither roles nor ownership add credential grants. Optional audit callback receives the actual caller transaction and safe assignment identity/action; do not log role lists, grants, request contexts or raw causes.

## Configuration, errors and lifecycle

No new environment variables or policy service. Baseline PostgreSQL/DATABASE_URL is used only on operations. Safe errors expose `{code,message,retryable}` with closed codes configuration, invalid-input, unauthenticated, forbidden, not-found, conflict, timeout, unavailable, unknown. No automatic retries or request memoization are installed.

Enable the private package explicitly in nuxt.config and include `/schema` roleAssignment in application Drizzle schema; generate/review/apply an additive migration explicitly. Nothing migrates or seeds on import/build/startup. Removal removes package/integration/config code and restores explicit root owner checks; preserve assignment tables, rows, indexes and applied migration history. Organizations native administration and API-key restrictions remain independent.

See [the evaluation](../../AUTHORIZATION_MODULE_EVALUATION.md). Isolated-consumer and root verification are pending; this document does not mark completion.
