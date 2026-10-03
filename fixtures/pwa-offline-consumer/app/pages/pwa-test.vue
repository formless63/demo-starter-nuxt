<script setup lang="ts">
const showPanel = ref(true)
const draft = ref('')
</script>

<template>
  <main>
    <h1>Public offline demonstration</h1>
    <label>Unsaved draft <input v-model="draft" aria-label="Unsaved draft"></label>
    <button type="button" @click="showPanel = !showPanel">Toggle panel</button>
    <PwaPanel v-if="showPanel" />
    <NuxtLink to="/away">Another route</NuxtLink>
  </main>
</template>
