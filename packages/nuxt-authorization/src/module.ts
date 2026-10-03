import { defineNuxtModule } from '@nuxt/kit'

export default defineNuxtModule({
  meta: { name: '@repo/nuxt-authorization', configKey: 'authorization', compatibility: { nuxt: '>=4.0.0 <5' } },
  setup() { /* Explicit server imports/schema/registry; no queries, routes or seeding. */ },
})
