import { addComponentsDir, createResolver, defineNuxtModule } from '@nuxt/kit'
import { mergeChartsOptimizeDeps } from './vite'

export default defineNuxtModule({
  meta: { name: '@repo/nuxt-charts-visualization', compatibility: { nuxt: '>=4.0.0 <5.0.0' } },
  setup(_, nuxt) {
    // The Environment API invokes Vite hooks with shallow config copies.
    // Register owned entries before those per-environment configs are created.
    mergeChartsOptimizeDeps(nuxt.options.vite)
    addComponentsDir({ path: createResolver(import.meta.url).resolve('./runtime/components') })
  },
})
