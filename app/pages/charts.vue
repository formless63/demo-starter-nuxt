<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { getInstanceByDom } from 'echarts/core'

definePageMeta({ layout: 'default' })
const kind = ref<'line' | 'bar' | 'area'>('line')
const mounted = ref(true)
const loading = ref(false)
const empty = ref(false)
const revision = ref(0)
const labels = computed(() => revision.value ? ['Jan', 'Feb', 'Mar'] : ['Jan', 'Feb'])
const values = computed(() => empty.value ? [] : revision.value ? [12, 18, 9] : [10, 15])
const chartState = ref({ type: '', data: [] as unknown[], animation: true, area: false, width: 0 })
const chartError = ref('')
let stateTimer: ReturnType<typeof setInterval> | undefined
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null }

function startUpdate() {
  loading.value = true
}

function replaceData() {
  revision.value++
  loading.value = false
}

onMounted(() => {
  stateTimer = setInterval(() => {
    const host = document.querySelector('#primary-chart .charts-visualization__canvas')
    const instance = host instanceof HTMLElement ? getInstanceByDom(host) : undefined
    const option = instance?.getOption() as { series?: unknown; animation?: unknown } | undefined
    const firstSeries = Array.isArray(option?.series) && isRecord(option.series[0]) ? option.series[0] : undefined
    chartState.value = {
      type: String(firstSeries?.type ?? ''),
      data: Array.isArray(firstSeries?.data) ? firstSeries.data : [],
      animation: option?.animation !== false,
      area: firstSeries?.areaStyle !== undefined,
      width: instance?.getWidth() ?? 0,
    }
  }, 25)
})
onBeforeUnmount(() => { if (stateTimer) clearInterval(stateTimer) })
</script>

<template>
  <main class="mx-auto max-w-3xl space-y-4 p-6">
    <h1 class="text-2xl font-bold">Charts visualization</h1>
    <div class="flex flex-wrap gap-2">
      <button v-for="option in ['line', 'bar', 'area']" :key="option" type="button" :aria-pressed="kind === option" @click="kind = option as typeof kind">{{ option }}</button>
      <button type="button" @click="startUpdate">Start update</button>
      <button type="button" @click="replaceData">Apply update</button>
      <button type="button" @click="empty = !empty">Toggle empty</button>
      <button type="button" @click="mounted = !mounted">Toggle mount</button>
    </div>
    <p v-if="loading" role="status">Loading chart data…</p>
    <output data-echarts-state class="sr-only">{{ JSON.stringify({ ...chartState, error: chartError }) }}</output>
    <ChartsVisualization v-if="mounted" id="primary-chart" :kind="kind" title="Revenue" description="Monthly revenue" :labels="labels" :series="[{ name: 'Revenue', data: values } ]" @enhancement-error="chartError = $event" />
    <ChartsVisualization v-if="mounted" kind="bar" title="Users" :labels="labels" :series="[{ name: 'Users', data: values } ]" />
  </main>
</template>
