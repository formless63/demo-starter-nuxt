<script setup lang="ts">
const draft = ref('')
const visible = ref(true)
useHead({ title: 'Public offline notice' })
</script>
<template>
  <main>
    <h1>Public offline notice</h1>
    <p>This public demonstration never saves account content or forms offline.</p>
    <label>Unsaved draft <input v-model="draft" aria-label="Unsaved draft"></label>
    <button @click="visible = !visible">{{ visible ? 'Hide offline controls' : 'Show offline controls' }}</button>
    <PwaPanel v-if="visible" />
    <NuxtLink to="/">Home</NuxtLink>
  </main>
</template>
