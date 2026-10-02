# Data Table

`@repo/nuxt-data-table` provides an opt-in Nuxt 4 `<DataTable>` component backed by `@tanstack/vue-table` 9.2.4. It renders a semantic table with keyboard-operable sort controls, live pagination status, stable caller-supplied row IDs, and controlled sorting, filtering, pagination, visibility, and selection state.

The component supports manual sorting, filtering, and pagination. Fetching, query serialization, stale-response cancellation, authorization, and server state remain application-owned; the package performs no network requests. v1 intentionally does not virtualize rows.

Install the package, register `@repo/nuxt-data-table` in `nuxt.config.ts`, and pass typed `ColumnDef` values. Use `v-model:sorting`, `v-model:column-filters`, `v-model:pagination`, `v-model:column-visibility`, and `v-model:row-selection` for controlled state. Keep `rowId` stable across refreshes.

No migrations, environment variables, runtime processes, providers, or hard capability dependencies are required. Removal deletes the dependency/module and rebuilds the clean consumer.

## Verified v1 and reference integration

The catalog status is `done`; the root reference explicitly enables the package and `/data-table-test`, while clean consumers remain opt-in. The adapter uses the v9 `useTable` API with explicit client row models. `v-model:global-filter` is also supported. For manual pagination, pass `pageCount` when known; an omitted count means an unknown total.

The module owns its `@tanstack/vue-table` development prebundle and preserves existing Vite optimization options. Controlled pagination uses reactive numeric totals so parent-rejected updates do not change rendered rows and manual/client transitions do not retain stale counts.

Run `bun run packages:test data-table` for actual packed SSR and removal coverage. Mounted-component/config tests and the root browser scenario cover live controls and reactivity. [The implementation CI](https://github.com/formless63/demo-starter-nuxt/actions/runs/37008356538) passed all 20 jobs at `bfad9dce3ade72a42836d79103947de63a2a8279`; later commits require fresh exact-head CI. See the [evaluation](../../DATA_TABLE_MODULE_EVALUATION.md) and [root removal recipe](../../docs/STARTING-A-PROJECT.md#remove-data-table).
