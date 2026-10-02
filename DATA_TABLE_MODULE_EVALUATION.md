# Data Table module evaluation

## Decision and boundary

`@repo/nuxt-data-table` uses the pinned `@tanstack/vue-table` 9.2.4 adapter through `useTable`, explicit filtered/sorted/paginated row-model factories, built-in filter/sort registries, reactive state atoms, and `FlexRender`. It supplies a semantic table, stable caller-supplied row IDs, keyboard-operable sorting, visibility/selection controls, and pagination. It has no hard capability dependencies or external requirements and remains opt-in (`defaultInstalled: false`).

Applications own data fetching, authorization, query serialization, stale-response cancellation, and controlled state. Manual modes bypass the corresponding client row processing. Virtualization and provider-specific integrations are intentionally outside v1.

## Vue integration findings

- Stock v9 features provide state/APIs, not client row models; the module component registers its row-model factories explicitly.
- Controlled updates are emitted to the parent without optimistic mutation. Pagination reads reactive atoms and retains native pagination APIs.
- A numeric page count is synchronized from pre-paginated rows and page size in client mode, or the caller's manual count (`-1` if unknown). This avoids v9.2.4's undefined-ref merge fallback and inconsistent null clamping, including mode/count changes and the native unlimited-page-size case.
- A standalone package tsconfig makes a clean postinstall independent of the root generated `.nuxt` directory.
- The module registers its owned adapter prebundle during setup, preserving caller Vite options. Actual resolved client-config and module-absent tests cover the Nuxt Environment API boundary.

## Verification and completion evidence

[CI run 37008356538](https://github.com/formless63/demo-starter-nuxt/actions/runs/37008356538) passed all 20 jobs on `bfad9dce3ade72a42836d79103947de63a2a8279`, the implementation merged with the completed provider baseline. This includes all 18 packed capability lifecycles and the application check with authenticated browser, production container, explicit migration, health and worker verification.

Data Table-specific coverage includes real packed SSR pagination, ascending/descending sorting, global/column filters, composed processing, manual bypass, and navigation button state; clean uninstall/typecheck/rebuild; mounted controlled Next/page-size/rejected updates, filtering, mode changes, reactive totals and unlimited page size; and real reference-page browser interactions after Nuxt hydration. The final metadata promotion does not change runtime, dependencies or migrations; its exact-head CI must also pass before merging.
