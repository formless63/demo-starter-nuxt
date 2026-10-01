import { defineNuxtModule } from '@nuxt/kit'
export default defineNuxtModule({ meta: { name: '@repo/nuxt-feature-flags', configKey: 'featureFlags', compatibility: { nuxt: '>=4.0.0 <5' } }, setup() { /* Explicit server composition; no routes, provider fetch, migrations or seed. */ } })
