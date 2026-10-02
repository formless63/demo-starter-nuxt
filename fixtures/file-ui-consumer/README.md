# File UI packed consumer

This is an isolated Nuxt 4 consumer of the packed `@repo/nuxt-file-ui` and its only hard dependency, `@repo/nuxt-storage`. It installs no application Auth, PostgreSQL, Jobs, Cache, Audit, Observability, API or Import/Export package. The fixture owns its synthetic opaque-cookie authentication resolver; the root reference app separately verifies real Better Auth sessions and durable PostgreSQL metadata.

## Metadata boundary

The explicit 32-record application metadata adapter and 8-record test adapters are **NON-DURABLE**, single-process test fixtures. Capacity fails closed and never evicts idempotency receipts. A real production Node process restart is tested: receipts disappear, old download IDs fail closed, and provider bytes remain. This does not claim memory metadata survives restarts or is production-safe. Pure lifecycle tests recreate the workflow over the same bounded adapter to cover cleanup retries and terminal receipts independently.

## Mandatory hosted gates

`bun run packages:test file-ui` uses only the generic catalog-driven lifecycle. The fixture runtime owns:

- Reviewed framework-neutral atomic lifecycle cases: owner isolation, reservation/publication ambiguity, cancellation and removal races, independent cleanup, readback corruption, limits, terminal receipts and capacity
- The real AWS S3 SDK against a local HTTP protocol, including an accepted PUT with lost response and late commit; File UI's storage factory forces exactly one attempt even if callers request three
- A built Nitro Node application, SSR without backend configuration, trusted synthetic sessions, raw binary/native chunked uploads, ingest bounds, CSRF, safe attachment headers, replay/conflict and owner isolation
- Chromium mounting the installed `FileManager`: actual hydration, keyboard/details, retry identity, ambiguous results, cancellation races, same-tick duplicate submit, stale list suppression, removal, scope reset, unmount and actual native upload/download bytes
- Actual pinned RustFS 1.0.0 and Garage 2.4.1 provider upload/hash/readback/replay/download/delete contracts

Docker, Chromium and permitted loopback sockets are required. There is no success skip, alternate mocked provider path, hidden privilege escalation or disabled security setting. Restricted local machines should run safe static/pure checks and report hosted gates as pending, then let the normal package CI matrix run the mandatory gates.

## Removal and cleanup

The runtime records two real object witnesses on each disposable provider: a ready File UI object and an independent Storage object. Generic tooling removes the File UI package, routes, page, browser fixture and File UI-specific test modules, reinstalls from the lockfile, then typechecks/builds the retained Storage app. The fixture's post-removal hook reads the exact original bytes and HEAD sizes, exercises fresh Storage operations and boots the rebuilt app to verify File UI routes are gone. Only the generic final cleanup hook deletes the synthetic objects and disposable Docker volumes, including partial-start failures. No application removal hook deletes user data or external resources.

Source adaptation: reviewed TanStack File UI `adaf33a8` framework-neutral protocol/lifecycle/browser assertions. The Nuxt-specific production server and mounted Vue tests execute packed public exports; they do not import workspace package source.
