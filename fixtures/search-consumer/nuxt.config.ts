export default defineNuxtConfig({
  compatibilityDate: '2026-01-01',
  modules: ['@repo/nuxt-search'],
  typescript: { strict: true },
  nitro: { preset: 'node-server' },
})
