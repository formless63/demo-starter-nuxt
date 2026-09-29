---
name: api-contract-change
description: Changing external API routes, OpenAPI contracts, machine credentials, API permissions, or public API versions.
---

# API contract change

Read `capabilities/api-platform/CAPABILITY.md`, `API_PLATFORM_MODULE_EVALUATION.md`, and the relevant application contract and native Nitro route files. Also use the auth-change workflow for credential/session changes and the database-migration workflow for schema changes.

- Keep native Nitro routes authoritative. Do not add a parallel router.
- Keep Zod runtime request/response schemas and the explicitly registered OpenAPI contract aligned. Add or update runtime and generated-spec tests with every public route change.
- Preserve stable, unique operation IDs. Treat path, method, schemas, errors, permissions, and operation IDs as versioned external API surface; consider a new API version for breaking changes.
- Treat machine permissions as security-sensitive. Test missing, invalid, revoked/expired, insufficient, authorized, and cross-owner behavior as applicable.
- Never accept credentials in query strings, log/store raw API keys, or return a raw key after its one-time creation response.
- Keep API keys separate from browser sessions. `enableSessionForAPIKeys` remains false, and key management requires the existing human session.
- Explicitly register only public application operations. Keep Better Auth, management, health, and other internal routes out of the application OpenAPI document unless deliberately promoted.
- Preserve standard error envelopes and avoid leaking stack traces or internal details.

Run the API package fixture hook through `bun run packages:test api-platform`, normal repository verification, and the production container smoke path when runtime packaging changes.
