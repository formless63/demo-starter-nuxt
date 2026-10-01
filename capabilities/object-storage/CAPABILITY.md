# Object Storage capability

`@repo/nuxt-storage` is capability #4: a private, publish-shaped, server-only Nuxt 4 package. Clean consumers explicitly opt in (`defaultInstalled: false`); the root reference app enables it. See [evaluation](../../OBJECT_STORAGE_MODULE_EVALUATION.md).

## Requirements

Requires:

- No reusable capability. Nuxt 4/Nitro and Node 24 are runtime requirements, not module edges.

Integrates with:

- Observability through an optional application-owned operation runner.
- Jobs as a future consumer for cleanup, processing or long-running workflows. No such jobs are implemented here.

External:

- S3-compatible storage and an existing private bucket **when operations are used**. RustFS is preferred; Garage passes the same contract. Neither is needed to install, typecheck, build or boot the app.

## Adds

### Dependencies

Owns `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` 3.1143.0, plus Nuxt Kit 4.5.2. Nuxt is a peer. No provider SDK, `lib-storage`, database/auth/Jobs/Observability dependency or `moduleDependencies` is added. Only server artifacts import AWS SDK code.

### Environment

Configuration is evaluated lazily at the first operation/client access; invalid values produce safe `StorageError('configuration')` diagnostics without echoing configuration. `createStorage(options)` accepts explicit server configuration and optional `env` for isolated processes/tests; explicit options override environment.

| Variable | Behavior |
| --- | --- |
| `STORAGE_BUCKET` | Existing bucket required on use; fixed for all package operations |
| `STORAGE_REGION` | Falls back to `AWS_REGION`, then `AWS_DEFAULT_REGION`; missing region is a configuration error **on use**, not build/boot. Local helpers explicitly supply `us-east-1` for RustFS and `garage` for Garage |
| `STORAGE_ENDPOINT` | Optional HTTP(S) origin, no credentials/query/path; absent uses normal AWS endpoint resolution |
| `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY` | Both or neither; missing half is rejected |
| `STORAGE_SESSION_TOKEN` | Optional with explicit credentials; AWS credential-chain tokens remain SDK-owned |
| `STORAGE_FORCE_PATH_STYLE` | `true`/`false`; unset/empty defaults true for a custom endpoint, false for AWS |
| `STORAGE_PRESIGN_TTL_SECONDS` | Default 600; integer 30–3600; per-request override uses the same bounds |
| `STORAGE_KEY_PREFIX` | Optional safe prefix; trailing slashes normalized for generated keys |

When static credentials are absent, the SDK's standard Node credential chain remains intact (including environment, profile, container/task, instance and workload mechanisms supported by AWS). Do not configure empty/static credentials in place of that chain. Production deployments supply these server variables through secrets/environment; none belongs in `runtimeConfig.public`. Root Compose forwards Storage settings to the app only and does not start storage infrastructure. Inside containers use a reachable service/address, not host localhost. A presigned URL's endpoint must also be reachable by the browser; do not rewrite its signed host/path afterward.

### Scripts

- `bun run storage:check`: read-only HEAD bucket check; no creation.
- `bun run storage:smoke`: temporary unique-key contract exercise with cleanup in `finally`; explicitly writes objects but never creates/deletes buckets.
- `bun run storage:dev:rustfs` / `storage:dev:garage`: explicitly start and bootstrap **local development** services/bucket/CORS.
- `bun run storage:dev:down`: stop only the named development project; retain volumes/data.
- `bun run packages:build object-storage` / `packages:test object-storage`: generic packed lifecycle.

No CLI/bin is necessary for v1. The small root operator adapters call package-owned `/server` and `/testing` APIs rather than copying operation logic or rewriting a consumer manifest. External consumers can make the same calls from their own runner; `/testing` is a deliberate opt-in smoke helper, never auto-loaded runtime code.

### Database/migrations

None. No files table, upload intent, owner record or multipart session state is created. Consumers persist their own workflow state if needed.

### Runtime processes

Runs inside Nitro or an explicit standalone caller. `getStorage()` is a lazy process singleton; Nitro close destroys it. Explicit `createStorage()` instances belong to the caller: call `.close()` at shutdown. The root optional instrumented instance has its own close hook.

### Compose/infrastructure

Normal `compose.yaml` services and `docker compose up -d postgres` remain unchanged. `compose.storage.yaml` includes the same provider definitions used by the external fixture. It is local/operator infrastructure, not part of normal app/worker deployment:

```sh
bun run storage:dev:rustfs
# Or: bun run storage:dev:garage
# Follow printed endpoint and credentials in the development Compose configuration.
bun run storage:check
bun run storage:smoke
bun run storage:dev:down
```

Development-only default RustFS access key is `starter-storage-dev`; secret is `local-only-storage-secret-change-me`. Garage uses `GK0123456789abcdef0123456789abcdef` with that same development secret. Bucket is `starter-storage`. Override `STORAGE_DEV_ACCESS_KEY`, `GARAGE_DEV_ACCESS_KEY`, `STORAGE_DEV_SECRET_KEY`, `STORAGE_DEV_BUCKET` before initial bootstrap. Named volumes retain objects and Garage identity/layout. Do not change Garage bootstrap credentials on an existing volume and assume existing keys were replaced.

RustFS image `rustfs/rustfs:1.0.0` exposes localhost S3 9000 and console 9001; override `RUSTFS_PORT` / `RUSTFS_CONSOLE_PORT`. Garage `dxflrs/garage:v2.4.1` uses SQLite, replication factor 1 and explicit `server --single-node --default-bucket` with development environment credentials; S3 localhost 3900 (`GARAGE_PORT`), no exposed admin/RPC port. These single-node defaults and committed dev RPC/admin tokens are **not production security/redundancy configuration**. Production bucket creation, permissions, lifecycle, backups and redundancy are operator/IaC decisions; application startup never provisions them.

Optional third-party [Noooste Garage UI v0.13.0](https://github.com/Noooste/garage-ui/tree/v0.13.0), image **`noooste/garage-ui:v0.13.0`**, is **not official Garage software**. It is optional development/operator tooling, not required for S3 operation or an application dependency. Tested with Garage 2.4.1; review upstream/security before upgrades or exposure. It stays localhost-bound at 3909 (`GARAGE_UI_PORT`), mapping container port 8080.

The UI mounts `garage.toml` read-only through `GARAGE_UI_GARAGE_TOML=/etc/garage.toml`, reading the region and privileged admin token. `GARAGE_UI_GARAGE_ENDPOINT=http://garage:3900` and `GARAGE_UI_GARAGE_ADMIN_ENDPOINT=http://garage:3903` override listener addresses for Compose networking; `GARAGE_UI_AUTH_TOKEN_ENABLED=true` explicitly requires operator token login. Enter the local-only admin token `local-only-garage-admin-change-me` in the **operator UI**; `/auth/login-token` exchanges it for a signed UI session token. S3 credentials cannot authenticate as administrators. `/health` and `/auth/config` are public health/auth-method metadata, while `/api/v1/cluster/status` requires authentication and proxies the privileged Garage admin API.

The UI has privileged administrative access, not merely normal S3 client access. Its admin token/credentials must **never reach browser application code, public runtime config or normal S3 clients**. Operator UI login is a separate administrative trust boundary. All committed tokens/credentials are known **local-development-only** values; use separate operator secrets and deliberate network/auth policy outside development. Do not publish Garage admin/RPC ports or expand administration through application routes:

```sh
docker compose -p starter-storage-dev -f compose.storage.yaml --profile garage --profile garage-ui up -d garage garage-ui
docker compose -p starter-storage-dev -f compose.storage.yaml --profile garage --profile garage-ui logs -f garage garage-ui
```

The bootstrap commands require Docker permissions. On this workstation `STORAGE_DOCKER_SUDO=true` uses passwordless sudo while preserving only the named development settings; normal Docker-capable CI/hosts need no flag. `storage:dev:down` retains volumes; add `--volumes` to a specifically named Compose teardown only when deliberately deleting local storage.

### Browser CORS

Trusted local origin defaults to `http://localhost:3000` (`STORAGE_DEV_ORIGIN`). RustFS listener uses `RUSTFS_CORS_ALLOWED_ORIGINS`; explicit bootstrap sets bucket CORS on both providers using standard `PutBucketCors`. Rules permit GET/PUT/HEAD and needed headers, exposing `ETag` for multipart completion. Add application-specific `x-amz-meta-*` headers deliberately when needed. Recreate RustFS after changing its listener origin. Tests prove the trusted preflight is allowed and an untrusted origin is not.

Use explicit production origins such as `https://app.example.com`, never a wildcard-by-default rule. CORS controls browser access, **not object/user authorization**; signed URLs are bearer grants. Do not include S3 credentials in browser requests.

## Application API

Package root: Nuxt module. `@repo/nuxt-storage/server`: `createStorage`, `getStorage`, `closeStorage`, `createStorageKey`, key/config helpers and safe errors. Only `getStorage` is server auto-imported, intentionally distinct from Nitro's existing `useStorage` (unstorage). Each Storage instance provides:

- `checkStorage`, `putObject`, `getObject`, `headObject`, `deleteObject`, `listObjects` (prefix, bounded 1–1000 results, continuation token).
- `presignUpload`, `presignDownload`: return `{url, method, headers, expiresIn}`.
- `createMultipartUpload`, `presignMultipartPart`, `completeMultipartUpload`, `abortMultipartUpload`.
- `createKey(namespace)`, `verifyUploadedObject`, `getS3Client`, `close`.

```ts
import { getStorage } from '@repo/nuxt-storage/server'

const storage = getStorage()
// Authenticate/authorize BEFORE granting a key or signed URL; this package has no policy.
const key = storage.createKey('documents')
const upload = await storage.presignUpload(key, { contentType: 'application/pdf' })
// Send every upload.headers entry with exactly that value in the browser PUT.
// After upload, before application acceptance:
await storage.verifyUploadedObject(key, {
  maxBytes: 10 * 1024 * 1024, contentType: 'application/pdf', deleteOnFailure: true,
})
```

Keys default to `<prefix>/<validated-application-namespace>/<UUID>`, never a browser filename or hidden user/org identity. Reject leading slash, traversal/empty segments, control/space characters, backslash, URL delimiters/encoding and more than 1024 bytes. Namespaces are lowercase application-owned identifiers. Explicit keys remain possible but require application authorization; a prefix is organization, not an enforced tenant boundary. Store original filename separately in validated application metadata, not the key. Safe user metadata uses lowercase ASCII names and printable ASCII values (bounded); never store secrets there.

HEAD/GET expose key, size, ETag, content type, cache control, modified time and metadata. ETag is an opaque provider identifier, **not a cryptographic content hash**. GET returns the SDK stream body without buffering unknown-size data: consume/pipe it or destroy the Node readable (or cancel its transformed web stream) on abandonment. `transformToString`/`transformToByteArray` are only appropriate for known-small objects. GET operation duration measures response/stream acquisition, not full body transfer; consumers own transfer-error/byte instrumentation.

No public ACL, public-read policy or public URL is installed. Normal server operations use SigV4; callers can still grant short-lived private access with signed URLs. Upload headers explicitly sign `content-type`/`cache-control`, with metadata headers unhoisted and signed. Wrong Content-Type fails authentication in both providers. URLs contain ordinary SigV4 credential identifiers/signatures (and session token when applicable); treat them as secrets and never log/trace them. Temporary credentials may expire earlier than the requested TTL.

GET/PUT are the common browser interface; POST forms are not required (RustFS POST checksum compatibility is incomplete). Direct PUT does **not** guarantee a universal pre-ingest byte limit. Client checks are UX only; authoritative post-upload HEAD checks maximum size/type/expected metadata. `deleteOnFailure` explicitly removes the caller-selected object on policy failure; without it the caller decides cleanup. HEAD cannot prove content safety or protect against later replacement: design application acceptance/overwrite rules deliberately. Hard pre-ingest limits require proxying or a deliberately supported stronger mechanism.

Multipart primitives validate IDs, part numbers 1–10000, opaque nonempty ETags and strictly ascending completion parts. Persist IDs/ETags and resume state in application code if needed; authorize each step. S3 part-size rules remain provider-enforced (all except the last usually at least 5 MiB). Explicitly abort abandoned sessions. No automatic database state/background cleanup is added.

`getS3Client()` is an explicit server escape hatch for reviewed provider/admin operations; bypassing the primitive also bypasses safe error/telemetry normalization. Automatic optional CRC request/response checksum behavior is `WHEN_REQUIRED` for common S3 compatibility; no blanket content-integrity guarantee is claimed. Production deployments needing integrity/versioning/encryption controls must choose and test them deliberately.

Safe errors expose only `configuration`, `invalid-input`, `unavailable`, `not-found`, `verification-failed`, never raw SDK errors, endpoint credentials or signed URL stacks. `checkStorage()` returns `{ok:true}` or throws that safe error; do not return provider internals to clients. Root `/api/health` keeps its existing database readiness and does not become dependent on optional Storage.

`runOperation(operation, action, bytes?)` is an optional generic runner useful for timing/testing without Observability. Root `runStorageOperation` uses bounded `app.storage.operation`/`outcome` dimensions, duration and known PUT byte measurements plus a safe span/log. No bucket/key/filename/upload ID/user ID/URL is a dimension or default log field. Removing Observability requires replacing/removing this app-owned runner, not changing Storage. No Jobs imports exist; future cleanup/process jobs would simply consume this server API.

## Installation

1. Keep/add `@repo/nuxt-storage: workspace:*` in this clone, or pack it locally and install the tarball in a compatible clean Nuxt app. Nothing is published.
2. Explicitly add `'@repo/nuxt-storage'` to Nuxt modules.
3. Provision a private bucket separately; configure server environment/credentials only when operations are needed.
4. Add deliberate application auth/key/policy checks, optional telemetry and stream lifecycle handling. No public route/UI is created by the module.
5. Run packed lifecycle and provider contract verification.

## Removal

Remove module/dependency, app wrappers/imports/close hook, storage command aliases, environment configuration and optional development Compose include/assets; update reference enablement and catalog script declarations. Clear generated state, reinstall and typecheck/build. No database migration exists. Generic external fixture removal verifies AWS dependencies disappear when unused; a temporary reference copy verifies broader root integration removal. See [root recipe](../../docs/STARTING-A-PROJECT.md#remove-object-storage).

**Never delete remote objects/buckets or revoke external keys automatically.** Stopping local providers retains named volumes. Permanent fork pruning may also delete package, fixture, evaluation, contract and storage skill only after updating catalog/docs; retain the roadmap ID if other capabilities reference it.

## Upgrade considerations

Keep AWS client/presigner pinned together, inspect signing/checksum/credential-chain changes, rerun the same actual RustFS/Garage contract (no provider skips), CORS, module runtime and install/removal. Pin stable provider/UI images and review Garage layout/migration requirements before reusing volumes. Before npm publication choose a scope, review supported Nuxt/Nitro/Node and peer ranges, licenses, safe error/API contracts and tarball contents. This is a primitive, not an installer or storage administration framework.

## Verification

```sh
bun run capabilities:status
bun run capabilities:check
bun run packages:test object-storage
bun run packages:test jobs api-platform observability
bun fixtures/storage-consumer/.fixture/reference-removal.ts
bun run check
bun run test:e2e
```

The fixture owns backendless production boot, real pinned containers, explicit bootstrap, common object/list/metadata/stream/signing/type-mismatch/multipart/verification/delete contract, CORS and Noooste UI health/token authentication/admin communication. Generic tooling owns real tarball install, owned-dependency arrival, typecheck/build, removal/generated-state cleanup and post-removal build. It has no Jobs/API/Observability dependency or mandatory config at build time. Catalog matrix discovers it without a handwritten CI job. Normal production image/migration/app/worker health and optional dev profiles are separately verified.

## Agent guidance

Use `capability-change` and `storage-change`. Keep S3 credentials server-only, objects private, configuration lazy, bootstrap explicit, streams consumed/closed, signed headers exact and metric dimensions bounded. No File UI, attachment/files table, transforms, scanner, CDN policy, upload intent or processing jobs belong in this capability.

Server-only `createStorage({maxAttempts})` accepts integer 1–3; default 3 preserves ordinary operation retries. Application diagnostics may select 1 on a separate caller-owned lazy client. No environment knob or SDK middleware mutation is introduced.
