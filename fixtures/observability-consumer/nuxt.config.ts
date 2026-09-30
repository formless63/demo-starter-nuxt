export default defineNuxtConfig({
  compatibilityDate: '2026-01-01',
  modules: ['@repo/nuxt-observability'],
  observability: { serviceName: 'observability-fixture', redactKeys: ['privateNote'] },
  typescript: { strict: true },
  nitro: { preset: 'node-server' },
})
