<script setup lang="ts">
definePageMeta({ middleware: 'auth', layout: 'app' })
await navigateTo('/app/projects')
</script>

<template>
  <p>Loading…</p>
</template>
