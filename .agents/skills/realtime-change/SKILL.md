---
name: realtime-change
description: Changing authenticated SSE/WebSocket streams, realtime event schemas, channel policy, bounded transport queues or optional Cache fanout.
---

# Realtime change

Read `capabilities/realtime/CAPABILITY.md`, `REALTIME_MODULE_EVALUATION.md` and current official Nitro/H3/CrossWS APIs; apply `capability-change` for packaging/contracts.

- Preserve both adapters and the three explicit onboarding choices; runtime default SSE. No Socket.IO, second router, RPC/client commands, replay/history/presence/chat/CRDT.
- Application owns normal human cookie/session auth and full exact authorized channel set before upgrade/stream. No browser API keys, channel wildcards/query tokens; protect WebSocket origin. Connection grants require application-owned close on revocation.
- Capability-generated UUID/UTC envelope, registered Zod plus strict JSON safety, full64KiB bound; do not serialize runtime objects through toJSON/getters. Authorized channels≤32.
- SSE full event/data envelope, no id, real comment heartbeat20seconds. WS same envelope plus transport-only ping/pong20seconds for current Nitro/CrossWS; review public hooks before claiming native control frames.
- Per-connection pending bytes≤256KiB with explicit in-flight/queued and real transport pressure. Stall/overflow closes safely; abort/close/shutdown removes timers/listeners/queues. Singleton cleanup must not seize caller-owned hubs.
- Core never depends on Cache/Notifications/Observability. App Cache fanout has one publish path, no duplicate local delivery/fallback/replay/continuity claim; explicit resubscribe after outage. Telemetry uses finite operation/type/transport/outcome and numeric duration/active count, never user/session/channel/payload values.
- Verify both actual production Node transports, auth/isolation, heartbeats/liveness, slow transport, cleanup, backendless boot and `bun run packages:test realtime`. Preserve generic CI/lifecycle tooling.
