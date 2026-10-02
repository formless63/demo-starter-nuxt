<script setup lang="ts">
import type { ColumnFiltersState, SortingState } from '@repo/nuxt-data-table/runtime'
type Person = { id: string; name: string }
const rows: Person[] = [{ id: 'b', name: 'Beta' }, { id: 'a', name: 'Alpha' }, { id: 'c', name: 'Gamma' }]
const columns = [{ accessorKey: 'name', header: 'Name', enableSorting: true }]
const query = useRoute().query
const sorting: SortingState = query.sort ? [{ id: 'name', desc: query.sort === 'desc' }] : []
const columnFilters: ColumnFiltersState = query.column ? [{ id: 'name', value: String(query.column) }] : []
const pagination = { pageIndex: query.page === '2' ? 1 : 0, pageSize: 2 }
const manual = query.manual === 'true'
</script>
<template><DataTable :data="rows" :columns="columns" :row-id="row => row.id" :enable-row-selection="true" :sorting="sorting" :global-filter="String(query.filter ?? '')" :column-filters="columnFilters" :pagination="pagination" :manual-sorting="manual" :manual-filtering="manual" :manual-pagination="manual" :page-count="manual ? 5 : undefined" /></template>
