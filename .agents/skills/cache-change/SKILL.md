---
name: cache-change
description: Changing ephemeral Cache/Coordination keys, values, TTLs, counters, advisory leases, pub/sub, Valkey configuration or lifecycle.
---

# Cache change

Read `capabilities/cache-coordination/CAPABILITY.md` and `docs/evaluations/CACHE_COORDINATION_MODULE_EVALUATION.md`; use `capability-change` for package/service contract changes.

- Ephemeral primitives only. No durable store/session database/queue/Jobs/Realtime/search/rate-limit product/persistent event bus.
- Server-only lazy configuration and clients; no startup connection, routes or browser imports. Preserve Nitro singleton close handling; caller-created instances must be closed by their caller, and closeCache only resets/closes the singleton.
- Namespaced physical keys and exact validated logical keys/channels. No KEYS, FLUSH, wildcard/prefix delete, public arbitrary EVAL or raw client escape hatch.
- No secrets, CACHE_URL, keys, channels, values or tokens in logs/errors/spans/metrics. Only bounded operation/outcome/duration/hit-miss telemetry; optional wrapper belongs to the app.
- Bounded TTL and values; writes expire by default. Default namespace is app; lossless get returns Buffer/null. TTL range is 1–86400 seconds, values at most 1 MiB. Non-expiring writes use setWithoutExpiry. Leases always expire. JSON decode/validation must be explicit and bounded if introduced.
- Counter update plus initial expiry stays atomic. Reject invalid/overflowing values before mutation; no blindly replaying uncertain writes.
- Leases use random tokens and atomic token-checked renewal/release. Stale tokens cannot change replacements. Lease TTL is seconds, default 30 within 2–300; stale/wrong-token renew/release returns false. Advisory single backend only: no fencing or Redlock/quorum/correctness-under-partition claims.
- Pub/sub is non-durable, without persistence/replay. At most 32 active subscription connections per instance. Dedicated subscription connection, bounded messages, safe callbacks, unsubscribe/close cleanup. Explicit resubscribe after disconnect.
- redis:// and rediss:// remain supported; never disable TLS verification or expose credential-bearing URLs.
- Safe errors include timeout/authentication; onError receives callback-failed only. Fixed connection 2 seconds, operation/shutdown phase 5 seconds and command queue 1024; no timeout environment knobs.
- Real pinned stable Valkey tests own compatibility, concurrency, initial TTL, token safety, pub/sub and lifecycle. Run `bun run packages:test cache-coordination`; retain catalog-driven pack/install/build/removal.
- Local Valkey is explicit, loopback-only and disposable with no AOF/RDB/volume. Removal never issues FLUSH against external Cache; no persistent migration exists.
