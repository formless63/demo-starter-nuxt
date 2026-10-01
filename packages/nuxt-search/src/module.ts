import { defineNuxtModule } from '@nuxt/kit'

export default defineNuxtModule({
  meta: {
    name: '@repo/nuxt-search',
    configKey: 'search',
    compatibility: { nuxt: '>=4.0.0 <5.0.0' },
  },
  setup() {
    // Explicit server imports only. Applications own database composition/migrations.
  },
})
