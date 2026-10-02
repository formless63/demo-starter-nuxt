import { addComponent, addImports, createResolver, defineNuxtModule } from '@nuxt/kit'
export default defineNuxtModule({
  meta: { name: '@repo/nuxt-internationalization', configKey: 'internationalization', compatibility: { nuxt: '>=4.0.0 <5.0.0' } },
  setup() {
    const resolver = createResolver(import.meta.url)
    addComponent({ name: 'InternationalizationProvider', filePath: resolver.resolve('./runtime/components/InternationalizationProvider.vue') })
    for (const name of ['useInternationalization', 'useLocaleLoader']) addImports({ name, from: resolver.resolve('./runtime/locale') })
  },
})
