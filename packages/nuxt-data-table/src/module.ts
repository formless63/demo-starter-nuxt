import { addComponentsDir, createResolver, defineNuxtModule } from '@nuxt/kit'

export default defineNuxtModule({
  meta: { name: '@repo/nuxt-data-table', configKey: 'dataTable', compatibility: { nuxt: '>=4.0.0 <5.0.0' } },
  async setup() {
    const resolver = createResolver(import.meta.url)
    await addComponentsDir({ path: resolver.resolve('./runtime/components'), pathPrefix: false })
  },
})
