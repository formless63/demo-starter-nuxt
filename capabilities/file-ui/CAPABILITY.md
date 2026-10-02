# File UI

Status: `in-progress`; `defaultInstalled:false`. Private native package `@repo/nuxt-file-ui` requires only Object Storage. Add both packages explicitly to Nuxt modules; the File UI module declares its native Storage module dependency and registers `FileManager`. It creates no routes, auth, database, workers, provider configuration or startup I/O.

## Public boundaries

`@repo/nuxt-file-ui/runtime` exports browser-safe FileView/FileClient/createFileClient. `FileManager` accepts `client`, `endpoint`, `maxBytes` and `label`. It owns accessible file selection, immutable retry tokens, cancellation, refresh and status presentation. New client/endpoint scopes suppress stale results. Cancellation is a request, not proof of server rollback. Pending uploads and cleanup remain visibly pending; no fabricated percentage or executable preview is rendered.

`@repo/nuxt-file-ui/server` exports createFileWorkflow, createFileStorage, createMemoryFileMetadata, createFileHttpHandler and the metadata/context contracts. Applications supply trusted authenticated identity/policy, an atomic owner-scoped metadata adapter and lazy storage. Do not accept owner, key, cleanup attestation or adapter configuration from clients. Custom storage adapters must provide one physical PUT attempt or retain uncertainty even after a later successful SDK retry. createFileStorage forces maxAttempts:1; ordinary Storage retains its three-attempt default.

## Upload and lifecycle contract

Default maximum is 10 MiB. Actual bounded raw bytes are counted and SHA-256 hashed before atomic reservation and PUT. Filenames are bounded, normalized and reject controls/path separators; MIME is validated. An opaque random key is generated server-side. Metadata reserves owner+idempotency token atomically with immutable byte/name/type fingerprint. Identical replay returns the current receipt without another PUT, including uploading/removed receipts; conflicting bytes or metadata reject. Readback verifies exact bytes before CAS readiness.

States: uploading, ready, cleanup-pending, removed. Metadata commit ambiguity causes a reread before cleanup. Metadata outages retain keys. Cancelled/uncertain PUTs quarantine their unique key; expiry is never proof a writer stopped, and uncertain keys are never reused. Operator-only reconcile requires independently established stopped writers before deletion. Cleanup retries have their own lifetime and retained terminal receipts. There is no zero-orphan guarantee; losing metadata loses safe cleanup evidence.

All downloads require application-authorized owner scope and ready state. They stream attachments as application/octet-stream with nosniff, private/no-store and sandbox CSP. Uploaded HTML is never served as an executable page. File names are escaped text in Vue.

## Native HTTP contract

The root uses H3 1.15.11/Nitro native handlers at `/api/files/{list,upload,download,remove}`. Trusted authenticate(event) and a configured origin are explicit server adapters. Cookie mutations require exact configured Origin plus X-File-UI:1. No HTTP reconciliation endpoint is exposed.

H3 1.15.11 getRequestWebStream attaches a flowing data listener without backpressure; readRawBody can concatenate unbounded bytes. The File UI transport therefore uses Node pause/resume with one queued chunk, byte checks before enqueue, a declared-length precheck, cancellation/timeouts, and rejects already-buffered or decoded middleware bodies and non-binary chunks. Install routes before middleware which consumes raw upload bodies. Native Node/Nitro is the supported transport; Web/prebuffered hosting adapters require a separately bounded ingress implementation. Socket/proxy request limits are recommended defense in depth, not the only upload limit.

## Reference and persistence

Root `/files` uses existing Better Auth and PostgreSQL, with application-owned Postgres.js/Drizzle metadata. Apply additive `0014_file_ui` (journal idx12, snapshot0012) explicitly; no runtime migration occurs. Preserve all prior SQL/snapshots and first12 journal entries. The package has no Auth, Jobs, Drizzle or database hard dependency.

The independent consumer uses explicitly bounded non-durable memory metadata solely for synthetic fixtures. Process restart loses receipts and cannot safely reclaim stored objects. Production consumers must implement durable atomic metadata before accepting real uploads.

## Verification and removal

`bun run packages:test file-ui` is the generic packed install/build/runtime/removal/rebuild contract, including actual Vue browser interactions, native transport, SDK local S3 protocol and pinned RustFS/Garage, plus retained provider data after removal. `bun run test:file-ui-reference` checks clean/upgraded PostgreSQL history, ownership/reservation/CAS/restart and real session-bound raw HTTP upload/download/replay/removal in development and production. Root tests cover mounted Vue, interruption/races, byte limits/backpressure and authenticated hydrated display. Hosted Docker, Chromium and native application gates are mandatory; constrained local checks do not substitute for them.

Remove the File UI module/dependency, reference page/routes/helpers and reference capability enablement, then regenerate the lockfile. Retain server/database/file-ui-schema.ts, its schema export, every migration/snapshot and durable receipts. Do not delete objects, buckets, provider volumes or credentials as an uninstall side effect. Remove Storage only when no other capability requires it. Cleanup/reconciliation is a separate deliberate operator action with stopped-writer evidence.
