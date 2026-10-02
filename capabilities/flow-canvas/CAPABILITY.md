# Flow / Canvas

Status: **in-progress**. `defaultInstalled: false`. Private package `@repo/nuxt-flow-canvas`; no hard capability dependencies. Realtime, Object Storage and Audit Log remain optional application integrations. No migrations, service, network, autosave, layout engine, workflow execution or collaboration protocol.

## Install and ownership

Explicitly install the package and enable `modules: ['@repo/nuxt-flow-canvas']` in Nuxt. `FlowCanvas` accepts `modelValue: GraphDocument`, required `documentKey: string`, optional `title`, `readOnly`, and pure `connectionPolicy: ConnectionPolicy`. `update:modelValue` and `proposal(next, documentKey)` emit proposed changes, never proof of persistence. Applications own acceptance, authorization, records, persistence, cancellation and dirty state. Keep documentKey stable within one record and change it for every record identity change, even when the graph bytes are equal. Use immutable accepted graph replacements. Never share mutable renderer state with storage.

The module owns Vue Flow 1.48.2, fixed safe text node rendering and `out`/`in` handles. `applyDefault:false` plus explicit native changes/connect/viewport handling prevent uncontrolled graph updates. Each editor has an isolated native store. Semantic node/connection lists render deterministically on the server; the canvas enhances after hydration. Forms support add/connect/rename/delete/manual coordinates, announcements, focus recovery and Escape cancellation. Deletion atomically removes incident edges. Read-only disables every model-changing path. Imported data cannot select renderers, HTML, styles, URLs or executable code. V1 intentionally does not expose custom renderer configuration.

## Portable graph contract

Import pure helpers/types from `@repo/nuxt-flow-canvas/graph`: `parseGraph`, `validateGraph`, `serializeGraph`, `proposeConnection`, `deleteGraphNode`, `GraphValidationError`, `GRAPH_LIMITS`, `ConnectionPolicy` and the graph types. These imports are server-safe without Vue or browser globals. Validate loaded records before the HTTP/Nuxt payload transport; reject malformed Unicode before a serializer can replace it. The component revalidates independently. Validation returns a fresh clone; connection policy receives immutable snapshots and may only narrow the built-in rules.

Closed v1 fields: `schemaVersion:1`, nodes `{id,kind:'default',position:{x,y},label}`, edges `{id,source,target,sourceHandle:'out',targetHandle:'in',label?}`, optional viewport `{x,y,zoom}`. Bounds: 1 MiB serialized UTF-8, 500 nodes, 1000 edges, 128-character IDs, 1000-character labels, finite coordinates ±1,000,000 and zoom 0.1–4. IDs share one namespace. Reject unknown/prototype fields, duplicates, dangling endpoints, self-connections, duplicate directed connections, CR/NUL/lone surrogates. Cycles are valid diagrams. Labels are plain text, never HTML. Serialization uses safe JSON escaping and does not establish persistence.

## Reference and verification

`/flow-test` demonstrates two independent editors and application-owned synthetic async save/load, repeated requests, failure/dirty preservation, stale edits/record switches, cancellation and unmount. This is an explicit in-memory test example, not a persistence backend.

Run `bun run packages:test flow-canvas`: generic isolated tarball installation, strict types/build, shipped graph/SSR/browser contract, removal and post-removal types/build. The module-owned optimizeDeps registration merges at Nuxt setup time, preserving caller Vite settings. Root production browser tests await public Nuxt hydration. Hosted exact-head browser/lifecycle/full-CI gates are mandatory; blocked local sockets do not waive them. Do not mark done before all gates pass.

## Removal

Remove the explicit root module and dependency, application-owned `app/pages/flow-test.vue` and `server/api/flow-reference.get.ts`, reference enablement and corresponding tests; run Bun install, typecheck and build. Consumers remove their imported component/helper usages and module entry. No database or external data is touched. Retain any application-owned graph documents according to the application's own retention policy.
