<!-- eslint-disable vue/multi-word-component-names -->
<script setup lang="ts">
import { onNuxtReady } from '#app'
import { ref } from 'vue'
const hydrated = ref(false)
onNuxtReady(() => { hydrated.value = true })
</script>

<template>
  <main :data-fixture-hydrated="hydrated">
    <h1>File UI native transport consumer</h1>
    <p>NON-DURABLE, bounded single-process metadata fixture. Restart loses receipts.</p>
    <FileManager :max-bytes="1024" />
  </main>
</template>
