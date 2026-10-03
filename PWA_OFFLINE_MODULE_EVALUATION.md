# Native Nuxt PWA / Offline evaluation

Reconstructed implementation; `in-progress` until independent review and exact-head hosted acceptance. No historical unpublished local tree is claimed recovered.

Choose stable official `@vite-pwa/nuxt` 1.1.1, `vite-plugin-pwa` 1.3.0 and Workbox build 7.4.1 (official npm registry checked 2026-10-03). Nuxt-native `injectManifest` runs at `nitro:build:public-assets`; do not port Start's multi-environment adapter. Native client registration is disabled; the Vue component owns explicit browser actions.

Sources: https://vite-pwa-org.netlify.app/frameworks/nuxt and https://github.com/vite-pwa/nuxt . The published module source confirms that Nuxt appends `_payload.json` and app-manifest globs before service-worker generation. Clear both `globPatterns` and `additionalManifestEntries` at the final native hook. Verify the emitted three-entry manifest and real Nitro HTTP artifact, not merely a source path or existing worker file.

No local-first database, private offline account snapshot, push, synchronization queue or mutation replay is proposed. Public fallback paths default empty. Notifications and Realtime are future optional integrations without implementation dependencies. Root `/pwa-test` explicitly opts into only an inert notice on thrown network failure; HTTP errors remain HTTP errors.

Use a two-phase same-URL/scope retirement deployment; retain the owned tombstone after package/source removal for dormant clients. A finite fixture cannot certify all real clients have returned. Hosted production/browser/package lifecycle and exact-head full CI are mandatory before completion.
