<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useAttrs, useId, watch } from 'vue'
import type { ECharts, EChartsOption } from 'echarts'
import { createChartsLifecycle } from '../lifecycle'

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
const instanceId = useId()
const chartId = computed(() => String(attrs.id ?? instanceId))
const titleId = computed(() => `${chartId.value}-title`)
const descriptionId = computed(() => `${chartId.value}-description`)
const reducedMotion = ref(false)
const fallbackRows = computed(() => props.labels.map((label, index) => ({ label, values: props.series.map(item => item.data[index] ?? '—') })))
const hasData = computed(() => props.labels.length > 0 && props.series.some(item => item.data.some(value => value !== null)))
let mediaQuery: MediaQueryList | undefined
let motionListener: ((event: MediaQueryListEvent) => void) | undefined
const lifecycleController = createChartsLifecycle<ECharts, HTMLElement, EChartsOption>({
  load: async () => {
    const [{ use: register, init }, { CanvasRenderer }, { GridComponent, LegendComponent, TooltipComponent, AriaComponent }, { BarChart, LineChart }] = await Promise.all([
      import('echarts/core'), import('echarts/renderers'), import('echarts/components'), import('echarts/charts'),
    ])
    register([CanvasRenderer, GridComponent, LegendComponent, TooltipComponent, AriaComponent, BarChart, LineChart])
    return { init: (element: HTMLElement) => init(element, undefined, { renderer: 'canvas' }) }
  },
  host: () => host.value,
  option,
  nextTick,
  setOption: (instance, value) => instance.setOption(value, { notMerge: true, lazyUpdate: false }),
  observe: (element, onResize) => { const observer = new ResizeObserver(onResize); observer.observe(element); return observer },
  resize: instance => instance.resize(),
  dispose: instance => instance.dispose(),
})

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

onMounted(() => {
  mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
  reducedMotion.value = mediaQuery.matches
  motionListener = event => { reducedMotion.value = event.matches; void lifecycleController.render() }
  mediaQuery.addEventListener('change', motionListener)
  void lifecycleController.mount()
})

watch(() => [props.kind, props.labels, props.series, props.animated], () => void lifecycleController.render(), { deep: true })
onBeforeUnmount(() => {
  if (mediaQuery && motionListener) mediaQuery.removeEventListener('change', motionListener)
  lifecycleController.unmount()
})
</script>

<template>
  <figure class="charts-visualization" :aria-labelledby="titleId" :aria-describedby="description ? descriptionId : undefined">
    <figcaption>
      <h2 :id="titleId">{{ title }}</h2>
      <p v-if="description" :id="descriptionId">{{ description }}</p>
    </figcaption>
    <div ref="host" class="charts-visualization__canvas" :data-chart-kind="kind" :data-chart-animation="props.animated && !reducedMotion" :data-chart-series="JSON.stringify(series.map(item => item.data))" :style="{ height }" aria-hidden="true" />
    <p v-if="!hasData" role="status">No chart data available.</p>
    <table class="charts-visualization__data">
      <caption class="sr-only">{{ title }} data</caption>
      <thead><tr><th scope="col">{{ labels.length ? 'Category' : 'Data' }}</th><th v-for="item in series" :key="item.name" scope="col">{{ item.name }}</th></tr></thead>
      <tbody><tr v-for="row in fallbackRows" :key="row.label"><th scope="row">{{ row.label }}</th><td v-for="(value, index) in row.values" :key="`${row.label}-${index}`">{{ value }}</td></tr></tbody>
    </table>
  </figure>
</template>
