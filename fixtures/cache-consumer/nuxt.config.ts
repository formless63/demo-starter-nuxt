export default defineNuxtConfig({
  compatibilityDate: '2026-01-01',
  modules: ['@repo/nuxt-cache'],
  typescript: { strict: true },
  nitro: { preset: 'node-server' },
})
