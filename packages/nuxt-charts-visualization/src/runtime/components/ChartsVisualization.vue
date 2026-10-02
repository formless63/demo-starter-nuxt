<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useAttrs, useId, watch } from 'vue'
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

const attrs = useAttrs()
const host = ref<HTMLElement | null>(null)
const chart = ref<ECharts | null>(null)
const mounted = ref(false)
const instanceId = useId()
const chartId = computed(() => String(attrs.id ?? instanceId))
const titleId = computed(() => `${chartId.value}-title`)
const descriptionId = computed(() => `${chartId.value}-description`)
const reducedMotion = ref(false)
const fallbackRows = computed(() => props.labels.map((label, index) => ({ label, values: props.series.map(item => item.data[index] ?? '—') })))
let resizeObserver: ResizeObserver | undefined
let mediaQuery: MediaQueryList | undefined
let motionListener: ((event: MediaQueryListEvent) => void) | undefined
let lifecycle = 0

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
  const current = chart.value
  const currentLifecycle = lifecycle
  if (!mounted.value || !current) return
  await nextTick()
  if (!mounted.value || lifecycle !== currentLifecycle || chart.value !== current) return
  current.setOption(option(), { notMerge: true, lazyUpdate: false })
}

onMounted(async () => {
  mounted.value = true
  const currentLifecycle = ++lifecycle
  mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
  reducedMotion.value = mediaQuery.matches
  motionListener = event => { reducedMotion.value = event.matches; void render() }
  mediaQuery.addEventListener('change', motionListener)
  if (!host.value) return
  const [{ use: register, init }, { CanvasRenderer }, { GridComponent, LegendComponent, TooltipComponent, AriaComponent }, { BarChart, LineChart }] = await Promise.all([
    import('echarts/core'), import('echarts/renderers'), import('echarts/components'), import('echarts/charts'),
  ])
  if (!mounted.value || lifecycle !== currentLifecycle || !host.value) return
  register([CanvasRenderer, GridComponent, LegendComponent, TooltipComponent, AriaComponent, BarChart, LineChart])
  const currentHost = host.value
  chart.value = init(currentHost, undefined, { renderer: 'canvas' })
  await render()
  if (!mounted.value || lifecycle !== currentLifecycle || !chart.value || !host.value) {
    chart.value?.dispose()
    chart.value = null
    return
  }
  resizeObserver = new ResizeObserver(() => chart.value?.resize())
  resizeObserver.observe(currentHost)
})

watch(() => [props.kind, props.labels, props.series, props.animated], () => void render(), { deep: true })
onBeforeUnmount(() => {
  mounted.value = false
  lifecycle += 1
  resizeObserver?.disconnect()
  if (mediaQuery && motionListener) mediaQuery.removeEventListener('change', motionListener)
  chart.value?.dispose()
  chart.value = null
})
</script>

<template>
  <figure class="charts-visualization" :aria-labelledby="titleId" :aria-describedby="description ? descriptionId : undefined">
    <figcaption>
      <h2 :id="titleId">{{ title }}</h2>
      <p v-if="description" :id="descriptionId">{{ description }}</p>
    </figcaption>
    <div ref="host" class="charts-visualization__canvas" :style="{ height }" aria-hidden="true" />
    <table class="charts-visualization__data">
      <caption class="sr-only">{{ title }} data</caption>
      <thead><tr><th scope="col">{{ labels.length ? 'Category' : 'Data' }}</th><th v-for="item in series" :key="item.name" scope="col">{{ item.name }}</th></tr></thead>
      <tbody><tr v-for="row in fallbackRows" :key="row.label"><th scope="row">{{ row.label }}</th><td v-for="(value, index) in row.values" :key="`${row.label}-${index}`">{{ value }}</td></tr></tbody>
    </table>
  </figure>
</template>
