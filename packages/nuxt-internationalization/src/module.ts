import { addComponent, addImports, createResolver, defineNuxtModule } from '@nuxt/kit'
export default defineNuxtModule({
  meta: { name: '@repo/nuxt-internationalization', configKey: 'internationalization', compatibility: { nuxt: '>=4.0.0 <5.0.0' } },
  setup(_, nuxt) {
    // Runtime components sit outside Vite's first entry scan. Register this
    // dependency before Nuxt forks shallow per-environment Vite configurations.
    const optimizeDeps = nuxt.options.vite.optimizeDeps ?? {}
    nuxt.options.vite.optimizeDeps = {
      ...optimizeDeps,
      include: [...new Set([...(optimizeDeps.include ?? []), 'vue-i18n'])],
    }
    const resolver = createResolver(import.meta.url)
    addComponent({ name: 'InternationalizationProvider', filePath: resolver.resolve('./runtime/components/InternationalizationProvider.vue') })
    for (const name of ['useInternationalization', 'useLocaleLoader']) addImports({ name, from: resolver.resolve('./runtime/locale') })
  },
})
