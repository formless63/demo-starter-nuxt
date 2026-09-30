# Audit Log

`@repo/nuxt-audit-log` is an optional server-only Nuxt package for append-oriented application audit events. PostgreSQL and Drizzle are required; authentication integration is optional. `requires: []`; API Platform, Organizations, Jobs, Invoice Ninja, Stripe and Medusa are optional consumer integrations. There are no moduleDependencies or capability runtime dependencies.

## Installation and schema

Keep the workspace dependency and add `'@repo/nuxt-audit-log'` to Nuxt `modules`. Import/export `auditEvent` from `@repo/nuxt-audit-log/server` in the application's Drizzle schema. Generate, review and commit the application's migration; apply it explicitly before runtime. The module never connects to a database or changes schema. Nuxt 4 and Drizzle >=0.45 <1 are peers. The packed fixture includes this schema and independent committed migration.

The table uses application-generated UUIDs, millisecond-precision timestamptz, bounded varchar fields and JSONB metadata. There are no tenant/organization columns, foreign keys to actor/subject tables or cascading history deletion. Chronological, actor and subject B-tree indexes include descending createdAt/id. Action/outcome/time filters use these indexes where applicable; no speculative JSONB GIN/full-text index exists.

## Transaction contract

```ts
import { appendAuditEvent, queryAuditEvents } from '@repo/nuxt-audit-log/server'
await db.transaction(async (tx) => {
  const [record] = await tx.insert(project).values(input).returning()
  await appendAuditEvent(tx, {
    actorType: 'user', actorId: user.id, action: 'project.created',
    subjectType: 'project', subjectId: record.id, outcome: 'success',
  })
})
const page = await queryAuditEvents(db, {
  actor: { type: 'user', id: user.id }, pageSize: 50,
})
```

`appendAuditEvent(txOrDb, event)` issues one insert on the supplied executor, never a hidden transaction/connection. Await it inside the same transaction as the domain write; validation or insertion failure propagates so both writes roll back. Passing a database directly is appropriate for standalone events. IDs/time are package-generated and cannot be overridden. There is no update/delete/retention public API; direct application SQL remains technically possible. This is append-oriented, not tamper-proof storage or event sourcing. Database roles/administrative access and read authorization remain application/operator responsibilities.

Root Project create/update/delete share the transaction with success events. Missing/cross-owner writes produce no success event. Session calls record `user` plus stable user ID. The existing verified machine route passes `machine` plus credential record ID; no raw credential, principal object or request body is copied. Read operations are not audited.

## Data safety and queries

String limits: actor type/outcome 32, action/actor ID/subject ID/request ID 128, subject type 64. Empty strings and control characters are rejected. Metadata must be a plain JSON object: depth <=6, <=50 keys/object, <=100 items/array, <=1,000 nodes, keys <=64 characters, strings <=1,024 characters and serialized UTF-8 <=16 KiB. Values must be finite JSON primitives, dense arrays or plain objects. Errors, class/Date instances, cycles, undefined, symbols, functions, accessors and non-enumerable/custom properties are rejected. Rejected data is never echoed in errors.

Keys are checked recursively with case/separator-insensitive password/passwd/pwd, secret, token, authorization, cookie and apiKey variants, including accessToken, refreshToken and clientSecret. Raw request/session/body/header containers are also rejected. Key checks cannot detect a secret or PII disguised under an innocent key: deliberately allowlist metadata values and prefer stable IDs. Never copy arbitrary request, session, body, headers or exception objects. Do not store names, emails, credentials or unconstrained free text.

`queryAuditEvents` returns `{items, nextCursor}` newest first by `(createdAt DESC, id DESC)`, defaults to 50 and rejects page sizes outside 1–100. Filters are exact actor/subject type and optional ID, action/outcome and inclusive `from`/exclusive `until` Dates. Pass the opaque versioned cursor back unchanged with the same filters. Cursors are bounded/validated base64url, not encrypted, signed, snapshots or authorization. There is no arbitrary SQL or full-text search. Applications authorize queries and should apply their actor/subject filters server-side; filtering is not an Organizations/Authorization capability.

## Removal and operations

Remove module/dependency, schema imports/export and application append/query integrations; retain applied SQL migrations, journal/snapshots and existing audit table/history by default. Do not run `db:generate` after removing the schema export unless the resulting table drop is deliberately reviewed and excluded or replaced by a retained local schema definition. A deployed table drop requires a new explicit destructive migration. Package removal never authorizes data destruction. No retention daemon exists: retention policy, archival, privacy deletion and privileged maintenance require an explicit application/operator decision and separately reviewed migration/process.

The generic `bun run packages:test audit-log` installs the packed package, typechecks/builds, migrates a disposable PostgreSQL database, checks inserts/indexes/ordering/filters/cursors/transaction commit and rollback/safety, removes package imports and module registration, preserves committed fixture migrations and proves the remaining application typechecks/builds. Disposable test database cleanup is not a deployed retention strategy. There is no Audit-specific root CI job, UI, SIEM, analytics, Organizations or Authorization.
