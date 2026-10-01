# Organizations / Tenancy evaluation

## Decision and launch finding

Retain the official Better Auth organization plugin at baseline version 1.7.7. No parallel authentication system, copied plugin internals, runtime capability manager or new tenant service is justified. The dispatched atomic invitation-acceptance requirement is not met by the native endpoint at that version, including when the Drizzle adapter explicitly sets `transaction: true`.

Source inspection was repeated on 2026-10-01 against the installed 1.7.7 packages and the official [release](https://github.com/better-auth/better-auth/releases/tag/v1.7.7), [organization documentation](https://better-auth.com/docs/plugins/organization), and tagged [invitation endpoint](https://github.com/better-auth/better-auth/blob/v1.7.7/packages/better-auth/src/plugins/organization/routes/crud-invites.ts), [auth HTTP handler](https://github.com/better-auth/better-auth/blob/v1.7.7/packages/better-auth/src/auth/base.ts), and [adapter transaction context](https://github.com/better-auth/better-auth/blob/v1.7.7/packages/core/src/context/transaction.ts) sources. These source observations are distinct from the desired application contract.

## Reproduction and evidence

[The disposable probe](fixtures/organizations-consumer/.fixture/upstream-atomicity.ts) holds an advisory lock in an independent observer connection. A fixture-only PostgreSQL trigger waits on that lock immediately before inserting the invited member. It uses actual Better Auth dispatch with a verified matching email, a signed database session, native schema, single-role CHECK, unique organization/user membership and partial unique owner constraints. It never invokes a raw plugin endpoint function.

At the barrier, the observer can see the invitation's committed `accepted` state but no membership. Normal completion creates exactly one membership. Killing only the fixture's auth process at the barrier leaves the invitation accepted and the membership absent. The observer then closes and drops only its uniquely named fixture database. No production account, external provider or existing database schema/data is modified.

Run from the repository root with the repo-pinned Bun on PATH, Node 24, and `DATABASE_URL` pointing at a disposable loopback PostgreSQL 18 service whose fixture role has CREATEDB:

```sh
bun fixtures/organizations-consumer/.fixture/upstream-atomicity.ts
ORGANIZATIONS_PROBE_ENCLOSING_TRANSACTION=true bun fixtures/organizations-consumer/.fixture/upstream-atomicity.ts
```

Each invocation runs 16 cases: Bun/Node × postgres-js/pg × HTTP/auth.api × completion/process crash. The plain native-dispatch probe confirmed independently committed claims in every case. The enclosing-context probe confirmed atomic visibility/rollback for auth.api, while HTTP still independently committed the claim. A successful diagnostic exit means the finding was reproduced, not that the desired implementation gate passed.

The native source claims the invitation before `runWithTransaction`; its catch attempts `accepted → pending` compensation. That compensation cannot execute after process death. The HTTP handler's `runWithAdapter` creates a fresh adapter context and replaces the attempted outer context. These facts explain the driver/runtime-independent observations without any inference about exactly-once execution.

## Smallest conservative integration revision to review

Keep the atomicity requirement. Add an explicit, narrowly scoped application-owned acceptance transaction binding that encloses the entire native dispatch for **both** HTTP and auth.api, using the same auth configuration and a transaction-bound adapter. Its HTTP implementation must preserve session, origin and CSRF dispatch protections and roll back on failed HTTP outcomes; its server implementation must not become a generic endpoint proxy. Prove both paths, both drivers, concurrent acceptance, failure rollback and process-crash behavior before accepting this revised integration design. A verified upstream patch that places claim and membership in one supported transaction is the other conservative route.

The context-only wrapper tested here is insufficient for HTTP and must not be shipped as the fix. No such binding or upstream patch is included in this checkpoint. Do not silently adopt non-atomic acceptance merely to unblock completion. No package version upgrade, native route override or transaction-bound auth construction has been selected without its supporting compatibility proof.

The separately dispatched createOrganization limitation remains: organization creation and creator membership do not have one enclosing native transaction. This probe does not cover creator provisioning, nor does it authorize orphan ownership assignment or cleanup of existing organizations.

## Cross-framework v1 contract

The shared observable acceptance contract requires one invitation claim and one membership in the supported transactional path, unique membership, conflict/already-consumed on competing acceptance, and no successful tenant response without authoritative membership. Native upstream endpoint shapes may remain versioned; transport does not excuse unequal safety outcomes. Only this Nuxt repository was inspected; no sibling repository was consulted.

Other Organizations contract boundaries, optional relationships, independent removal and new schema are tracked in [CAPABILITY.md](capabilities/organizations/CAPABILITY.md). The capability remains `defaultInstalled: false` and in-progress. Authorization and Feature Flags are separate assigned capabilities whose implementation follows Organizations isolated-consumer proof; that ordering gate has not passed.
