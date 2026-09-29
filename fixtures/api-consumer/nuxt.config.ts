export default defineNuxtConfig({
  compatibilityDate: '2026-01-01',
  modules: ['@wicaso/nuxt-api'],
  apiPlatform: {
    auth: 'server/utils/auth',
    contracts: 'server/api-platform/contracts',
    title: 'Fixture API',
    version: '1.0.0',
    description: 'External consumer fixture',
  },
  runtimeConfig: {
    databaseUrl: '',
    authSecret: '',
    public: { appBaseUrl: 'http://127.0.0.1:3210' },
  },
  typescript: { strict: true },
  nitro: { preset: 'node-server' },
})
