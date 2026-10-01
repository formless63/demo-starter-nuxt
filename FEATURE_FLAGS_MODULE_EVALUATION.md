# Feature Flags module evaluation

Status: in progress. Sources rechecked2026-10-01. The private Nuxt module uses baseline Drizzle/PostgreSQL and Node24 SHA-256; it adds no remote provider, Redis, background synchronization or environment settings.

[OpenFeature's evaluation API](https://openfeature.dev/docs/reference/concepts/evaluation-api/) is a useful later portability adapter. Its provider/context/typed-evaluation abstraction exceeds the requested local boolean scope, so no SDK is installed. A future adapter must preserve the canonical ordering, deterministic hash and failure semantics below and prove Bun compatibility independently. This decision is a scope choice, not a claim about hosted-service quality.

[PostgreSQL snapshot semantics](https://www.postgresql.org/docs/18/transaction-iso.html) support one-statement coherent definition/override evaluation. [Local statement/lock timeouts](https://www.postgresql.org/docs/18/runtime-config-client.html) bound actual database work without changing the shared pool. Native module-builder packaging and generic packed-consumer tooling retain independent removal.

## Cross-framework v1 contract

The source of truth is the delegated v1 packet and [CAPABILITY.md](capabilities/feature-flags/CAPABILITY.md); no sibling implementation was consulted. Boolean-only definitions, exact user/tenant overrides, disabled kill switch, tenant-before-user precedence, SHA-256 compact JavaScript JSON cohort hashing, expected-revision management, static safe errors and opt-in/removal persistence are observable contracts. Nuxt transport/composition details are application-owned. No flag is an authentication, authorization or tenant-security boundary.

## Evidence

`fixtures/feature-flags-consumer` uses independently packed artifacts, committed explicit migrations and uniquely owned disposable PostgreSQL18 databases on Bun/Node24 and postgres-js/pg. The generic lifecycle passed install/typecheck/build, both real drivers on Bun/Node24, runtime vectors/precedence/revisions/rollback/snapshot/actual timeout/context isolation, then removal/rebuild with retained definitions/overrides/indexes/migration history. Root and final release gates remain pending; no completion claim is made here.
