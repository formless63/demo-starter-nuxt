# Cache / Coordination module evaluation

Research date: 2026-09-30. Selected official stable Valkey **9.1.2**, official image `valkey/valkey:9.1.2`, and stable **redis / node-redis 6.3.0**. These versions are pinned in the disposable fixture and package/lockfile.

## Evidence and client decision

- [Valkey current stable release](https://github.com/valkey-io/valkey/releases/tag/9.1.2): upstream latest release API reports 9.1.2, published 2026-09-01. [Official container](https://hub.docker.com/r/valkey/valkey) supplies the fixture image.
- [node-redis](https://github.com/redis/node-redis), [npm redis metadata](https://registry.npmjs.org/redis/latest): stable 6.3.0 declares Node >=20; Node 24 satisfies it. It is a mature typed Redis-protocol client with binary replies, supported TLS URLs, pub/sub, SET NX/EX/PX, INCRBY, PEXPIRE and EVAL.
- [Client configuration](https://github.com/redis/node-redis/blob/master/docs/client-configuration.md) documents redis/rediss, TLS options, disabled offline queues, connection/reconnect policy and per-command timeout. Preserve TLS verification; do not copy upstream's insecure self-signed example.
- [Pub/sub](https://github.com/redis/node-redis/blob/master/docs/pub-sub.md) documents dedicated connections and Buffer listeners with unsubscribe.
- [ioredis](https://github.com/redis/ioredis), [npm metadata](https://registry.npmjs.org/ioredis/latest): mature alternative, stable 6.0.0, Node >=20. Nothing in this scope blocks preferred node-redis; switching clients would add no necessary feature.

Valkey uses the Redis-compatible command protocol, but node-redis's upstream supported-version matrix names Redis rather than promising Valkey vendor certification. This capability claims the subset verified by its **real Valkey 9.1.2 fixture on Node 24 and Bun tooling**, not every Redis module/extension/topology/client feature. No Redis 8-specific CAS/CAD, client-side caching, Search/JSON module or automatic telemetry is used. No alternative client was chosen because no concrete blocker emerged for the scoped operations.

## Nuxt module shape

Sibling package, Nuxt module-builder and compatible Nuxt peer, server exports only, `getCache` server auto-import and Nitro close hook. No routes, startup connection, browser composable/config or hard module dependencies. The package owns redis and @nuxt/kit; optional Observability stays in the root wrapper. Storage's optional infrastructure and catalog-driven packed fixture patterns are reused. The root deliberately opts in independently of `defaultInstalled: false`.

## Decisions and limits

Default TTL 300 seconds (1–86400); maximum 1 MiB (configurable downward). Logical keys/channels max 256 bytes, explicit namespace and separate value/lease/channel domains. String/bytes only; no implicit JSON or public bulk operations/raw scripts/client. Fixed reviewed one-key Lua is needed because separate INCRBY/EXPIRE is not atomic and MULTI with conditional initial TTL is awkward; script preserves existing expiry and validates before mutation. Default writes expire; `setPersistent` is deliberate.

Single-backend SET NX PX random-token lease with atomic token check on renew/release. No fencing, Redlock/quorum, partition safety or irreversible-correctness claim. Pub/sub is ephemeral, dedicated and explicitly disposed, no replay/durable bus. Jobs stays PostgreSQL-durable; future Realtime/API integration is documentation only.

Fixed 2-second connect and 5-second operation/close phase bounds prevent hangs. Offline replay and automatic reconnect are disabled to avoid retrying uncertain writes; next explicit command reconnects. Per-command timeout and queue bound limit accumulation. Timeout does not undo a write. Safe errors/measurements never include backend URL, key/channel/value/token. TLS verification is preserved. Backend/service security/memory/eviction/failover remain operator decisions.

Local Compose is additive and disposable: loopback port only, save disabled, AOF disabled, no volume. Removal deletes code/config/helpers/wrapper only; no migration or external FLUSH. The generic fixture owns the compatibility and install/removal contract without handwritten CI or parallel-branch dependencies.

## Verification evidence

The catalog-driven tarball fixture passes real Valkey 9.1.2 full primitives on Node 24, Bun smoke, verified TLS with a temporary CA and rejection of untrusted TLS, Nuxt server imports, backendless/unavailable boot, deterministic explicit reconnect, close during initial connection, unsubscribe and clean dependency removal/typecheck/build. Compatibility is verified for this scoped API rather than inferred solely from the upstream client matrix. All eight capability lifecycles pass independently, with 98 agent tests, 67 Vitest tests and three development/production Playwright tests. The production image migrates an empty PostgreSQL database and starts the app/worker with no Cache URL or Valkey dependency.
