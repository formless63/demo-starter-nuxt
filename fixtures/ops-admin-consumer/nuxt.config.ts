export default defineNuxtConfig({
  compatibilityDate: '2026-01-01',
  modules: ['@repo/nuxt-ops-admin'],
  opsAdmin: { application: 'server/ops/application' },
  typescript: { strict: true },
  runtimeConfig: { databaseUrl: '', authSecret: '', public: { appBaseUrl: '' } },
  nitro: { preset: 'node-server' },
})
