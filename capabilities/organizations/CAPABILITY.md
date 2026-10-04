# Organizations / Tenancy

Status: **done**. The opt-in package has an independent packed-consumer fixture; root composition is accepted. Existing personal Projects and machine credential ownership are unchanged.

The private opt-in package is `@repo/nuxt-organizations`, using the official Better Auth organization plugin at the baseline's matching version. Its canonical v1 boundaries are one immutable creator/owner, owner/admin/member single roles, verified-email invitations, bounded native admission checks, no teams/dynamic roles/deletion/automatic organization provisioning, and explicit authoritative tenant membership contexts. Personal Projects remain personal. Optional application-owned Audit and Notifications integrations must not become package dependencies.

## Compatibility prerequisite

**Adopted compatibility revision:** acceptance uses a single-winner pending-to-accepted claim, followed by transactional membership/session creation where upstream supports it, with best-effort restoration to pending on ordinary failure. A unique `(organizationId,userId)` membership constraint prevents duplicate admission. Better Auth 1.7.7 does not make the claim and membership crash-atomic: it commits the invitation claim first, opens a transaction for membership/session changes, and attempts a compensating invitation reset on failure. A process crash between these steps preserves an accepted invitation without membership.

Native dispatch and lifecycle hooks remain authoritative. No outer dispatch transaction framework or copied upstream internals are installed. An accepted invitation without a membership never grants tenant access: `resolveTenantContext` ignores active selection and authoritatively requires the membership in the explicit organization.

See [the evaluation and reproducible PostgreSQL probe](../../docs/evaluations/ORGANIZATIONS_MODULE_EVALUATION.md). The probe proves the crash window; its successful diagnostic exit is not an atomicity claim.

Organization name/slug updates require current authoritative owner membership in both native dispatch and lifecycle hooks. Upstream default admin update permission does not relax this v1 rule.

## Operator recovery

Use `diagnoseInvitation` only with an injected trusted operator guard and application-owned verified-email recipient resolver. It is read-only and returns status/membership consistency without email or invitation links. Do not log its input IDs or return its diagnostic to an untrusted caller.

For accepted-without-membership, stop retries and verify the recipient identity and current organization membership authoritatively. If membership exists, do not invite or admit again; repair stale UX selection only after normal authentication. If absent, review the failed admission and have an authorized owner/admin create a **new** invitation to the verified intended recipient using ordinary native dispatch. Recheck current policy, membership/invitation limits and expiry. The old accepted record remains available for operator review; never automatically reset/resend it, assign ownership, or claim the failed admission succeeded. Ordinary failure compensation can restore pending; refresh state before any deliberate retry.

For failed creator provisioning, inspect the newly created organization and creator membership using a trusted operator connection. An orphan has no usable tenant context. Never assign a later claimant ownership or blindly replay an ambiguous creation. Any operator cleanup must identify only the demonstrably new failed record; existing organization/customer data and migration history are out of scope.

## Persistence and removal contract

Installation is explicit and uses normal Nuxt module-builder packaging and generic packed-consumer lifecycle tooling. Auth schema composition and additive reviewed migrations are application-owned; no import/module/startup migration or provisioning is permitted. Removal must retain organization/member/invitation/session data and migration history and preserve ordinary auth and personal Projects. Root composition and complete regression/release gates remain unverified; the independent fixture proves retained-data removal.

## Verification

The diagnostic fixture uses native HTTP/auth.api dispatch, not raw endpoint functions. It creates and tears down one uniquely named loopback PostgreSQL 18 database; all identities, session credentials and tables are confined to that disposable fixture. `pg` (node-postgres) on Bun and Node 24 is exercised. The crash probe confirms the upstream limitation; it is not an atomicity claim. The separate generic lifecycle builds a packed tarball, checks guarded native contracts, removes the package, rebuilds and verifies retained tables, indexes and baseline sessions.

## Installation and public server APIs

Register `@repo/nuxt-organizations` explicitly in Nuxt modules. Compose both plugins returned by `organizationsAuth()` into the existing Better Auth plugins, retaining baseline hooks, and pass `organizationAuthErrorBoundary` directly as Better Auth's `onAPIError`. Use the matching official `organizationClient()` in the native client. Enable the Drizzle adapter's `transaction:true` deliberately. Compose exported native tables and `activeOrganizationId()` into the application schema and apply an additive reviewed migration explicitly. Module setup validates scalar settings only and never opens a database.

`resolveTenantContext(authenticatedUser,organizationId,db)` authoritatively joins organization and membership and returns a readonly exact tenant scope. `resolveTenantContextTx(...,tx,true)` locks the membership for an application-owned protected mutation; transaction variants reject an ordinary database connection. `listOrganizations` and `listMembers` reapply actor/scope filters, default limit25, allow1–100, and use newest-first `(createdAt,id)` canonical unpadded base64url `[1,UTC millisecond timestamp,id]` cursors. Cursor length is at most2048 bytes and a cursor is never authorization. `addOrganizationMember` is a narrow trusted actor/session-checked native-dispatch wrapper; no generic server proxy exists.

Settings are server-only: `ORGANIZATIONS_CREATION_LIMIT` default10/range1–100, `ORGANIZATIONS_MEMBERSHIP_LIMIT` default100/range1–1000, `ORGANIZATIONS_INVITATION_LIMIT` default100/range1–1000, `ORGANIZATIONS_INVITATION_TTL_SECONDS` default172800/range300–604800. Empty/undefined uses defaults; other invalid integer syntax fails locally. Native read-then-check admission limits are not serialized concurrency quotas. Helper transactions bound statements to5 seconds and locks to2 seconds; the root uses a separately bounded auth pool rather than reconfiguring shared domain/Jobs connections.

The root deliberately adds organization-owned notes with exact tenant predicates. Current members read; owner/admin writes recheck locked membership in the same transaction. Personal Projects are never moved or shared by selecting an organization. Invitations are persisted with an authorized copy-link UI and explicit created/not-sent state; no Email/Jobs dependency or startup provisioning exists. Optional root Audit writes for notes share their transaction; native plugin operations do not claim atomic Audit integration.

## Current roadmap acceptance

Acceptance verified on 2026-10-04: merged main `237186860f0a079e8d01fb295023375a0e34ebd0` passed [all 31 hosted CI jobs](https://github.com/formless63/demo-starter-nuxt/actions/runs/37181894995), including the three identity capability lifecycles and the root application checks. Organizations, Authorization and Feature Flags are done, reference-enabled and opt-in (`defaultInstalled: false`). This records the tested implementation baseline; later changes still require their applicable checks.
