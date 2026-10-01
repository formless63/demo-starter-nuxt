# Feature Flags module evaluation

Status: in progress. Sources rechecked2026-10-01. The private Nuxt module uses baseline Drizzle/PostgreSQL and Node24 SHA-256; it adds no remote provider, Redis, background synchronization or environment settings.

[OpenFeature's evaluation API](https://openfeature.dev/docs/reference/concepts/evaluation-api/) is a useful later portability adapter. Its provider/context/typed-evaluation abstraction exceeds the requested local boolean scope, so no SDK is installed. A future adapter must preserve the canonical ordering, deterministic hash and failure semantics below and prove Bun compatibility independently. This decision is a scope choice, not a claim about hosted-service quality.

[PostgreSQL snapshot semantics](https://www.postgresql.org/docs/18/transaction-iso.html) support one-statement coherent definition/override evaluation. [Local statement/lock timeouts](https://www.postgresql.org/docs/18/runtime-config-client.html) bound actual database work without changing the shared pool. Native module-builder packaging and generic packed-consumer tooling retain independent removal.

## Cross-framework v1 contract

The source of truth is the delegated v1 packet and [CAPABILITY.md](capabilities/feature-flags/CAPABILITY.md); no sibling implementation was consulted. Boolean-only definitions, exact user/tenant overrides, disabled kill switch, tenant-before-user precedence, SHA-256 compact JavaScript JSON cohort hashing, expected-revision management, static safe errors and opt-in/removal persistence are observable contracts. Nuxt transport/composition details are application-owned. No flag is an authentication, authorization or tenant-security boundary.

## Evidence

`fixtures/feature-flags-consumer` uses independently packed artifacts, committed explicit migrations and uniquely owned disposable PostgreSQL18 databases on Bun/Node24 and postgres-js/pg. The generic lifecycle passed install/typecheck/build, both real drivers on Bun/Node24, runtime vectors/precedence/revisions/rollback/snapshot/actual timeout/context isolation, then removal/rebuild with retained definitions/overrides/indexes/migration history. Root and final release gates remain pending; no completion claim is made here.

## Connection-loss verification blocker

The strengthened disposable PostgreSQL18 fixture terminates its own backend during an explicit transaction and requires a safe unavailable result with no mutation replay. The pg8.23.0 matrix passes on Bun1.4.2 and Node24.19 after registering the standard connection-error listener on fixture-owned clients.

postgres-js3.4.9 remains blocked: its transaction rejects the connection loss, then a scheduled rollback/write can throw an asynchronous TypeError at `connection.js:255` after the socket is cleared. A minimal bare-driver `begin` containing `SELECT pg_terminate_backend(pg_backend_pid())` reproduces this on Bun and Node, with prepared statements enabled or disabled and with max_pipeline=1. This is outside safe helper error normalization; the process can fail. The [pinned upstream source](https://github.com/porsager/postgres/blob/v3.4.9/src/connection.js) and [transaction implementation](https://github.com/porsager/postgres/blob/v3.4.9/src/index.js) are the relevant boundaries. No global exception suppression, driver fork, automatic replay or reduced outage gate is adopted.

The earlier packed-consumer lifecycle evidence predates this stronger fault test. The capability remains in-progress until both supported drivers pass the full updated lifecycle and release gates. A compatible driver correction is required; changing the supported-driver contract requires explicit architecture coordination.
