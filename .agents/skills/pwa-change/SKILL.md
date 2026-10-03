---
name: pwa-change
description: Changing the public-only service worker, native Nuxt PWA build, install UX, cache policy, scope or retirement deployment.
---

# PWA changes

Read `capabilities/pwa-offline/CAPABILITY.md` and use `capability-change` for package relationships.

- Preserve the fixed three-file allowlist and integrity hashes. Never add SSR, payload, app-manifest, private/API/auth/upload, application chunk, error, third-party or mutation caching. Public fallback paths default empty and require explicit application review.
- Native `@vite-pwa/nuxt` appends globs. Clear both globs and additional manifest entries only at its final worker hook; keep exact emitted-manifest verification. Recreate generated source before Vite resolution and the native hook.
- Preserve credentials omission, redirect refusal, strict headers/MIME/status/URL/SHA checks and a bounded install deadline. Existing version caches are verified read-only; failed install may delete only a newly created owned partial cache.
- Never force activation, claim clients, reload/navigate forms or delete another scope's worker/cache. Install prompts require trusted browser events and an actual user gesture. Detach listeners and cancel late prompt results on unmount.
- Retirement is two-phase: same worker URL/scope, natural activation, then retain exact tombstone bytes through lean builds for dormant clients. A fixture receipt cannot certify all deployed clients.
- Run packed native production HTTP/browser/removal and root private-session isolation. Actual live-worker bytes, exact assets/headers and SSR manifest must pass before browser assertions. Use awaited `expect.poll` for async browser predicates, never async `waitForFunction`. Keep the false/false/true regression.
- Local browser unavailability is a blocker, never a skip or acceptance. Independent review and complete exact-head hosted CI are required before status promotion.
