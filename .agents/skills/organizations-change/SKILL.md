---
name: organizations-change
description: Changing organization admission, immutable-owner guards, Better Auth dispatch integration, tenant membership checks or invitation recovery.
---
# Organizations maintenance

Read `capabilities/organizations/CAPABILITY.md` and `ORGANIZATIONS_MODULE_EVALUATION.md`, then use capability-change and auth-change.

- Keep the official matching-version Better Auth plugin and explicit @better-auth/core dependency. Preserve existing auth plugins/hooks and origin/session/CSRF dispatch. Never invoke raw endpoint functions or expose a generic endpoint proxy.
- Global before guards and lifecycle guards complement each other: resend bypasses beforeCreateInvitation; acceptance does not call beforeAddMember; leave does not call beforeRemoveMember. Member hook `user` is the target, not the actor. Derive actor from supported endpoint context.
- Creator bootstrap is the only owner grant. A pathless owner add fails closed. Keep membership uniqueness/single-role CHECK/partial unique owner index; never claim these prove at least one owner or strict admission quotas.
- Native acceptance uses an independently committed single-winner claim, transactional member/session creation, and best-effort ordinary-failure compensation. Preserve this adopted bounded contract; test the durable accepted-without-membership crash window. No outer transaction framework or crash-atomicity claim.
- Supply organizationAuthErrorBoundary directly as betterAuth onAPIError. The native router captures original options; plugin-init options alone do not suppress Better Call's raw failure logging. Never log causes, SQL, emails, invitation IDs/links, sessions or grants.
- Active organization selection is UX only. Resolve authoritative membership in the explicit tenant. Protected writes must lock/check membership and mutate within the application's own transaction. Personal Projects and credential grants retain their existing meanings.
- Diagnostics are guarded and read-only. Recovery requires explicit operator review of current identity/membership and a new authorized invitation when membership is absent. Never automatically repair/resend an ambiguous admission, assign owner, or clean up an existing organization.
- Run the real HTTP/auth.api and both-driver fixture, generic packed lifecycle including retained-data removal/rebuild, and root integration checks. Keep applied migration history immutable.
