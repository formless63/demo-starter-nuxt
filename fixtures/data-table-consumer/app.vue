<template><DataTable :data="[{ id: 'one', name: 'One' }]" :columns="columns" :row-id="row => row.id" /></template>
<script setup lang="ts">
import type { ColumnDef } from '@tanstack/vue-table'
const columns: ColumnDef<{ id: string; name: string }, unknown>[] = [{ accessorKey: 'name', header: 'Name', enableSorting: true }]
</script>
