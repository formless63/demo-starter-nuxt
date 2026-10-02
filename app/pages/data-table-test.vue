<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ColumnDef, RowSelectionState, SortingState } from '@tanstack/vue-table'
type Person = { id: string; name: string; score: number }
const rows = ref<Person[]>([{ id: 'a', name: 'Alpha', score: 3 }, { id: 'b', name: 'Beta', score: 2 }, { id: 'c', name: 'Gamma', score: 1 }])
const sorting = ref<SortingState>([]), globalFilter = ref(''), pagination = ref({ pageIndex: 0, pageSize: 2 }), selection = ref<RowSelectionState>({}), columnVisibility = ref<Record<string, boolean>>({})
const loading = ref(false), error = ref<string | null>(null), rejectUpdates = ref(false), manualMode = ref(false), pageCount = ref(2)
const columns: ColumnDef<any, Person, any>[] = [{ accessorKey: 'name', header: 'Name', enableSorting: true }, { accessorKey: 'score', header: 'Score', enableSorting: true }]
function updateSorting(value: SortingState) { if (!rejectUpdates.value) sorting.value = value }
function updateFilter(value: string) { if (!rejectUpdates.value) globalFilter.value = value }
</script>
<template><main><h1>Data Table Test</h1><button data-testid="replace" @click="rows = [rows[2]!, rows[0]!, rows[1]!]">Replace rows</button><button data-testid="reject" @click="rejectUpdates = !rejectUpdates">Reject updates</button><button data-testid="manual" @click="manualMode = !manualMode">Manual mode</button><button data-testid="loading" @click="loading = !loading">Loading</button><button data-testid="error" @click="error = error ? null : 'Unable to load rows'">Error</button><DataTable :sorting="sorting" :global-filter="globalFilter" :column-visibility="columnVisibility" :row-selection="selection" :pagination="pagination" :manual-filtering="manualMode" :manual-pagination="manualMode" :page-count="pageCount" :data="rows" :columns="columns" :row-id="row => row.id" :loading="loading" :error="error" :enable-row-selection="true" @update:sorting="updateSorting" @update:global-filter="updateFilter" @update:column-visibility="value => columnVisibility = value" @update:row-selection="value => selection = value" @update:pagination="value => pagination = value" /></main></template>
