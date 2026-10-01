---
name: ai-change
description: Changing server AI provider configuration, generation, structured validation, streaming, cancellation, safe errors or application integrations.
---

# AI changes

Read the capability-change skill, `capabilities/ai/CAPABILITY.md` and `AI_MODULE_EVALUATION.md`. The cross-framework v1 contract comes from the implementation prompt; do not consult another framework repository.

- Keep AI optional, server-only and operation-lazy. No install/build/boot/health provider requirement or automatic routes.
- Keep no hard Jobs/Storage/Observability/Audit/auth/database dependency and no general HTTP framework.
- Retain strict text bounds, finite normalized finish/usage, incremental output cap and authoritative Zod validation.
- Disable SDK logging and retries explicitly. Compose cancellation/deadline, interrupt pending reads and close on consumer return/disconnect. No raw provider errors/causes/chunks/responses in public APIs.
- Never log prompts/output/keys/headers/model labels. Optional telemetry uses only contract allowlisted fields; audit facts exclude content.
- Exercise the real packed SDK adapter with the local HTTP fixture for wire errors, truncation, overflow, timeout/cancellation and Nitro disconnect; do not replace it with mocked SDK methods.
- Verify `bun run packages:test ai`, normal checks and production boot; removal keeps external accounts/secrets untouched and needs no migration.
- Stay within v1: no agents/tools/MCP/RAG/UI/history/queued AI or later capabilities.
