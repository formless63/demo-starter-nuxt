import { addServerPlugin, createResolver, defineNuxtModule } from '@nuxt/kit'
export default defineNuxtModule({
  meta: { name: '@repo/nuxt-realtime', compatibility: { nuxt: '>=4.0.0 <5.0.0' } },
  setup(_options, nuxt) {
    // Compile both adapters; server-only runtime config chooses connections on use.
    nuxt.options.nitro.experimental ??= {}
    nuxt.options.nitro.experimental.websocket = true
    addServerPlugin(createResolver(import.meta.url).resolve('./runtime/server/plugin'))
  },
})
