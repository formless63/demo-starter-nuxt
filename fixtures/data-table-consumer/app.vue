<template><DataTable :data="[{ id: 'one', name: 'One' }]" :columns="columns" :row-id="row => row.id" /></template>
<script setup lang="ts">
const columns = [{ accessorKey: 'name', header: 'Name', enableSorting: true }]
</script>
