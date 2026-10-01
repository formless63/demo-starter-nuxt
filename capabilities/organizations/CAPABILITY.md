# Organizations / Tenancy

Status: **in progress; launch compatibility gate blocked**. No Organizations package, root plugin, routes or schema migration is enabled by this checkpoint. Existing Authentication, Projects and machine credential behavior is unchanged.

The intended private opt-in package is `@repo/nuxt-organizations`, using the official Better Auth organization plugin at the baseline's matching version. Its canonical v1 boundaries are one immutable creator/owner, owner/admin/member single roles, verified-email invitations, bounded native admission checks, no teams/dynamic roles/deletion/automatic organization provisioning, and explicit authoritative tenant membership contexts. Personal Projects remain personal. Optional application-owned Audit and Notifications integrations must not become package dependencies.

## Compatibility prerequisite

Invitation claim and membership acceptance must commit together, with a unique `(organizationId,userId)` membership constraint. Better Auth 1.7.7's native acceptance endpoint does not currently supply that transaction boundary: it commits the invitation claim first, opens a transaction for membership/session changes, and attempts a compensating invitation reset on failure. A process crash between these steps preserves an accepted invitation without membership.

Enclosing `auth.api.acceptInvitation` in the exported transaction context fixes the observed boundary. Enclosing `auth.handler` the same way does not: the native HTTP handler establishes a fresh adapter context. HTTP and server API behavior therefore remain unequal under this attempted integration.

See [the evaluation and reproducible PostgreSQL probe](../../ORGANIZATIONS_MODULE_EVALUATION.md). Do not claim atomic invitation acceptance, expose this as a completed capability, or silently relax the requirement. The acceptance integration needs an explicit reviewed transaction binding or a verified upstream fix before implementation proceeds.

## Persistence and removal contract

Future installation must be explicit and use normal Nuxt module-builder packaging and generic packed-consumer lifecycle tooling. Auth schema composition and additive reviewed migrations are application-owned; no import/module/startup migration or provisioning is permitted. Removal must retain organization/member/invitation/session data and migration history and preserve ordinary auth and personal Projects. This checkpoint installs no runtime capability, so there is no capability removal operation yet.

## Verification

The diagnostic fixture uses native HTTP/auth.api dispatch, not raw endpoint functions. It creates and tears down one uniquely named loopback PostgreSQL 18 database; all identities, session credentials and tables are confined to that disposable fixture. Both `postgres-js` and `pg`, Bun and Node 24 are exercised. Passing the probe confirms the upstream limitation; it is **not** a passing Organizations lifecycle or completion gate.
