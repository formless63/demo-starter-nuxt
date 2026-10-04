# Starter roadmap

## Current baseline: complete

All **29 capability modules** are implemented as native Nuxt workspace packages, enabled in the full reference application and verified through the catalog-driven CI matrix. Every capability remains **opt-in for a clean consumer** (`defaultInstalled: false`).

The [catalog](capabilities/catalog.json) is the machine-readable source of truth. Use the [capability guide](docs/CAPABILITIES.md) for behavior and the [project setup guide](docs/STARTING-A-PROJECT.md) for selection/removal. Individual contracts live under `capabilities/<id>/CAPABILITY.md`; decisions and historical verification live in [evaluations](docs/evaluations/).

Baseline framework, TypeScript, Bun tooling, Node production runtime, PostgreSQL/Drizzle, passwordless Better Auth, styling, Docker, tests and agent guidance are foundations, not optional modules.

### Completed modules and hard dependencies

| Capability | Requires |
| --- | --- |
| Jobs | Baseline only |
| API Platform / Machine Auth / OpenAPI | Baseline only |
| Observability | Baseline only |
| Object Storage | Baseline only |
| Email | Baseline only |
| Webhooks | jobs |
| Audit Log | Baseline only |
| AI | Baseline only |
| Cache / Coordination | Baseline only |
| Search | Baseline only |
| Realtime | Baseline only |
| Notifications | jobs |
| Import / Export | jobs, object-storage |
| Organizations / Tenancy | Baseline only |
| Authorization | Baseline only |
| Feature Flags | Baseline only |
| Invoice Ninja | jobs, webhooks |
| Stripe | jobs, webhooks |
| Medusa | jobs, webhooks |
| Ops / Admin | Baseline only |
| Command System | Baseline only |
| Data Table | Baseline only |
| Markdown / Code Content | Baseline only |
| Charts / Visualization | Baseline only |
| File UI | object-storage |
| Rich Text / Tiptap | Baseline only |
| Flow / Canvas | Baseline only |
| PWA / Offline | Baseline only |
| Internationalization | Baseline only |

“Baseline only” means no other capability is required; a capability can still require baseline authentication/database support or external infrastructure. The catalog distinguishes hard `requires`, optional `integratesWith`, baseline requirements and external services. Hard capability dependencies must remain acyclic.

## Next improvements

1. **Easy visual preview — in progress:** publish the full reference app to GHCR and provide a pull-only Compose setup with PostgreSQL, migrations, worker and a local mail inbox. See [container preview](docs/CONTAINER-PREVIEW.md).
2. **First real project — next:** use the existing setup/capability guidance, record setup friction and improve it from actual use. Do not build a second configuration framework.
3. **Streamline project creation — follow-up:** reduce manual pruning and demo removal; consider a clean initial migration after choosing modules for a new, disposable database. Preserve applied history for databases with data to retain.
4. **Releases and upgrades — follow-up:** stable tags, concise release notes and a reviewed downstream update process that preserves application customizations.
5. **Operations and presentation — follow-up:** a tested backup/restore and upgrade guide, plus clearer navigation/configuration hints in the reference UI after preview feedback.

These are improvements to using the completed starter, not additional promised capability modules. Prioritize preview feedback and a real project over expanding the module list.

## Existing setup workflows

Use `AGENTS.md`, the relevant `.agents/skills/` workflow and `docs/STARTING-A-PROJECT.md` before customization. Capability selection, hard-dependency review, configuration, removal and verification already have documented procedures. Nuxt uses its capability-change, feature-work and framework-specific skills; it does not currently have the TanStack `.project` onboarding/profile tooling.

## Deliberately outside this scope

- Optional library research (for example TanStack DB/AI/Pacer/Intent or Nuxt Content) needs a concrete application use case; it is not an unfinished module checklist.
- Public npm/add-on distribution, hosted provider accounts and production deployment remain separate decisions.
- Completed tests do not certify live payments, provider installations or application-specific access policy.
- Native Better Auth invitation acceptance is not claim-plus-membership crash-atomic. Preserve authoritative membership checks and the documented operator recovery procedure.

## Change procedure

Keep roadmap, catalog, capability contracts and relevant agent context aligned. Separate generated-consumer defaults from reference enablement. Use framework-native packaging, retain migrations/data on removal, and require applicable independent lifecycle, root, browser and production checks before marking new work complete. Do not weaken gates to promote status.
