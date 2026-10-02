import { addComponentsDir, createResolver, defineNuxtModule } from '@nuxt/kit'
import { mergeChartsOptimizeDeps } from './vite'

export default defineNuxtModule({
  meta: { name: '@repo/nuxt-charts-visualization', compatibility: { nuxt: '>=4.0.0 <5.0.0' } },
  setup(_, nuxt) {
    addComponentsDir({ path: createResolver(import.meta.url).resolve('./runtime/components') })
    nuxt.hook('vite:extendConfig', config => { mergeChartsOptimizeDeps(config) })
  },
})
