<script setup lang="ts">
import { ref } from 'vue'

definePageMeta({ layout: 'default' })
const kind = ref<'line' | 'bar' | 'area'>('line')
const mounted = ref(true)
const loading = ref(false)
const empty = ref(false)
const revision = ref(0)
const labels = computed(() => revision.value ? ['Jan', 'Feb', 'Mar'] : ['Jan', 'Feb'])
const values = computed(() => empty.value ? [] : revision.value ? [12, 18, 9] : [10, 15])

async function replaceData() {
  loading.value = true
  await new Promise(resolve => setTimeout(resolve, 200))
  revision.value++
  loading.value = false
}
</script>

<template>
  <main class="mx-auto max-w-3xl space-y-4 p-6">
    <h1 class="text-2xl font-bold">Charts visualization</h1>
    <div class="flex flex-wrap gap-2">
      <button v-for="option in ['line', 'bar', 'area']" :key="option" type="button" :aria-pressed="kind === option" @click="kind = option as typeof kind">{{ option }}</button>
      <button type="button" @click="replaceData">Replace data</button>
      <button type="button" @click="empty = !empty">Toggle empty</button>
      <button type="button" @click="mounted = !mounted">Toggle mount</button>
    </div>
    <p v-if="loading" role="status">Loading chart data…</p>
    <ChartsVisualization v-if="mounted" id="primary-chart" :kind="kind" title="Revenue" description="Monthly revenue" :labels="labels" :series="[{ name: 'Revenue', data: values } ]" />
    <ChartsVisualization v-if="mounted" kind="bar" title="Users" :labels="labels" :series="[{ name: 'Users', data: values } ]" />
  </main>
</template>
