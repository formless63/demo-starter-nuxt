import { addServerImports, addServerPlugin, createResolver, defineNuxtModule } from '@nuxt/kit'

export default defineNuxtModule({
  meta: { name: '@repo/nuxt-storage', compatibility: { nuxt: '>=4.0.0 <5.0.0' } },
  setup() {
    const resolver = createResolver(import.meta.url)
    // Never alias Nitro's existing useStorage (unstorage) helper.
    addServerImports([{ name: 'getStorage', from: resolver.resolve('./runtime/server/index') }])
    addServerPlugin(resolver.resolve('./runtime/server/plugin'))
  },
})
