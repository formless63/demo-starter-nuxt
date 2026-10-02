<script setup lang="ts">
definePageMeta({ middleware: 'auth' })
</script>
<template>
  <main class="mx-auto max-w-4xl p-6">
    <h1 class="text-2xl font-bold">Files</h1>
    <p class="my-4">Private files up to 10 MiB. Cancelled or uncertain writes may need operator reconciliation.</p>
    <FileManager />
  </main>
</template>
