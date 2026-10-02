<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { ECharts, EChartsOption } from 'echarts'

export type ChartKind = 'line' | 'bar' | 'area'
export interface ChartSeries { name: string; data: Array<number | null>; color?: string }

const props = withDefaults(defineProps<{
  kind?: ChartKind
  labels: string[]
  series: ChartSeries[]
  title: string
  description?: string
  height?: string
  animated?: boolean
}>(), { kind: 'line', description: '', height: '20rem', animated: true })

const host = ref<HTMLElement | null>(null)
const chart = ref<ECharts | null>(null)
const reducedMotion = ref(false)
const fallbackRows = computed(() => props.labels.map((label, index) => ({ label, values: props.series.map(item => item.data[index] ?? '—') })))
let resizeObserver: ResizeObserver | undefined
let mediaQuery: MediaQueryList | undefined
let motionListener: ((event: MediaQueryListEvent) => void) | undefined

function option(): EChartsOption {
  const area = props.kind === 'area'
  return {
    animation: props.animated && !reducedMotion.value,
    aria: { enabled: true, decal: { show: true } },
    tooltip: { trigger: 'axis' },
    legend: { data: props.series.map(item => item.name) },
    xAxis: { type: 'category', data: props.labels, boundaryGap: props.kind === 'bar' },
    yAxis: { type: 'value' },
    series: props.series.map(item => ({
      name: item.name, type: props.kind === 'bar' ? 'bar' : 'line', data: item.data,
      smooth: props.kind !== 'bar', itemStyle: item.color ? { color: item.color } : undefined,
      areaStyle: area ? {} : undefined,
    })),
  }
}

async function render() {
  if (!chart.value) return
  await nextTick()
  chart.value.setOption(option(), { notMerge: true, lazyUpdate: false })
}

onMounted(async () => {
  mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
  reducedMotion.value = mediaQuery.matches
  motionListener = event => { reducedMotion.value = event.matches; void render() }
  mediaQuery.addEventListener('change', motionListener)
  if (!host.value) return
  const [{ use: register, init }, { CanvasRenderer }, { GridComponent, LegendComponent, TooltipComponent, AriaComponent }, { BarChart, LineChart }] = await Promise.all([
    import('echarts/core'), import('echarts/renderers'), import('echarts/components'), import('echarts/charts'),
  ])
  register([CanvasRenderer, GridComponent, LegendComponent, TooltipComponent, AriaComponent, BarChart, LineChart])
  chart.value = init(host.value, undefined, { renderer: 'canvas' })
  await render()
  resizeObserver = new ResizeObserver(() => chart.value?.resize())
  resizeObserver.observe(host.value)
})

watch(() => [props.kind, props.labels, props.series, props.animated], () => void render(), { deep: true })
onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  if (mediaQuery && motionListener) mediaQuery.removeEventListener('change', motionListener)
  chart.value?.dispose()
  chart.value = null
})
</script>

<template>
  <figure class="charts-visualization" :aria-labelledby="`${$attrs.id ?? 'chart'}-title`" :aria-describedby="`${$attrs.id ?? 'chart'}-description`">
    <figcaption>
      <h2 :id="`${$attrs.id ?? 'chart'}-title`">{{ title }}</h2>
      <p v-if="description" :id="`${$attrs.id ?? 'chart'}-description`">{{ description }}</p>
    </figcaption>
    <div ref="host" class="charts-visualization__canvas" :style="{ height }" aria-hidden="true" />
    <table class="charts-visualization__data">
      <caption class="sr-only">{{ title }} data</caption>
      <thead><tr><th scope="col">{{ labels.length ? 'Category' : 'Data' }}</th><th v-for="item in series" :key="item.name" scope="col">{{ item.name }}</th></tr></thead>
      <tbody><tr v-for="row in fallbackRows" :key="row.label"><th scope="row">{{ row.label }}</th><td v-for="(value, index) in row.values" :key="`${row.label}-${index}`">{{ value }}</td></tr></tbody>
    </table>
  </figure>
</template>
