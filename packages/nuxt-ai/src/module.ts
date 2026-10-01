import { addServerImports, createResolver, defineNuxtModule } from '@nuxt/kit'

export default defineNuxtModule({
  meta: { name: '@repo/nuxt-ai', compatibility: { nuxt: '>=4.0.0 <5.0.0' } },
  setup() {
    const resolver = createResolver(import.meta.url)
    addServerImports([{ name: 'getAi', from: resolver.resolve('./runtime/server/index') }])
  },
})
