<script setup lang="ts" generic="TData extends Record<string, unknown>">
import {
  FlexRender, getCoreRowModel, getFilteredRowModel, getPaginationRowModel, getSortedRowModel,
  useVueTable, type ColumnDef, type ColumnFiltersState, type PaginationState, type RowSelectionState,
  type SortingState, type VisibilityState,
} from '@tanstack/vue-table'
import { computed, ref, watch } from 'vue'

const props = withDefaults(defineProps<{
  data: TData[]
  columns: ColumnDef<TData, unknown>[]
  rowId?: (row: TData, index: number) => string
  sorting?: SortingState
  columnFilters?: ColumnFiltersState
  pagination?: PaginationState
  columnVisibility?: VisibilityState
  rowSelection?: RowSelectionState
  manualSorting?: boolean
  manualFiltering?: boolean
  manualPagination?: boolean
  pageCount?: number
  enableRowSelection?: boolean
  pageSizeOptions?: number[]
}>(), { sorting: () => [], columnFilters: () => [], pagination: () => ({ pageIndex: 0, pageSize: 10 }), columnVisibility: () => ({}), rowSelection: () => ({}), pageSizeOptions: () => [10, 25, 50] })

const emit = defineEmits<{ 'update:sorting': [SortingState]; 'update:columnFilters': [ColumnFiltersState]; 'update:pagination': [PaginationState]; 'update:columnVisibility': [VisibilityState]; 'update:rowSelection': [RowSelectionState] }>()
const sorting = ref(props.sorting), columnFilters = ref(props.columnFilters), pagination = ref(props.pagination), columnVisibility = ref(props.columnVisibility), rowSelection = ref(props.rowSelection)
watch(() => props.sorting, value => { sorting.value = value }); watch(() => props.columnFilters, value => { columnFilters.value = value }); watch(() => props.pagination, value => { pagination.value = value }); watch(() => props.columnVisibility, value => { columnVisibility.value = value }); watch(() => props.rowSelection, value => { rowSelection.value = value })
const table = useVueTable({ get data() { return props.data }, get columns() { return props.columns }, state: { get sorting() { return sorting.value }, get columnFilters() { return columnFilters.value }, get pagination() { return pagination.value }, get columnVisibility() { return columnVisibility.value }, get rowSelection() { return rowSelection.value } }, onSortingChange: updater => { const next = typeof updater === 'function' ? updater(sorting.value) : updater; sorting.value = next; emit('update:sorting', next) }, onColumnFiltersChange: updater => { const next = typeof updater === 'function' ? updater(columnFilters.value) : updater; columnFilters.value = next; emit('update:columnFilters', next) }, onPaginationChange: updater => { const next = typeof updater === 'function' ? updater(pagination.value) : updater; pagination.value = next; emit('update:pagination', next) }, onColumnVisibilityChange: updater => { const next = typeof updater === 'function' ? updater(columnVisibility.value) : updater; columnVisibility.value = next; emit('update:columnVisibility', next) }, onRowSelectionChange: updater => { const next = typeof updater === 'function' ? updater(rowSelection.value) : updater; rowSelection.value = next; emit('update:rowSelection', next) }, getRowId: props.rowId, manualSorting: props.manualSorting, manualFiltering: props.manualFiltering, manualPagination: props.manualPagination, pageCount: props.pageCount, enableRowSelection: props.enableRowSelection, getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel(), getFilteredRowModel: getFilteredRowModel(), getPaginationRowModel: getPaginationRowModel() })
const rows = computed(() => table.getRowModel().rows)
</script>

<template>
  <div class="data-table" role="region" aria-label="Data table" tabindex="0">
    <table>
      <thead><tr v-for="headerGroup in table.getHeaderGroups()" :key="headerGroup.id"><th v-for="header in headerGroup.headers" :key="header.id" scope="col"><button v-if="!header.isPlaceholder && header.column.getCanSort()" type="button" :aria-label="`Sort by ${String(header.column.columnDef.header ?? header.id)}`" @click="header.column.getToggleSortingHandler()?.($event)"><FlexRender :render="header.column.columnDef.header" :props="header.getContext()" /><span aria-hidden="true">{{ header.column.getIsSorted() === 'asc' ? ' ↑' : header.column.getIsSorted() === 'desc' ? ' ↓' : '' }}</span></button><template v-else-if="!header.isPlaceholder"><FlexRender :render="header.column.columnDef.header" :props="header.getContext()" /></template></th></tr></thead>
      <tbody><tr v-for="row in rows" :key="row.id"><td v-for="cell in row.getVisibleCells()" :key="cell.id"><FlexRender :render="cell.column.columnDef.cell" :props="cell.getContext()" /></td></tr><tr v-if="rows.length === 0"><td :colspan="table.getVisibleLeafColumns().length">No results</td></tr></tbody>
    </table>
    <nav aria-label="Table pagination"><button type="button" :disabled="!table.getCanPreviousPage()" @click="table.previousPage">Previous</button><span aria-live="polite">Page {{ table.getState().pagination.pageIndex + 1 }}</span><button type="button" :disabled="!table.getCanNextPage()" @click="table.nextPage">Next</button><label>Rows <select :value="table.getState().pagination.pageSize" @change="table.setPageSize(Number(($event.target as HTMLSelectElement).value))"><option v-for="size in pageSizeOptions" :key="size" :value="size">{{ size }}</option></select></label></nav>
  </div>
</template>
