---
name: storage-change
description: Changing S3 object operations, signed URLs, multipart uploads, storage configuration, provider compatibility, or upload verification policy.
---

# Storage change

Read `capabilities/object-storage/CAPABILITY.md` and `OBJECT_STORAGE_MODULE_EVALUATION.md`; use `capability-change` for package/infrastructure contract changes.

- Credentials and SDK clients remain server-only. Preserve the AWS default credential chain when static credentials are absent; reject half-configured pairs.
- Private by default: no public ACL/policy/URL, no hidden user/tenant authorization. Application code authorizes every object and signing operation.
- Never log credentials, signed URLs/query parameters, full keys or filenames. Use bounded operation/outcome dimensions; optional Observability stays app-owned.
- Raw filenames are not generated object keys. Preserve namespace/prefix/traversal/control/length validation and opaque random IDs.
- Never provision buckets on installation/startup/first request. Provider-specific admin/bootstrap configuration belongs outside the public Storage API.
- Signed PUT headers must exactly match signed values; test wrong Content-Type against both providers. Direct PUT maximum bytes are verified by post-upload HEAD unless stronger pre-ingest enforcement is deliberately implemented; client checks are not security.
- GET remains streaming. Consume/close abandoned bodies; never buffer unknown-size downloads as an incidental refactor.
- Preserve validated multipart IDs/parts/ETags/order and explicit abort/cleanup; no hidden database session state or processing jobs.
- Rerun the same real RustFS and Garage common contract, CORS and catalog-driven packed install/removal. Do not skip a failing provider operation and claim parity. Pin stable images and recheck UI maintenance/version/admin authentication separately.
- Removal changes code/config only, never automatically deleting remote objects/buckets or revoking external keys. Preserve local volumes unless intentional deletion is separately in scope.

Keep this a server S3 primitive; File UI, attachments, transforms, public/CDN policy and application workflow records belong elsewhere.
