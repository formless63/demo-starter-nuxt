# Native Nuxt PWA / Offline evaluation

Reconstructed implementation; `done`, reference-enabled and `defaultInstalled: false` after independent review and exact-source hosted acceptance. No historical unpublished local tree is claimed recovered.

Choose stable official `@vite-pwa/nuxt` 1.1.1, `vite-plugin-pwa` 1.3.0 and Workbox build 7.4.1 (official npm registry checked 2026-10-03). Nuxt-native `injectManifest` runs at `nitro:build:public-assets`; do not port Start's multi-environment adapter. Native client registration is disabled; the Vue component owns explicit browser actions.

Sources: https://vite-pwa-org.netlify.app/frameworks/nuxt and https://github.com/vite-pwa/nuxt . The published module source confirms that Nuxt appends `_payload.json` and app-manifest globs before service-worker generation. Clear both `globPatterns` and `additionalManifestEntries` at the final native hook. Verify the emitted three-entry manifest and real Nitro HTTP artifact, not merely a source path or existing worker file.

No local-first database, private offline account snapshot, push, synchronization queue or mutation replay is proposed. Public fallback paths default empty. Notifications and Realtime are future optional integrations without implementation dependencies. Root `/pwa-test` explicitly opts into only an inert notice on thrown network failure; HTTP errors remain HTTP errors.

Use a two-phase same-URL/scope retirement deployment; retain the owned tombstone after package/source removal for dormant clients. A finite fixture cannot certify all real clients have returned. Hosted production/browser/package lifecycle gates passed on the source below; the final metadata promotion still requires its own exact-head full CI.

## Verified source and promotion status

PWA / Offline source `5214f541fdbf6c3c8c7842a749d74ab437ad5a54` passed [all 28 hosted CI jobs](https://github.com/formless63/demo-starter-nuxt/actions/runs/37132857767), including all 26 generic packed lifecycles and the root production authenticated-session/privacy/offline-fallback checks. Independent review is complete. All 26 capabilities are done, explicitly reference-enabled and default-off. This metadata-only promotion requires its own exact-head full CI before acceptance. The intermittent anonymous Search timeout did not recur; diagnostic-only success does not establish its cause or a runtime fix.
