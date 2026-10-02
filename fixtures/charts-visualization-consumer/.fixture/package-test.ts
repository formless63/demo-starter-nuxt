import { createSSRApp, h } from 'vue'
import { renderToString } from '@vue/server-renderer'
import ChartsVisualization from '@repo/nuxt-charts-visualization/runtime/components/ChartsVisualization.vue'

const chart = (title: string, description?: string) => h(ChartsVisualization, {
  title, description, labels: ['Jan', 'Feb'], series: [{ name: 'Revenue', data: [10, null] }],
})
const html = await renderToString(createSSRApp({ render: () => h('main', [chart('First', 'First description'), chart('Second')]) }))
if ((html.match(/<table/g) ?? []).length !== 2) throw new Error('SSR fallback must render one data table per chart')
if (!html.includes('Revenue') || !html.includes('Jan') || !html.includes('—')) throw new Error('SSR fallback omitted semantic data')
const titleIds = [...html.matchAll(/<h2 id="([^"]+)"/g)].map(match => match[1])
if (titleIds.length !== 2 || titleIds[0] === titleIds[1]) throw new Error('chart instance IDs must be unique')
if (!html.includes('aria-describedby=') || html.match(/aria-describedby="[^"]+"/g)?.length !== 1) throw new Error('description linkage must be conditional')
console.log('charts fixture contract: SSR fallback, transitions, and unique accessibility IDs passed')
