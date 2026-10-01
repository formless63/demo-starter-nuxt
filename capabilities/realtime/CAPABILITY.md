# Realtime

Private `@repo/nuxt-realtime` provides authenticated server-to-browser events over **SSE, WebSocket, or both**. Node runtime is the baseline requirement; authentication is application-owned. No capability or external service is required. Optional Cache, Notifications and Observability integrations stay in the application. Clean consumers explicitly install and enable this module; the reference application enables it. Evaluation: [REALTIME_MODULE_EVALUATION.md](../../REALTIME_MODULE_EVALUATION.md).

## Install and configuration

Add the dependency and `'@repo/nuxt-realtime'` to Nuxt `modules`. Import helpers from `@repo/nuxt-realtime/server`. A private tarball is supported by the generic package lifecycle; choose a public scope before publication. Module setup enables Nitro's experimental WebSocket flag and registers singleton shutdown only. It creates **no routes**, connects to no service, and compiles both adapters so a deployment can choose transports at runtime.

Server-only `REALTIME_TRANSPORTS` defaults to `sse`. Normalized choices are `sse`, `websocket`, `sse,websocket`; comma-separated values are case/whitespace normalized and ordered SSE first. Unknown/empty/duplicate choices are configuration errors. Onboarding explicitly chooses SSE, WebSocket or Both; SSE is a useful default for ordinary server-to-browser updates. WebSocket is not RPC.

Applications own authenticated Nitro routes. `serveRealtimeSse(event, { hub, authorize })` and `createRealtimeWebSocketHandler({ hub, authorize })` require a callback that verifies the normal human session/cookie and returns its full authorized channel set, or undefined. Resolve authorization **before** starting the transport. No browser API key, query token, channel query negotiation or client subscribe command exists. The reference checks Better Auth cookies and same-origin browser upgrades at `/api/realtime/sse` and `/api/realtime/ws`, granting the server-derived per-user notification channel only. Reconnect must authenticate again; applications must close connections when their policy revokes an active grant.

## Event and delivery contract

Register Zod schemas with `defineRealtimeEvents`, generate envelopes with `createRealtimeEvent`, and publish through `createRealtimeHub()` or the module's `getRealtime()` singleton:

```ts
const events = defineRealtimeEvents({ 'records.updated': z.object({ recordId: z.uuid() }).strict() })
const hub = getRealtime()
hub.publish('records:authorized', createRealtimeEvent(events, 'records.updated', { recordId }))
```

Event types match `^[a-z][a-z0-9._-]{0,127}$`. Envelopes contain exactly `{ id, type, occurredAt, data }`; UUID and UTC ISO timestamp are capability-generated. Data must pass its Zod schema and JSON safety checks before/after parsing; runtime instances, accessors, symbols, sparse/custom arrays, non-finite numbers, unsupported values and cycles are rejected without toJSON coercion. Full UTF-8 encoded envelope is at most **64 KiB**. `parseRealtimeEvent` provides the validated ingestion boundary for application-owned fanout.

Channels match `^[a-z][a-z0-9._:/-]{0,127}$`: 1–32 distinct, exact authorized channels per connection, no wildcards. Channel authorization is application policy, not a claim about a channel name. Root user channel identifiers hash stable user IDs, never session tokens.

SSE uses H3 `sendStream` with a Node PassThrough, `text/event-stream`, `Cache-Control: no-cache`, event type plus full JSON envelope in `data:`. There is **no `id:`** field. An initial connected comment flushes the idle stream; a comment heartbeat is emitted every **20 seconds**. H3 1's `createEventStream` cannot emit true comments and its Web Stream bridge does not expose the Node response drain signal; the supported Node streaming primitive permits both comments and pipe backpressure.

WebSocket uses H3 `defineWebSocketHandler` and Nitro/CrossWS, authenticated in the upgrade hook. It sends the identical JSON envelope. Nitro 2.13.4 uses CrossWS 0.3.5, whose public hooks do not expose ping/pong control frames; every **20 seconds** the server sends `{"heartbeat":"ping"}`, and the client must answer exactly `{"heartbeat":"pong"}`. Only an outstanding heartbeat response is accepted; other client application messages close the transport. A missed next heartbeat closes the dead transport. Browser code must handle these transport frames separately from events. No raw exception frames are sent.

Each connection bounds pending encoded bytes to **256 KiB**, including explicit queue/in-flight accounting and current transport pressure. Node pipe drain and CrossWS's public `peer.websocket.bufferedAmount` supply pressure signals. Overflow closes immediately; a stalled write closes after 20 seconds. Abort/close/shutdown removes listeners, timers and queued frames. Manually created hubs belong to their caller; `closeRealtime` closes/resets only the singleton.

Delivery is process-local, non-durable and lossy. No replay, event history, exactly-once, guaranteed delivery, presence/chat/CRDT or generic event-bus product. Reconnect then refetch authoritative state when continuity matters; Last-Event-ID does not create a replay contract.

## Optional integrations and privacy

`server/realtime/application.ts` composes Cache when `CACHE_URL` is configured. It publishes **only to Cache**, then the Cache subscription feeds each local hub; without Cache it publishes only locally. No duplicate local-plus-Cache send and no silent local fallback. Fanout remains non-durable and lossy during outages, with no replay/continuity guarantee. Cache command reconnection does not resubscribe; explicitly close/reset application fanout and establish new subscriptions (or restart) before treating the path as available again. Core package has no Cache dependency.

Notifications publishes an ID-only `notifications.created` hint after commit. Optional root telemetry may record transport, registered event type, finite operation/outcome, duration and active count, never payload/user/session/channel values. Realtime has no Observability dependency. Safe errors: configuration, invalid-input, unauthorized, unavailable, closed, backpressure.

## Verification and removal

`bun run packages:test realtime` verifies packed install, backendless production boot, all config modes, both real Node transports, cookie/channel isolation, SSE wire format/comments, WS envelope/heartbeat, no replay, disconnect and queue pressure, then removes the package and builds/types the remaining app. Root unit tests cover exact bounds/JSON safety/dead WebSocket liveness; root Cache integration uses disposable Valkey. Root E2E verifies real Better Auth cookies and notification hints over both transports.

Stop producers and close clients, remove application routes/wrappers/shutdown hooks, remove module and dependency, then reinstall and verify. No migration/data deletion or remote Cache cleanup occurs. Remove only this capability; optional Cache/Notifications/Observability remain independently useful.
