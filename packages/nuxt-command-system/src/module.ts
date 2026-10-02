import { addComponent, createResolver, defineNuxtModule } from '@nuxt/kit'

export default defineNuxtModule({
  meta: { name: '@repo/nuxt-command-system', compatibility: { nuxt: '>=4.0.0 <5.0.0' } },
  setup() {
    const resolver = createResolver(import.meta.url)
    addComponent({ name: 'CommandPalette', filePath: resolver.resolve('./runtime/components/CommandPalette.vue') })
  },
})
