# Cache / Coordination

Optional private `@repo/nuxt-cache`, `packages/nuxt-cache`, with clean consumer `fixtures/cache-consumer`. Explicit Nuxt opt-in; `defaultInstalled: false`. Root reference application deliberately enables it. No hard capability dependencies. Optional future relationships: Realtime, API Platform and Jobs. External Valkey/Redis-compatible service is needed only when operations are used. No migration, worker, route or startup connection is created.

## Boundary

Server-only ephemeral exact-key strings/bytes, TTL, NX writes, atomic counters, advisory single-backend leases, non-durable pub/sub and ping. This is not a durable store, session database, queue, Jobs, Realtime, persistent event bus, search or rate-limit product. Jobs stays PostgreSQL-durable and never migrates to Cache. Realtime may later consume pub/sub; API Platform may later consume shared cache/rate-state. Those integrations are documentation only in this change.

## Install and configuration

Keep/add `@repo/nuxt-cache: workspace:*` and explicitly add `'@repo/nuxt-cache'` to `modules` in `nuxt.config.ts`. External consumers can install a locally packed tarball; the private scope is not published. Configure an operator-managed backend when operations are needed, not at build/boot. Import only from `@repo/nuxt-cache/server` in server code. Only `getCache` is auto-imported, on the server. Nitro close drains/closes all package instances; standalone callers must `await cache.close()` or `closeCache()`.

| Server environment | Default / bounds |
| --- | --- |
| `CACHE_URL` | Required on first operation; `redis://` or `rediss://`, optional ACL user/password and database path; no query/fragment. Never expose or log it. |
| `CACHE_KEY_PREFIX` | `nuxt-cache`; 1–128 ASCII letters/digits/underscore/hyphen, starts alphanumeric. Choose a deployment-specific namespace. |
| `CACHE_DEFAULT_TTL_SECONDS` | 300; integer 1–86400 seconds |
| `CACHE_MAX_VALUE_BYTES` | 1048576 (1 MiB); integer 1–1048576 bytes |

`createCache({url, keyPrefix, defaultTtlSeconds, maxValueBytes, env, onOperation, onError})` allows explicit server options; `env: {}` isolates environment in tests. Resolution happens on first operation, then remains stable per instance. TLS verification uses Node's normal trust chain; `rediss://` enables TLS. Private CAs can use standard `NODE_EXTRA_CA_CERTS` at process startup. No option disables verification. TLS/ACL/eviction/memory/security/availability are operator concerns. Namespacing is not an authorization or tenant boundary; applications authorize access.

Fixed connection timeout: 2 seconds. Whole connect/operation/close phase bound: 5 seconds. The client also has a 5-second per-command timeout and a 1024 queued-command bound; offline command queue/replay and automatic socket reconnect are disabled. These bounds prevent first-use/half-open operations/shutdown hanging without adding environment knobs. After a disconnect, the next explicit command creates a new connection. An interrupted write may already have committed: failure/timeout is an uncertain outcome, never a guarantee of no mutation; do not blindly retry non-idempotent increments. No cluster/Sentinel topology or quorum guarantee is claimed.

## API

```ts
import { getCache } from '@repo/nuxt-cache/server'
const cache = getCache()
await cache.set('profiles/summary', 'serialized text') // expires by default
const bytes = await cache.get('profiles/summary') // Buffer | null
await cache.set('once/task', 'claimed', { ifAbsent: true, ttlSeconds: 60 }) // boolean
await cache.increment('counts/task', 1, 300) // safe integer; atomic initial TTL
const lease = await cache.acquireLease('work/task', 30)
if (lease) {
  try { /* advisory coordination only */ }
  finally { await cache.releaseLease(lease) }
}
const subscription = await cache.subscribe('updates/task', (message) => { /* Buffer */ })
await cache.publish('updates/task', 'ephemeral update')
await subscription.unsubscribe()
```

Exports: `createCache`, `getCache`, `closeCache`, `checkCache`, safe `CacheError`, config/key/TTL validation and types. Instances: `checkCache`, `get`, `set`, deliberately named `setPersistent`, `delete`, `increment`, `acquireLease`, `renewLease`, `releaseLease`, `publish`, `subscribe`, `close`.

Logical keys/channels are 1–256 bytes of ASCII letters/digits/colon/underscore/dot/slash/hyphen, starting alphanumeric. Empty/traversal path segments, spaces/control characters, wildcards and URL-like delimiters are rejected. Physical keys are `<prefix>:value:<logical-key>`, leases `<prefix>:lease:<logical-key>`, channels `<prefix>:channel:<logical-channel>`. No KEYS/FLUSH/list/prefix-delete/arbitrary EVAL/raw client public API exists. Every delete targets one exact value key; it cannot delete a lease.

Values are strings/Uint8Array (including Buffer), returned as Buffer or null. Inputs are bounded before copying; reads atomically check STRLEN before GET. No implicit JSON serialization/helper exists. Application JSON must serialize within the bound, decode explicitly and validate with an application-owned schema. The backend must be trusted: it can send unsolicited oversized protocol data; the bound is an application API policy, not a hard transport memory firewall.

`set` always expires (default TTL), `ifAbsent` uses SET NX, returns true only on success. `setPersistent` deliberately opts out of expiry and is an exceptional server primitive, not a durable-storage guarantee. `delete` returns whether a value existed. `increment(key, amount=1, ttlSeconds=default)` validates safe integer input/result and value size before mutation. A fixed one-key Lua script performs INCRBY plus initial PEXPIRE atomically; existing expiring counters retain their initial expiry. An existing persistent counter acquires expiry. Invalid/noninteger/overflowing counters are rejected without mutation. No arbitrary script can be supplied.

## Advisory leases

`acquireLease(key, ttlSeconds=30)` returns frozen `{key,token}` or null. TTL is integer 2–300 seconds; SET NX PX uses a cryptographically random 256-bit token. `renewLease(lease, ttlSeconds=30)` and `releaseLease(lease)` atomically compare the token and update/delete only its matching lease. False means absent, expired or owned by another token. Wrong/stale tokens cannot renew or release a replacement. Renewals are explicit; there is no hidden heartbeat.

**Advisory single-backend lease, no fencing, no Redlock/quorum. It is not sufficient alone for irreversible correctness under partitions or process pauses.** A paused worker can continue after expiry; backend failover may lose lease state. Use durable transactional constraints/idempotency and an appropriate fencing design when correctness requires them. Tokens themselves are secrets; never log them.

## Pub/sub and lifecycle

Channels/messages have the same logical/value bounds; only exact channels. Subscription uses its own connection, command/publish operations use the independent command connection. Awaiting `subscribe` confirms registration. Listener receives Buffer only, without the physical channel. Callback rejection/errors become safe `callback-failed` notifications through optional `onError`, never raw exceptions. Oversized received messages are dropped and safely notified. Delivery has **no persistence, replay, backlog or guaranteed handoff**; subscribers miss messages while disconnected. Automatic resubscribe is disabled: dispose and subscribe again explicitly after a backend outage.

`unsubscribe` is idempotent and suppresses callbacks immediately, unsubscribes then closes its dedicated connection. `close` is idempotent, rejects new operations immediately, stops subscriptions and drains command connections within bounded phases before destroying any unresponsive socket. Already-running user callbacks are application-owned and are not awaited. `closeCache` closes all factory/singleton instances; module/plugin initialization does not validate configuration or connect. `onError` receives safe lifecycle/callback errors only. Operation errors expose only `configuration`, `invalid-input`, `unavailable`, `closed`, `callback-failed`, with no raw client error/cause/URL. `checkCache` returns `{ok:true}` or throws a safe error. Root health retains its independent PostgreSQL contract.

## Optional telemetry

No Observability dependency. `onOperation` receives only bounded operation/outcome/duration and hit boolean for successful get; telemetry exceptions cannot change operation results. App-owned `server/utils/observed-cache.ts` records `app.cache.operation.duration`, operation/outcome and hit/miss plus safe log fields. No keys, channels, values, tokens, CACHE_URL or raw errors enter this adapter. Remove/replace the adapter with plain `createCache`/`getCache` when removing Observability. No client automatic instrumentation is enabled by this package; downstream APM must be reviewed for command-argument capture.

## Disposable local Valkey

`compose.cache.yaml` includes the fixture-owned pinned official `valkey/valkey:9.1.2`. Explicit local-only service, loopback bind, no AOF, no RDB snapshots, no data volume. Nothing is added to normal production Compose.

```sh
bun run cache:dev:valkey
# Set CACHE_URL in server environment to redis://127.0.0.1:6379 (never log it).
bun run cache:check
bun run cache:smoke
bun run cache:dev:down
```

`CACHE_DEV_PORT` optionally changes the helper port (default 6379). This is disposable development data: restarting the process loses it. `cache:check` only pings; `cache:smoke` uses unique exact keys/channels and token-safe release with cleanup, never broad deletion. Production operators provision and secure their own service.

## Removal and verification

Remove Nuxt registration, package dependency, Cache server configuration, app wrapper/plugin/call sites, `cache:*` aliases and their catalog declarations, `scripts/cache.ts`, `scripts/cache-dev.ts` and optional `compose.cache.yaml`. Update reference enablement; clear `.nuxt`/`.output`, reinstall and typecheck/build. Stop only the named local disposable project if unused. No persistent data migration exists. **Never issue FLUSH against an external Cache as part of removal.** See the [reference removal recipe](../../docs/STARTING-A-PROJECT.md#remove-cache--coordination).

Generic `bun run packages:test cache-coordination` owns tarball install/typecheck/build/owned dependency checks/removal/rebuild. Fixture owns real pinned Valkey full Node 24 primitive/bounds/TTL/concurrency/token replacement/renew/pubsub/unsubscribe/unavailable/close checks, Bun smoke, server imports, backendless and unavailable production boot, deterministic explicit reconnect, verified TLS and untrusted-certificate rejection. No sub-second expiry assumption: poll generous deadlines for expiry; inspect backend TTL when exact TTL policy is the assertion. No parallel Email/Webhooks/Audit or other capability dependency. CI discovers completed metadata with no custom job.
