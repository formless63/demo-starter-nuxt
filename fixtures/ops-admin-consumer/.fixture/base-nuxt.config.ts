export default defineNuxtConfig({
  compatibilityDate: '2026-01-01',
  typescript: { strict: true },
  runtimeConfig: { databaseUrl: '', authSecret: '', public: { appBaseUrl: '' } },
  nitro: { preset: 'node-server' },
})
