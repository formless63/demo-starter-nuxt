# Realtime module evaluation

Use Nitro/H3 rather than a second realtime server or Socket.IO. The module provides both SSE and WebSocket adapters and only server primitives; applications own authentication, channel policy and routes. Provider-neutral Node output works without any external backend. Cache fanout is an optional app composition, not a package edge.

## Cross-framework v1 contract

The supplied implementation prompt is the shared contract; no other repository is consulted. Requires[], integratesWith Cache/Notifications/Observability, baseline Node runtime with optional authentication, defaultInstalled false. Server config REALTIME_TRANSPORTS defaults `sse`, normalized `sse` / `websocket` / `sse,websocket`; onboarding presents SSE, WebSocket and Both.

Authenticated human cookie/session server-to-browser streams only. Types `^[a-z][a-z0-9._-]{0,127}$`; UUID/UTC-generated `{ id, type, occurredAt, data }`, registered Zod and JSON-safe data; full envelope ≤64KiB. Channels `^[a-z][a-z0-9._:/-]{0,127}$`, at most32 authorized exact channels, no wildcard/token query/API keys. Application resolves connection/channels before transport.

SSE text/event-stream/no-cache emits event type and full JSON data, no SSE id; comment heartbeat20 seconds. WebSocket sends the same envelope, native or transport-only heartbeat20 seconds, safe dead-transport close, no application command/RPC system or raw exception frames. Pending encoded bytes/connection≤256KiB using explicit accounting and transport pressure. Disconnect clears queues/timers/listeners.

Process-local pub/sub, no external service required. Optional Cache fanout is non-durable/lossy, no replay/automatic continuity, uses one publish path to prevent duplicates. No exactly-once/guaranteed delivery/history/presence/chat/CRDT. Reconnect then refetch authoritative state. Safe errors configuration/invalid-input/unauthorized/unavailable/closed/backpressure. Optional telemetry only transport/registered type/operation/outcome/duration/active count, no payload/identity/session/channel labels.

## Nuxt-specific mechanism and limits

Nuxt4.5.2/Nitro2.13.4 currently require `nitro.experimental.websocket=true`. H3 `defineWebSocketHandler` supplies upgrade/open/message/close/error hooks, and CrossWS0.3.5 supplies context and public `peer.websocket.bufferedAmount`. Newer CrossWS documentation mentions native ping/pong hooks absent in this Nitro-compatible version, so v1 uses the documented transport-only `{"heartbeat":"ping"}` / `{"heartbeat":"pong"}` frames. A browser client must answer these; it never sends application commands. This is the only separate WebSocket frame shape.

SSE uses supported H3 `sendStream` with a Node PassThrough for comment heartbeats and native pipe drain. H3's current EventStream helper does not support comments and its WebStream bridge does not await response drain. Explicit connection accounting bounds queues with a20-second stalled-write deadline. Node24's global WebSocket is a stable **client** API, not a server replacement. No additional runtime transport library is introduced; H3/Zod are peers, CrossWS stays Nitro-owned.

Reference routes check real Better Auth cookie sessions and origin; clean consumer routes use a minimal fixture cookie policy only. Auth/channel grants are a connection snapshot; application revocation requires explicit close. Proxies must allow Upgrade for WS and streaming/no buffering for SSE; no cloud adapter portability claim beyond the tested Node server.

## Verification evidence and maintenance

| Boundary | Proof |
| --- | --- |
| Modes, event/JSON/byte/channel limits | Root Realtime unit suite |
| Auth, foreign channels, envelope, no replay | Packed Node consumer and root Better Auth E2E |
| SSE wire format/comment heartbeat | Real streamed Node response |
| WebSocket heartbeat/liveness/commands | Real Node socket plus deterministic timed unit hooks |
| Backpressure and disconnect | Stalled/buffered sink boundary, both real transports, listener count |
| Optional Cache, one delivery path | Disposable Valkey through existing Cache public API |
| Independence/removal | Generic tarball lifecycle and backendless boot |

Sources: [Nitro2 WebSocket/SSE](https://v2.nitro.build/guide/websocket), [H3 WebSocket/SSE](https://v1.h3.dev/guide/websocket), [CrossWS hooks](https://crossws.h3.dev/guide/hooks), [CrossWS peers](https://crossws.h3.dev/guide/peer), [Node24 globals](https://nodejs.org/docs/latest-v24.x/api/globals.html#class-websocket). Canonical install/config/removal: [capability contract](../../capabilities/realtime/CAPABILITY.md).
