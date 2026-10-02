# Flow / Canvas evaluation

Status: **done** after source CI and independent review; defaultInstalled false. Combined exact-head CI remains pending. Native Nuxt module, client-only Vue Flow enhancement, semantic server rendering and server-safe closed graph helpers. No React wiring or additional capability requirement.

Selected stable `@vue-flow/core` 1.48.2, verified against its official published package and [current guide](https://vueflow.dev/guide/controlled-flow.html). Native `applyDefault` otherwise mutates internally, so this package disables it and explicitly handles nodes-change, edges-change, connect and viewport events. [Viewport helpers](https://vueflow.dev/guide/utils/instance.html) are reconciled against application-accepted state. Stores are editor-local; required record keys discard stale interaction state. Fixed text renderers prevent imported executable configuration. The framework-independent graph schema matches TanStack's contract but Vue wiring is independent.

V1 intentionally omits custom renderer configuration, auto layout, workflow execution, database/storage adapters, localStorage autosave, collaboration and networking. Cycles are valid diagrams. Applications can inject a pure connection restriction, own persistence and integrate optional Realtime/Storage/Audit independently.

Packed strict types/build/SSR/browser/install/removal plus full exact-head hosted root verification are required before completion. Local Nitro/browser sockets are blocked and must not be bypassed or replaced with waived gates.

## Local checkpoint (2026-10-02)

Main ancestry is `073ca065d2e664cf00d8cca1c0e1829301b5e3f7` (21 completed baseline capabilities). Frozen Bun1.4.2 installation preserves every existing lockfile package record; only the new package/fixture and Vue Flow dependency closure are added. Module generation, 105 agent/governance tests, 33 shared graph cases on both Bun and Node24, 36 Vitest graph/controlled semantic UI tests, targeted ESLint, root strict Nuxt typecheck and production build passed. Root checks reused baseline generated package artifacts only after byte-for-byte comparison of all tracked package source files.

The independent packed consumer passed tarball install, strict typecheck, production build, shipped graph tests, actual Node SSR and UTF-8 content-type/meta/Unicode assertions. It stopped at the mandatory Chromium launch because the local executable was absent; browser interaction and removal/rebuild were therefore not claimed. The native vendor-ID encoding and final Escape/stale-event guard revisions require exact-head hosted retesting. No test gate was bypassed; the catalog remained in-progress at that checkpoint.

Vue Flow interpolates IDs in native handle selectors. The adapter converts bounded arbitrary graph IDs to collision-free ASCII codepoint IDs and reverse-maps native events; the graph document retains original IDs. The browser gate imports quote/bracket/newline/emoji IDs, connects actual native handles and exports the original IDs. Stored data is validated before Nuxt payload transport, and the component independently revalidates.

Independent review found and corrected two interrupted-interaction corners: wheel zoom now owns Escape even when focus is outside the canvas, and pointer cancellation/window blur clear ownership; rejected proposal identity expires after the immediate parent-update tick so a later equal-byte external load remounts old gestures. A new controlled regression passes (37 focused tests total). Native browser tests explicitly scroll before coordinate actions and prove a proposal or accepted movement occurred before checking rejection/cancellation. Both reference editors deliberately share documentKey/domain IDs; native handle IDs and unaffected independent transforms verify store isolation. Exact-head hosted verification remains required.

The first hosted root browser pass at `c9061f6` reached the Flow wheel-zoom assertion and observed zoom1, consistent with the offscreen-coordinate fixture gap found independently; 13 other application browser tests passed. The review fix keeps the assertion and scrolls/proves event delivery instead. Native SVG edge path IDs also now include editor identity, preventing duplicate DOM IDs when two isolated stores contain the same graph edge IDs. Equal-key browser coverage connects the same edge ID in both instances and verifies distinct path IDs. This checkpoint is not a full green gate.

## Source acceptance and 24-capability composition

Flow / Canvas source `1999dab23987aa90efa62411275b7075b974d593` passed [all 24 CI jobs](https://github.com/formless63/demo-starter-nuxt/actions/runs/37040851945), including the real native browser and independent packed install/runtime/removal/rebuild gates, and independent review. The combined 24-capability tree adds accepted main `bf15830889757b76b44a71fac80461deaca22cd1`; its full exact-head CI remains pending.

The source runtime, fixture and browser gates are preserved without alteration. Vue Flow reconciles nodes through setNodes, whose native parseNode reuses the existing graph-node object and measured dimensions; no analogous React measurement-reset patch is needed. All historical main migrations and existing package lock records are retained.
