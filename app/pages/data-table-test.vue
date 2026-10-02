<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ColumnDef, RowSelectionState, SortingState } from '@tanstack/vue-table'
type Person = { id: string; name: string; score: number }
const rows = ref<Person[]>([{ id: 'a', name: 'Alpha', score: 3 }, { id: 'b', name: 'Beta', score: 2 }, { id: 'c', name: 'Gamma', score: 1 }])
const sorting = ref<SortingState>([])
const selection = ref<RowSelectionState>({})
const loading = ref(false)
const error = ref<string | null>(null)
const columns: ColumnDef<any, Person, any>[] = [{ accessorKey: 'name', header: 'Name', enableSorting: true }, { accessorKey: 'score', header: 'Score', enableSorting: true }]
</script>
<template><main><h1>Data Table Test</h1><button data-testid="replace" @click="rows = [rows[2]!, rows[0]!, rows[1]!]">Replace rows</button><button data-testid="loading" @click="loading = !loading">Loading</button><button data-testid="error" @click="error = error ? null : 'Unable to load rows'">Error</button><DataTable v-model:sorting="sorting" v-model:row-selection="selection" :data="rows" :columns="columns" :row-id="row => row.id" :loading="loading" :error="error" :enable-row-selection="true" /></main></template>
