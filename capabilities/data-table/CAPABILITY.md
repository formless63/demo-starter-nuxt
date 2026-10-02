# Data Table

`@repo/nuxt-data-table` provides an opt-in Nuxt 4 `<DataTable>` component backed by `@tanstack/vue-table` 9.2.4. It renders a semantic table with keyboard-operable sort controls, live pagination status, stable caller-supplied row IDs, and controlled sorting, filtering, pagination, visibility, and selection state.

The component supports manual sorting, filtering, and pagination. Fetching, query serialization, stale-response cancellation, authorization, and server state remain application-owned; the package performs no network requests. v1 intentionally does not virtualize rows.

Install the package, register `@repo/nuxt-data-table` in `nuxt.config.ts`, and pass typed `ColumnDef` values. Use `v-model:sorting`, `v-model:column-filters`, `v-model:pagination`, `v-model:column-visibility`, and `v-model:row-selection` for controlled state. Keep `rowId` stable across refreshes.

No migrations, environment variables, runtime processes, providers, or hard capability dependencies are required. Removal deletes the dependency/module and rebuilds the clean consumer.
