# Authorization evaluation

Use a small server-only code registry and exact-scope PostgreSQL assignments for the dispatched v1. No policy language, hierarchy, wildcard, deny engine or external policy service is needed. Registry references validate eagerly; persistence/evaluation remains lazy and fail-closed.

## Alternatives considered

Official sources were inspected on 2026-10-01. [CASL](https://github.com/stalniy/casl) supports action/subject/condition/field rules and inverted rules; its broader rule model and client sharing are unnecessary for an explicit union plus application-owned SQL predicates. [Node Casbin](https://github.com/apache/casbin-node-casbin) supplies model-based ACL/RBAC/ABAC; v1 needs no configurable model language or hierarchy. [OpenFGA](https://openfga.dev/docs/fga) provides relationship models/stores and HTTP/gRPC checks; this starter does not need a resource graph or separate policy server. [Oso Cloud](https://www.osohq.com/docs) uses Polar and a centralized authorization API; v1 excludes a policy DSL and mandatory hosted dependency. None is installed.

## Cross-framework v1 contract

Actions/roles are bounded code-owned registries. Persisted roles are exact `(scopeKind,scopeId,userId,roleId)` assignments, never API-key grants or Better Auth organization administration roles. Evaluation unions registered persisted and explicit adapter roles, then intersects mandatory resource predicates and machine credential restrictions. Tenant evaluation requires an authoritative application membership adapter, including when a stale persisted assignment remains. User scope must equal the authenticated actor. Unknown action/role, unresolved adapter/resource or dependency failure never allows.

Management has no default authority and no self-grant/bootstrap administrator. Caller transactions remain caller-owned; convenience mutations own one explicit transaction, with no ambiguous-write retry. Protected domain writes must share locked facts/SQL predicates with authorization. No cross-request cache, registry/assignment browser dump, policy network call, startup query, migration or seeding.

The package/consumer, safe reasons/error behavior, pagination, schema, removal and reference composition are defined in capabilities/authorization/CAPABILITY.md with passing independent Bun/Node24 and postgres-js/pg lifecycle evidence. Root and release checks remain pending. This evaluation does not mark the capability complete.

## Connection-loss verification blocker

The strengthened disposable PostgreSQL18 fixture terminates its own backend during an explicit transaction and requires a safe unavailable result with no mutation replay. The pg8.23.0 matrix passes on Bun1.4.2 and Node24.19 after registering the standard connection-error listener on fixture-owned clients.

postgres-js3.4.9 remains blocked: its transaction rejects the connection loss, then a scheduled rollback/write can throw an asynchronous TypeError at `connection.js:255` after the socket is cleared. A minimal bare-driver `begin` containing `SELECT pg_terminate_backend(pg_backend_pid())` reproduces this on Bun and Node, with prepared statements enabled or disabled and with max_pipeline=1. This is outside safe helper error normalization; the process can fail. The [pinned upstream source](https://github.com/porsager/postgres/blob/v3.4.9/src/connection.js) and [transaction implementation](https://github.com/porsager/postgres/blob/v3.4.9/src/index.js) are the relevant boundaries. No global exception suppression, driver fork, automatic replay or reduced outage gate is adopted.

The earlier packed-consumer lifecycle evidence predates this stronger fault test. The capability remains in-progress until both supported drivers pass the full updated lifecycle and release gates. A compatible driver correction is required; changing the supported-driver contract requires explicit architecture coordination.

## Official-driver compatibility investigation
The official-version investigation and supported-API audit are recorded in [STACK_EVALUATION.md](STACK_EVALUATION.md#official-driver-compatibility-investigation). The demonstrated 3.4.7 downgrade avoids the immediate crash but lets a dead callback commit a replacement transaction, so it is rejected. Manifests/lockfile remain unchanged; standalone Bun/Node probes are committed in tests/fixtures/postgres-driver. Both-adapter lifecycles and the hosted all15 matrix remain gates.
