import { addComponentsDir, createResolver, defineNuxtModule } from '@nuxt/kit'

export default defineNuxtModule({
  meta: { name: '@repo/nuxt-data-table', configKey: 'dataTable', compatibility: { nuxt: '>=4.0.0 <5.0.0' } },
  async setup(_, nuxt) {
    // Module components are outside Vite's initial entry scan. Register owned
    // imports before Nuxt creates shallow per-environment Vite configurations.
    const optimizeDeps = nuxt.options.vite.optimizeDeps ?? {}
    nuxt.options.vite.optimizeDeps = {
      ...optimizeDeps,
      include: [...new Set([...(optimizeDeps.include ?? []), '@tanstack/vue-table'])],
    }
    const resolver = createResolver(import.meta.url)
    await addComponentsDir({ path: resolver.resolve('./runtime/components'), pathPrefix: false })
  },
})
