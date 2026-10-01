---
name: search-change
description: Maintaining PostgreSQL FTS expressions, owner-scoped search, exact rank keyset cursors, Search package lifecycle or privacy boundaries.
---

Read capability-change and database-migration guidance, capabilities/search/CAPABILITY.md and SEARCH_MODULE_EVALUATION.md. Keep explicit simple FTS, title/name A and body/description B, websearch_to_tsquery, ts_rank_cd normalization 32 and descending rank/timestamp/ID order aligned. Bind all user strings. Application owns authorization predicates and domain migrations; no central documents table or automatically created DB objects. Never log raw query text/SQL errors in telemetry. Preserve float4 rank and timestamp microseconds through canonical versioned bounded cursors. Cursors do not grant access or provide a snapshot. Removal preserves rows and applied migration history; physical cleanup needs a new reviewed migration. Verify real PostgreSQL owner/rank/pagination/privacy behavior and packed consumer install/removal; do not add a capability-specific CI job or optional integration dependency.
