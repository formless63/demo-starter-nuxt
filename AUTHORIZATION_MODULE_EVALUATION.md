# Authorization evaluation

Use a small server-only code registry and exact-scope PostgreSQL assignments for the dispatched v1. No policy language, hierarchy, wildcard, deny engine or external policy service is needed. Registry references validate eagerly; persistence/evaluation remains lazy and fail-closed.

## Alternatives considered

Official sources were inspected on 2026-10-01. [CASL](https://github.com/stalniy/casl) supports action/subject/condition/field rules and inverted rules; its broader rule model and client sharing are unnecessary for an explicit union plus application-owned SQL predicates. [Node Casbin](https://github.com/apache/casbin-node-casbin) supplies model-based ACL/RBAC/ABAC; v1 needs no configurable model language or hierarchy. [OpenFGA](https://openfga.dev/docs/fga) provides relationship models/stores and HTTP/gRPC checks; this starter does not need a resource graph or separate policy server. [Oso Cloud](https://www.osohq.com/docs) uses Polar and a centralized authorization API; v1 excludes a policy DSL and mandatory hosted dependency. None is installed.

## Cross-framework v1 contract

Actions/roles are bounded code-owned registries. Persisted roles are exact `(scopeKind,scopeId,userId,roleId)` assignments, never API-key grants or Better Auth organization administration roles. Evaluation unions registered persisted and explicit adapter roles, then intersects mandatory resource predicates and machine credential restrictions. Tenant evaluation requires an authoritative application membership adapter, including when a stale persisted assignment remains. User scope must equal the authenticated actor. Unknown action/role, unresolved adapter/resource or dependency failure never allows.

Management has no default authority and no self-grant/bootstrap administrator. Caller transactions remain caller-owned; convenience mutations own one explicit transaction, with no ambiguous-write retry. Protected domain writes must share locked facts/SQL predicates with authorization. No cross-request cache, registry/assignment browser dump, policy network call, startup query, migration or seeding.

The package/consumer, safe reasons/error behavior, pagination, schema, removal and reference composition are defined in capabilities/authorization/CAPABILITY.md when implemented. This evaluation does not mark the capability complete.
