export default defineNuxtConfig({
  compatibilityDate: '2026-01-01',
  modules: ['@wicaso/nuxt-jobs'],
  typescript: { strict: true },
  nitro: { preset: 'node-server' },
})
