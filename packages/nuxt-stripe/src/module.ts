import { defineNuxtModule } from '@nuxt/kit'
export default defineNuxtModule({
  meta: { name: '@repo/nuxt-stripe', compatibility: { nuxt: '>=4.0.0 <5.0.0' } },
  moduleDependencies: {
    '@repo/nuxt-jobs': { version: '>=0.1.0 <0.2.0' },
    '@repo/nuxt-webhooks': { version: '>=0.1.0 <0.2.0' },
  },
  setup() { /* Explicit application schema, policies, registry and native routes. No startup I/O. */ },
})
