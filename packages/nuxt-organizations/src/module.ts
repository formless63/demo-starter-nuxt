import { defineNuxtModule } from '@nuxt/kit'
import { resolveOrganizationsConfig } from './runtime/server/validation'

export default defineNuxtModule({
  meta: { name: '@repo/nuxt-organizations', configKey: 'organizations', compatibility: { nuxt: '>=4.0.0 <5' } },
  setup() {
    resolveOrganizationsConfig()
    // Auth/plugin/schema composition is explicit and app-owned. No connection or migration.
  },
})
