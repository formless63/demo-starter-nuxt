<script setup lang="ts">
type Person = { id: string; name: string }
const rows: Person[] = [{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta' }]
const columns = [{ accessorKey: 'name', header: 'Name', enableSorting: true }]
</script>
<template><DataTable :data="rows" :columns="columns" :row-id="row => row.id" :enable-row-selection="true" /></template>
