import { defineNuxtModule } from '@nuxt/kit'
export default defineNuxtModule({
  meta: { name: '@repo/nuxt-import-export', compatibility: { nuxt: '>=4.0.0 <5.0.0' } },
  moduleDependencies: { '@repo/nuxt-jobs': { version: '>=0.1.0 <0.2.0' }, '@repo/nuxt-storage': { version: '>=0.1.0 <0.2.0' } },
  setup() { /* Application-owned registry, schema inclusion and explicit migrations. */ },
})
