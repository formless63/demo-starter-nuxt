import { addComponent, createResolver, defineNuxtModule } from '@nuxt/kit'
export default defineNuxtModule({
  meta: { name: '@repo/nuxt-file-ui', compatibility: { nuxt: '>=4.0.0 <5.0.0' } },
  moduleDependencies: { '@repo/nuxt-storage': { version: '>=0.1.0 <0.2.0' } },
  setup() {
    const resolver = createResolver(import.meta.url)
    addComponent({ name: 'FileManager', filePath: resolver.resolve('./runtime/components/FileManager.vue') })
  },
})
