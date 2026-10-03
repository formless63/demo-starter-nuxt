import { addComponent, createResolver, defineNuxtModule } from '@nuxt/kit'
import { mergeFlowOptimizeDeps } from './vite'

export default defineNuxtModule({
  meta: { name: '@repo/nuxt-flow-canvas', compatibility: { nuxt: '>=4.0.0 <5.0.0' } },
  setup(_, nuxt) {
    const resolver = createResolver(import.meta.url)
    mergeFlowOptimizeDeps(nuxt.options.vite)
    addComponent({ name: 'FlowCanvas', filePath: resolver.resolve('./runtime/components/FlowCanvas.vue') })
    nuxt.options.css.push('@vue-flow/core/dist/style.css', '@vue-flow/core/dist/theme-default.css', resolver.resolve('./runtime/flow.css'))
  },
})
