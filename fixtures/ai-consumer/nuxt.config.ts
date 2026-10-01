export default defineNuxtConfig({
  compatibilityDate: '2026-01-01',
  modules: ['@repo/nuxt-ai'],
  typescript: { strict: true },
  nitro: { preset: 'node-server' },
})
