import { addComponentsDir, createResolver, defineNuxtModule } from '@nuxt/kit'

export default defineNuxtModule({
  meta: { name: '@repo/nuxt-charts-visualization', compatibility: { nuxt: '>=4.0.0 <5.0.0' } },
  setup() {
    addComponentsDir({ path: createResolver(import.meta.url).resolve('./runtime/components') })
  },
})
