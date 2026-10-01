# Organizations / Tenancy

Status: **in progress**. The opt-in package is being verified independently before root composition. Existing personal Projects and machine credential ownership are unchanged.

The intended private opt-in package is `@repo/nuxt-organizations`, using the official Better Auth organization plugin at the baseline's matching version. Its canonical v1 boundaries are one immutable creator/owner, owner/admin/member single roles, verified-email invitations, bounded native admission checks, no teams/dynamic roles/deletion/automatic organization provisioning, and explicit authoritative tenant membership contexts. Personal Projects remain personal. Optional application-owned Audit and Notifications integrations must not become package dependencies.

## Compatibility prerequisite

**Adopted compatibility revision:** acceptance uses a single-winner pending-to-accepted claim, followed by transactional membership/session creation where upstream supports it, with best-effort restoration to pending on ordinary failure. A unique `(organizationId,userId)` membership constraint prevents duplicate admission. Better Auth 1.7.7 does not make the claim and membership crash-atomic: it commits the invitation claim first, opens a transaction for membership/session changes, and attempts a compensating invitation reset on failure. A process crash between these steps preserves an accepted invitation without membership.

Native dispatch and lifecycle hooks remain authoritative. No outer dispatch transaction framework or copied upstream internals are installed. An accepted invitation without a membership never grants tenant access: `resolveTenantContext` ignores active selection and authoritatively requires the membership in the explicit organization.

See [the evaluation and reproducible PostgreSQL probe](../../ORGANIZATIONS_MODULE_EVALUATION.md). The probe proves the crash window; its successful diagnostic exit is not an atomicity claim.

## Operator recovery

Use `diagnoseInvitation` only with an injected trusted operator guard and application-owned verified-email recipient resolver. It is read-only and returns status/membership consistency without email or invitation links. Do not log its input IDs or return its diagnostic to an untrusted caller.

For accepted-without-membership, stop retries and verify the recipient identity and current organization membership authoritatively. If membership exists, do not invite or admit again; repair stale UX selection only after normal authentication. If absent, review the failed admission and have an authorized owner/admin create a **new** invitation to the verified intended recipient using ordinary native dispatch. Recheck current policy, membership/invitation limits and expiry. The old accepted record remains available for operator review; never automatically reset/resend it, assign ownership, or claim the failed admission succeeded. Ordinary failure compensation can restore pending; refresh state before any deliberate retry.

For failed creator provisioning, inspect the newly created organization and creator membership using a trusted operator connection. An orphan has no usable tenant context. Never assign a later claimant ownership or blindly replay an ambiguous creation. Any operator cleanup must identify only the demonstrably new failed record; existing organization/customer data and migration history are out of scope.

## Persistence and removal contract

Future installation must be explicit and use normal Nuxt module-builder packaging and generic packed-consumer lifecycle tooling. Auth schema composition and additive reviewed migrations are application-owned; no import/module/startup migration or provisioning is permitted. Removal must retain organization/member/invitation/session data and migration history and preserve ordinary auth and personal Projects. Root composition and retained-data removal proofs remain part of the completion gate.

## Verification

The diagnostic fixture uses native HTTP/auth.api dispatch, not raw endpoint functions. It creates and tears down one uniquely named loopback PostgreSQL 18 database; all identities, session credentials and tables are confined to that disposable fixture. Both `postgres-js` and `pg`, Bun and Node 24 are exercised. Passing the probe confirms the upstream limitation; it is **not** a passing Organizations lifecycle or completion gate.
